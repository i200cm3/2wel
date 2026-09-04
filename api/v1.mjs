import { bearerToken } from './auth.js'
import {
  amoRedirectUri,
  amoWebhookUrl,
  cabinetIntegrationsUrl,
  ensureAmoWebhook,
  exchangeAmoCode,
  fetchAmoLeadSnapshot,
  normalizeAmoDomain,
  publicOrigin,
  subscribeAmoWebhook,
  verifyAmoState,
} from './amoAuth.mjs'
import { fetchNotesByIds, fetchLeadIdsForContact, fetchAmoContact, fetchContactsByPhones, phonesFromAmoCallNote, syncAmoCallsToLink, entityIdsFromAmoNotes } from './amoCalls.mjs'
import { phonesFromAmoContact } from './amoPhone.mjs'
import { getAmoConnection, getProjectById, upsertAmoConnection } from './amoConnections.mjs'
import { amoError, amoLog, amoWarn, amoIdPreview } from './amoLog.mjs'
import {
  extractAmoGuestLink,
  extractAmoNoteEvents,
  extractContactIdsFromNoteWebhook,
  extractLeadIdsFromNoteWebhook,
  extractPhonesFromAmoWebhook,
  shouldIssueGuestLinkFromAmoWebhook,
  shouldIssueAfterPipelineCheck,
  shouldRetryAmoCallSync,
  shouldSyncCallsFromNoteEvents,
  summarizeAmoWebhookBody,
} from './amoWebhook.mjs'
import { issueGuestLink } from './cabinet.mjs'
import { createApiKey, findApiKey, touchApiKeyUsed } from './keys.mjs'
import { findLinksForAmoCall, recordLinkCrmStatus } from './links.mjs'
import { schedulePresentationPipeline } from './presentationPipeline.mjs'
import { guestLinkUrl } from './publicUrl.mjs'
import { clientIp, consumeRateLimit, rateLimited } from './rateLimit.mjs'

const AMO_CALL_RECORDING_RETRY_MS = [20_000, 90_000]

function scheduleAmoCallRetry(run, delayMs = AMO_CALL_RECORDING_RETRY_MS[0]) {
  const timer = setTimeout(() => {
    Promise.resolve()
      .then(run)
      .catch((err) => console.error('amo call retry', err))
  }, delayMs)
  if (typeof timer.unref === 'function') timer.unref()
}

const AMO_WEBHOOK = /^\/api\/v1\/amocrm\/webhook\/(pk_live_[a-fA-F0-9]+)\/?$/i
const AMO_PATH = /^\/api\/v1\/amocrm\/(pk_live_[a-fA-F0-9]+)(?:\/links)?\/?$/i
const AMO_QUERY = /^\/api\/v1\/amocrm(?:\/links)?\/?$/i
const AMO_CALLBACK = /^\/api\/v1\/amocrm\/oauth\/callback\/?$/i

export function publicLinkUrl(projectCode, publicId) {
  return guestLinkUrl(projectCode, publicId)
}

function searchParamsOf(req) {
  try {
    return new URL(req.url || '/', 'http://local').searchParams
  } catch {
    return new URLSearchParams()
  }
}

function queryRecord(req) {
  const out = {}
  for (const [key, value] of searchParamsOf(req)) out[key] = value
  return out
}

export function amoTokenFrom(url, req) {
  const webhook = url.match(AMO_WEBHOOK)
  if (webhook) return { hit: true, token: webhook[1] }
  const path = url.match(AMO_PATH)
  if (path) return { hit: true, token: path[1] }
  if (AMO_QUERY.test(url)) return { hit: true, token: searchParamsOf(req).get('key') || '' }
  return { hit: false, token: '' }
}

function issuedPayload(projectCode, issued) {
  return {
    ok: true,
    status: 'success',
    reused: Boolean(issued.reused),
    url: publicLinkUrl(projectCode, issued.link.publicId),
    publicId: issued.link.publicId,
    guestName: issued.link.guestName,
    externalId: issued.link.externalId ?? null,
    templateCode: issued.link.templateCode,
    templateName: issued.link.templateName,
  }
}

function redirect(res, location) {
  res.statusCode = 302
  res.setHeader('Location', location)
  res.end()
}

async function rateLimitLinks(req, res, json, key) {
  const ip = clientIp(req)
  const limitKey = key ? `v1links:key:${key.id}` : `v1links:ip:${ip}`
  const limited = consumeRateLimit(limitKey, {
    windowMs: 60 * 1000,
    max: key ? 120 : 20,
  })
  if (!limited.ok) {
    rateLimited(res, json, limited.retryAfterSec, 'Слишком много выдач ссылок. Подождите минуту.')
    return false
  }
  return true
}

async function issueForKey(key, body, options = {}) {
  const issued = await issueGuestLink(key.project, body, options)
  if (issued.error) return issued
  await touchApiKeyUsed(key.id)
  return issued
}

async function webhookTokenForProject(projectId, existing) {
  const token = existing?.webhookToken
  if (token) {
    const key = await findApiKey(token)
    if (key && key.project.id === projectId) return token
  }
  const created = await createApiKey(projectId, 'AmoCRM')
  return created.token
}

async function handleAmoOAuthCallback(req, res) {
  const q = searchParamsOf(req)
  const state = verifyAmoState(q.get('state'))
  const bounce = (projectCode, reason) => {
    const loc = projectCode
      ? cabinetIntegrationsUrl(req, projectCode, `amo=error&reason=${encodeURIComponent(reason)}`)
      : `${publicOrigin(req)}/app?amo=error&reason=${encodeURIComponent(reason)}`
    redirect(res, loc)
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    bounce(null, 'method')
    return true
  }
  if (!state.ok) {
    bounce(null, state.error)
    return true
  }
  const project = await getProjectById(state.projectId)
  if (!project) {
    bounce(null, 'Проект не найден')
    return true
  }
  const code = String(q.get('code') ?? '').trim()
  const baseDomain = normalizeAmoDomain(q.get('referer'))
  if (!code || !baseDomain) {
    bounce(project.code, 'no_code')
    return true
  }
  try {
    const tokens = await exchangeAmoCode({
      code,
      baseDomain,
      redirectUri: amoRedirectUri(req),
    })
    const existing = await getAmoConnection(project.id)
    const webhookToken = await webhookTokenForProject(project.id, existing)
    const destination = amoWebhookUrl(publicOrigin(req), webhookToken)
    const connection = await upsertAmoConnection({
      projectId: project.id,
      baseDomain,
      ...tokens,
      webhookToken,
      webhookDestination: destination,
    })
    try {
      await subscribeAmoWebhook(connection, destination, amoRedirectUri(req))
    } catch (err) {
      console.error('amo webhook subscribe', err)
      redirect(
        res,
        cabinetIntegrationsUrl(
          req,
          project.code,
          `amo=warn&reason=${encodeURIComponent(err.message || 'webhook')}`,
        ),
      )
      return true
    }
    redirect(res, cabinetIntegrationsUrl(req, project.code, 'amo=ok'))
  } catch (err) {
    console.error('amo oauth', err)
    bounce(project.code, err.message || 'oauth')
  }
  return true
}

async function resolveGuestFields(key, body, query) {
  const connection = await getAmoConnection(key.project.id)
  const parsed = extractAmoGuestLink(body, query, { allowLeadName: !connection })
  if (!connection || !parsed.externalId) return parsed
  try {
    const snap = await fetchAmoLeadSnapshot(connection, parsed.externalId, amoRedirectUri())
    return {
      ...parsed,
      name: parsed.name || snap.name,
      statusId: parsed.statusId || snap.statusId,
      pipelineId: parsed.pipelineId || snap.pipelineId,
      amoSnapshot: {
        ...(parsed.amoSnapshot && typeof parsed.amoSnapshot === 'object' ? parsed.amoSnapshot : {}),
        statusId: parsed.statusId || snap.statusId,
        pipelineId: parsed.pipelineId || snap.pipelineId,
        externalId: parsed.externalId,
        contactId: snap.contactId || '',
        phones: snap.phones || [],
        name: parsed.name || snap.name,
      },
    }
  } catch (err) {
    console.error('amo lead snapshot', key.project.code, err)
  }
  return parsed
}

async function syncCallsForLead({
  connection,
  redirectUri,
  projectId,
  leadId,
  linkId,
  noteIds = null,
  prune = false,
  requireLive = false,
  extraContactIds = [],
}) {
  if (!connection || !linkId || (!leadId && !extraContactIds.length)) return { inserted: [] }
  return syncAmoCallsToLink({
    connection: { ...connection, projectId },
    redirectUri,
    linkId,
    leadId,
    noteIds,
    prune,
    requireLive,
    extraContactIds,
  })
}

async function syncCallsForMatchedLinks(
  key,
  connection,
  redirectUri,
  { leadIds = [], contactIds = [], phones = [] },
  noteIds = null,
  { prune = false, requireLive = false, extraContactIds = [] } = {},
) {
  const links = connection
    ? await findLinksForAmoCall(key.project.id, { leadIds, contactIds, phones })
    : []
  if (!connection || (!leadIds.length && !contactIds.length && !phones.length)) {
    amoLog('webhook.sync.no_leads', { project: key?.project?.code || null, leadIds, contactIds, phoneCount: phones.length })
    return { inserted: [], skipped: 0, pruned: 0, found: 0, missedLeadIds: leadIds }
  }
  const linked = []
  const seen = new Set()
  let inserted = []
  let skipped = 0
  let pruned = 0
  let found = 0
  for (const link of links) {
    if (!link?.id || seen.has(link.id)) continue
    seen.add(link.id)
    linked.push({ leadId: link.externalId, linkId: link.id, publicId: link.publicId })
    const result = await syncCallsForLead({
      connection,
      redirectUri,
      projectId: key.project.id,
      leadId: link.externalId,
      linkId: link.id,
      noteIds,
      prune,
      requireLive,
      extraContactIds,
    })
    inserted = inserted.concat(result.inserted || [])
    skipped += Number(result.skipped || 0)
    pruned += Number(result.pruned || 0)
    found += Number(result.found || 0)
  }
  const linkedLeadIds = new Set(linked.map((item) => String(item.leadId || '')))
  const missedLeadIds = leadIds.filter((id) => !linkedLeadIds.has(String(id)))
  amoLog('webhook.sync.links', {
    project: key.project.code,
    linked,
    missed: amoIdPreview(missedLeadIds),
    contactIds: amoIdPreview(contactIds),
    phoneCount: phones.length,
    extraContacts: extraContactIds.length,
    inserted: inserted.length,
    skipped,
    found,
  })
  return { inserted, skipped, pruned, found, missedLeadIds }
}

async function resolveCallMatchFromNoteWebhook(connection, redirectUri, body, noteEvents) {
  const leadIds = new Set(extractLeadIdsFromNoteWebhook(body))
  const contactIds = new Set(extractContactIdsFromNoteWebhook(body))
  const phones = new Set(extractPhonesFromAmoWebhook(body))
  for (const event of noteEvents) {
    if (event.leadId) leadIds.add(event.leadId)
    if (event.contactId) contactIds.add(event.contactId)
  }

  const noteIds = [...new Set(noteEvents.map((event) => event.noteId).filter(Boolean))]
  let fromNotes = { leadIds: [], contactIds: [] }
  let notes = []
  if (connection && noteIds.length) {
    try {
      notes = await fetchNotesByIds(connection, noteIds, redirectUri)
      fromNotes = entityIdsFromAmoNotes(notes)
      for (const id of fromNotes.leadIds) leadIds.add(id)
      for (const id of fromNotes.contactIds) contactIds.add(id)
      for (const phone of notes.flatMap(phonesFromAmoCallNote)) phones.add(phone)
    } catch (err) {
      amoError('webhook.resolve.notes', err, { noteIds })
    }
  }

  if (connection && !phones.size && contactIds.size) {
    for (const contactId of [...contactIds].slice(0, 5)) {
      try {
        const contact = await fetchAmoContact(connection, contactId, redirectUri)
        for (const phone of phonesFromAmoContact(contact)) phones.add(phone)
      } catch (err) {
        amoError('webhook.resolve.contact', err, { contactId })
      }
    }
  }

  let phoneContacts = []
  if (connection && phones.size) {
    try {
      phoneContacts = await fetchContactsByPhones(connection, [...phones], redirectUri)
      for (const row of phoneContacts) {
        contactIds.add(row.id)
        for (const phone of row.phones || []) phones.add(phone)
      }
    } catch (err) {
      amoError('webhook.resolve.phones', err, { phoneCount: phones.size })
    }
  }

  let fromContacts = []
  if (connection && contactIds.size) {
    const resolved = await Promise.all(
      [...contactIds].map((contactId) => fetchLeadIdsForContact(connection, contactId, redirectUri)),
    )
    fromContacts = resolved.flat()
    for (let i = 0; i < resolved.length; i += 1) {
      const ids = resolved[i]
      if (ids.length > 25) {
        amoWarn('webhook.resolve.shared_contact', {
          contactId: [...contactIds][i],
          leadCount: ids.length,
        })
        continue
      }
      for (const id of ids) leadIds.add(id)
    }
  }

  amoLog('webhook.resolve', {
    payloadLeadIds: amoIdPreview(extractLeadIdsFromNoteWebhook(body)),
    payloadContactIds: amoIdPreview(extractContactIdsFromNoteWebhook(body)),
    eventLeadIds: amoIdPreview(noteEvents.map((event) => event.leadId).filter(Boolean)),
    eventContactIds: amoIdPreview(noteEvents.map((event) => event.contactId).filter(Boolean)),
    noteIds: amoIdPreview(noteIds),
    fromNotes,
    fromContacts: amoIdPreview(fromContacts),
    phoneContacts: amoIdPreview(phoneContacts.map((row) => row.id)),
    phoneCount: phones.size,
    leadIds: amoIdPreview([...leadIds]),
    contactIds: amoIdPreview([...contactIds]),
  })

  return {
    leadIds: [...leadIds],
    contactIds: [...contactIds],
    phones: [...phones],
    extraContactIds: [...contactIds],
  }
}

async function syncCallsFromNoteWebhook(key, connection, redirectUri, body, noteEvents, { retryIndex = 0 } = {}) {
  if (noteEvents.length && !shouldSyncCallsFromNoteEvents(noteEvents)) {
    amoLog('webhook.skip', {
      project: key.project.code,
      reason: 'not_a_call_note',
      retryIndex,
      events: noteEvents,
    })
    return { inserted: [], skipped: 0, found: 0 }
  }
  const match = await resolveCallMatchFromNoteWebhook(connection, redirectUri, body, noteEvents)
  const noteIds = [...new Set(noteEvents.map((event) => event.noteId).filter(Boolean))]
  const result = await syncCallsForMatchedLinks(key, connection, redirectUri, match, noteIds.length ? noteIds : null, {
    prune: false,
    requireLive: false,
    extraContactIds: match.extraContactIds,
  })
  amoLog('webhook.result', {
    project: key.project.code,
    retryIndex,
    events: noteEvents,
    leadIds: amoIdPreview(match.leadIds),
    contactIds: amoIdPreview(match.contactIds),
    phoneCount: match.phones.length,
    missed: amoIdPreview(result.missedLeadIds || []),
    inserted: result.inserted.length,
    skipped: result.skipped,
    found: result.found,
  })
  const delay = AMO_CALL_RECORDING_RETRY_MS[retryIndex]
  if (delay != null && shouldRetryAmoCallSync(result, noteEvents)) {
    amoLog('webhook.retry', {
      project: key.project.code,
      retryIndex,
      delayMs: delay,
      leadIds: amoIdPreview(match.leadIds),
    })
    scheduleAmoCallRetry(
      () => syncCallsFromNoteWebhook(key, connection, redirectUri, body, noteEvents, { retryIndex: retryIndex + 1 }),
      delay,
    )
  }
  return result
}

async function handleAmoWebhook(req, res, url, json, extras) {
  const { token } = amoTokenFrom(url, req)
  const key = await findApiKey(token)
  amoLog('webhook.hit', {
    project: key?.project?.code || null,
    method: req.method,
    path: url,
    authorized: Boolean(key),
    contentType: String(req.headers['content-type'] || ''),
  })
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!key) {
      json(res, 401, { ok: false, error: 'unauthorized' })
      return true
    }
    json(res, 200, { ok: true, amo: true, project: key.project.code })
    return true
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed' })
    return true
  }
  if (!key) {
    json(res, 401, { ok: false, status: 'fail', error: 'unauthorized' })
    return true
  }

  const body = extras.body || {}
  const query = queryRecord(req)
  const noteEvents = extractAmoNoteEvents(body)
  const shouldIssue = shouldIssueGuestLinkFromAmoWebhook(body, query)
  const redirectUri = amoRedirectUri(req)
  const connection = await getAmoConnection(key.project.id)
  amoLog('webhook.body', {
    project: key.project.code,
    shouldIssue,
    hasConnection: Boolean(connection),
    events: noteEvents,
    payload: summarizeAmoWebhookBody(body),
  })

  if (!shouldIssue) {
    json(res, 200, { ok: true, status: 'success', accepted: true })
    if (connection) {
      void syncCallsFromNoteWebhook(key, connection, redirectUri, body, noteEvents).catch((err) => {
        amoError('webhook.sync', err, { project: key.project.code })
      })
    } else {
      amoWarn('webhook.no_connection', { project: key.project.code, payload: summarizeAmoWebhookBody(body) })
    }
    return true
  }

  if (!(await rateLimitLinks(req, res, json, key))) return true

  const parsed = await resolveGuestFields(key, body, query)
  if (!shouldIssueAfterPipelineCheck(parsed.pipelineId)) {
    amoLog('webhook.issue.skip_pipeline', {
      project: key.project.code,
      externalId: parsed.externalId || null,
      pipelineId: parsed.pipelineId || null,
      allowlist: String(process.env.AMO_ISSUE_PIPELINE_IDS || '') || null,
    })
    json(res, 200, { ok: true, status: 'success', accepted: true, skipped: 'pipeline_not_allowed' })
    if (connection && parsed.externalId) {
      // Звонки всё равно можно подтянуть к уже существующей ссылке — через note sync path.
    }
    return true
  }
  amoLog('webhook.issue.start', {
    project: key.project.code,
    name: parsed.name || null,
    externalId: parsed.externalId || null,
    category: parsed.category || null,
    statusId: parsed.statusId || null,
    pipelineId: parsed.pipelineId || null,
    hasConnection: Boolean(connection),
  })
  // TTS и URL в amo — после пайплайна (транскрипты → сводка → сборка).
  const issued = await issueForKey(key, parsed, { skipTts: true })
  if (issued.error) {
    amoLog('webhook.issue.fail', {
      project: key.project.code,
      error: issued.error,
      status: issued.status ?? null,
      name: parsed.name || null,
      externalId: parsed.externalId || null,
    })
    json(res, 200, { ok: false, status: 'fail', error: issued.error })
    return true
  }
  amoLog('webhook.issue.ok', {
    project: key.project.code,
    publicId: issued.link?.publicId || null,
    reused: Boolean(issued.reused),
    guestName: issued.link?.guestName || null,
    externalId: issued.link?.externalId || null,
    templateCode: issued.link?.templateCode || null,
  })
  if (issued.link?.id && parsed.statusId) {
    try {
      await recordLinkCrmStatus(issued.link.id, {
        statusId: parsed.statusId,
        pipelineId: parsed.pipelineId,
      })
    } catch (err) {
      console.error('amo crm status', key.project.code, err)
    }
  }

  let callsSynced = 0
  let callsSkipped = 0
  if (connection && parsed.externalId && issued.link?.id) {
    try {
      const calls = await syncCallsForLead({
        connection,
        redirectUri,
        projectId: key.project.id,
        leadId: parsed.externalId,
        linkId: issued.link.id,
      })
      callsSynced = calls.inserted?.length || 0
      callsSkipped = calls.skipped || 0
    } catch (err) {
      console.error('amo sync calls', key.project.code, err)
    }
  }
  if (
    connection &&
    (noteEvents.length > 0 ||
      extractLeadIdsFromNoteWebhook(body).length > 0 ||
      extractContactIdsFromNoteWebhook(body).length > 0)
  ) {
    try {
      const calls = await syncCallsFromNoteWebhook(key, connection, redirectUri, body, noteEvents)
      callsSynced += calls.inserted.length
      callsSkipped += calls.skipped
    } catch (err) {
      console.error('amo note calls', key.project.code, err)
    }
  }

  if (issued.link?.publicId) {
    schedulePresentationPipeline({
      project: key.project,
      publicId: issued.link.publicId,
      connection,
      redirectUri,
      leadId: parsed.externalId || issued.link.externalId || '',
    })
  }

  const payload = issuedPayload(key.project.code, issued)
  // Salesbot ждёт status=success; пайплайн идёт фоном, URL в CRM — позже.
  json(res, 200, {
    ...payload,
    status: 'success',
    pipeline: 'pending',
    amoUrlPending: true,
    ...(callsSynced || callsSkipped ? { callsSynced, callsSkipped } : {}),
  })
  return true
}

export async function handleV1Api(req, res, url, json, extras = {}) {
  if (AMO_CALLBACK.test(url)) {
    return handleAmoOAuthCallback(req, res)
  }
  if (amoTokenFrom(url, req).hit) {
    return handleAmoWebhook(req, res, url, json, extras)
  }

  const match = url.match(/^\/api\/v1\/projects\/([^/]+)\/links\/?$/)
  if (!match) return false
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed' })
    return true
  }
  const token = bearerToken(req)
  const key = await findApiKey(token)
  if (!(await rateLimitLinks(req, res, json, key))) return true
  if (!key) {
    json(res, 401, { error: 'unauthorized' })
    return true
  }
  const projectCode = decodeURIComponent(match[1])
  if (key.project.code !== projectCode) {
    json(res, 403, { error: 'key does not match project' })
    return true
  }
  const issued = await issueForKey(key, extras.body)
  if (issued.error) {
    json(res, issued.status, { error: issued.error })
    return true
  }
  json(res, 200, issuedPayload(key.project.code, issued))
  return true
}
