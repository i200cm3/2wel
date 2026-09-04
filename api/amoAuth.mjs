import crypto from 'node:crypto'
import { authEnv } from './auth.js'
import { loadEnv } from './env.js'
import { fetchWithTimeout } from './fetchTimeout.mjs'
import { listAmoConnections } from './amoConnections.mjs'
import { amoLog, amoWarn } from './amoLog.mjs'
import { phonesFromAmoContact } from './amoPhone.mjs'
import { guestBaseDomain } from './publicUrl.mjs'

const STATE_TTL_MS = 20 * 60 * 1000
const TOKEN_SKEW_MS = 60 * 1000
const AMO_HOST_RE = /^[a-z0-9][a-z0-9.-]*\.(amocrm\.ru|amocrm\.com|kommo\.com)$/i

export function amoEnv() {
  loadEnv()
  const clientId = String(process.env.AMO_CLIENT_ID ?? '').trim()
  const clientSecret = String(process.env.AMO_CLIENT_SECRET ?? '').trim()
  const redirectUri = String(process.env.AMO_REDIRECT_URI ?? '').trim().replace(/\/$/, '')
  return { clientId, clientSecret, redirectUri, configured: Boolean(clientId && clientSecret) }
}

export function publicOrigin(req) {
  loadEnv()
  const fromEnv = String(process.env.PUBLIC_ORIGIN ?? '').trim().replace(/\/$/, '')
  if (fromEnv) return fromEnv
  const raw = req?.headers?.host
  const host = Array.isArray(raw) ? raw[0] : raw
  if (host) {
    const protoHeader = req.headers?.['x-forwarded-proto']
    const protoRaw = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader
    const proto = String(protoRaw || 'http').split(',')[0].trim() || 'http'
    return `${proto}://${host}`
  }
  const domain = String(process.env.DOMAIN ?? '').trim().replace(/^https?:\/\//, '')
  if (domain) return `https://${domain}`
  return `https://${guestBaseDomain()}`
}

export function amoRedirectUri(req) {
  const env = amoEnv()
  if (env.redirectUri) return env.redirectUri
  return `${publicOrigin(req)}/api/v1/amocrm/oauth/callback`
}

export function amoWebhookUrl(origin, token) {
  return `${String(origin).replace(/\/$/, '')}/api/v1/amocrm/webhook/${token}`
}

export function normalizeAmoDomain(raw) {
  const host = String(raw ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .split('/')[0]
    .toLowerCase()
  if (!AMO_HOST_RE.test(host)) return ''
  return host
}

export function signAmoState(projectId, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ p: projectId, e: now + STATE_TTL_MS }), 'utf8').toString(
    'base64url',
  )
  const mac = crypto.createHmac('sha256', authEnv().secret).update(payload).digest('base64url')
  return `${payload}.${mac}`
}

export function verifyAmoState(state, now = Date.now()) {
  const raw = String(state ?? '')
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return { ok: false, error: 'Некорректный state' }
  const payload = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  const expected = crypto.createHmac('sha256', authEnv().secret).update(payload).digest('base64url')
  const left = Buffer.from(mac)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { ok: false, error: 'Некорректный state' }
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!data?.p || typeof data.p !== 'string') return { ok: false, error: 'Некорректный state' }
    if (Number(data.e) < now) return { ok: false, error: 'Срок подключения истёк, начните снова' }
    return { ok: true, projectId: data.p }
  } catch {
    return { ok: false, error: 'Некорректный state' }
  }
}

export function amoAuthorizeUrl(state) {
  const { clientId } = amoEnv()
  const url = new URL('https://www.amocrm.ru/oauth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('state', state)
  return url.toString()
}

async function readAmoJson(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { title: text.slice(0, 200) }
  }
}

function amoError(body, fallback) {
  return body?.detail || body?.hint || body?.title || fallback
}

export async function exchangeAmoCode({ code, baseDomain, redirectUri }) {
  const { clientId, clientSecret } = amoEnv()
  const res = await fetchWithTimeout(`https://${baseDomain}/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  const body = await readAmoJson(res)
  if (!res.ok || !body.access_token) {
    throw new Error(amoError(body, 'Не удалось получить токен amoCRM'))
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    tokenExpiresAt: new Date(Date.now() + Number(body.expires_in || 86400) * 1000).toISOString(),
  }
}

export async function refreshAmoTokens({ refreshToken, baseDomain, redirectUri }) {
  const { clientId, clientSecret } = amoEnv()
  const res = await fetchWithTimeout(`https://${baseDomain}/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      redirect_uri: redirectUri,
    }),
  })
  const body = await readAmoJson(res)
  if (!res.ok || !body.access_token) {
    throw new Error(amoError(body, 'Не удалось обновить токен amoCRM'))
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    tokenExpiresAt: new Date(Date.now() + Number(body.expires_in || 86400) * 1000).toISOString(),
  }
}

export async function amoApi(connection, path, { method = 'GET', body, redirectUri } = {}) {
  const started = Date.now()
  let status = 0
  let ok = false
  try {
    let access = connection.accessToken
    let refresh = connection.refreshToken
    let expires = connection.tokenExpiresAt
    const expired = new Date(expires).getTime() < Date.now() + TOKEN_SKEW_MS
    if (expired) {
      const next = await refreshAmoTokens({
        refreshToken: refresh,
        baseDomain: connection.baseDomain,
        redirectUri,
      })
      access = next.accessToken
      refresh = next.refreshToken
      expires = next.tokenExpiresAt
      connection.accessToken = next.accessToken
      connection.refreshToken = next.refreshToken
      connection.tokenExpiresAt = next.tokenExpiresAt
      if (typeof connection.projectId === 'string') {
        const { updateAmoTokens } = await import('./amoConnections.mjs')
        await updateAmoTokens(connection.projectId, next)
      }
    }

    const exec = (token) =>
      fetchWithTimeout(`https://${connection.baseDomain}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      })

    let res = await exec(access)
    if (res.status === 401) {
      const next = await refreshAmoTokens({
        refreshToken: refresh,
        baseDomain: connection.baseDomain,
        redirectUri,
      })
      access = next.accessToken
      connection.accessToken = next.accessToken
      connection.refreshToken = next.refreshToken
      connection.tokenExpiresAt = next.tokenExpiresAt
      if (typeof connection.projectId === 'string') {
        const { updateAmoTokens } = await import('./amoConnections.mjs')
        await updateAmoTokens(connection.projectId, next)
      }
      res = await exec(access)
    }
    status = res.status
    const json = await readAmoJson(res)
    if (!res.ok) {
      throw new Error(amoError(json, `amoCRM ${res.status}`))
    }
    ok = true
    return json
  } finally {
    const bucket = connection?.amoTimings
    if (Array.isArray(bucket)) {
      const shortPath = String(path || '').split('?')[0]
      bucket.push({
        method,
        path: shortPath.slice(0, 160),
        ms: Date.now() - started,
        status,
        ok,
      })
    }
  }
}

export function guestFirstNameFromContact(contact) {
  if (!contact || typeof contact !== 'object') return ''
  const first = String(contact.first_name ?? '').trim()
  if (first) return first.split(/\s+/)[0].slice(0, 80)
  const name = String(contact.name ?? '').trim()
  if (!name) return ''
  return name.split(/\s+/)[0].slice(0, 80)
}

const PRESENTATION_FIELD_NAMES = new Set(['ссылка для презентации', 'ссылка презентации'])
const fieldCache = new Map()

export function normalizeAmoFieldName(name) {
  return String(name ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

export function pickPresentationLinkField(fields) {
  const wanted = normalizeAmoFieldName(process.env.AMO_PRESENTATION_FIELD || '')
  const list = Array.isArray(fields) ? fields : []
  const matched = list.filter((field) => {
    const name = normalizeAmoFieldName(field?.name)
    if (wanted) return name === wanted
    return PRESENTATION_FIELD_NAMES.has(name)
  })
  if (!matched.length) return null
  const urlType = matched.find((field) => String(field.type || '').toLowerCase() === 'url')
  return urlType || matched[0]
}

async function listLeadCustomFields(connection, redirectUri) {
  const cached = fieldCache.get(connection.baseDomain)
  if (cached && cached.at > Date.now() - 10 * 60 * 1000) return cached.fields
  const body = await amoApi(connection, '/api/v4/leads/custom_fields?limit=250', { redirectUri })
  const fields = body?._embedded?.custom_fields
  const list = Array.isArray(fields) ? fields : []
  fieldCache.set(connection.baseDomain, { fields: list, at: Date.now() })
  return list
}

export async function writeAmoLeadPresentationUrl(connection, leadId, url, redirectUri) {
  const id = String(leadId ?? '').trim()
  const link = String(url ?? '').trim()
  if (!id) return { ok: false, error: 'no lead' }
  const field = pickPresentationLinkField(await listLeadCustomFields(connection, redirectUri))
  if (!field?.id) {
    console.warn('amo: нет поля «Ссылка для презентации»', connection.baseDomain)
    return { ok: false, error: 'field missing' }
  }
  await amoApi(connection, `/api/v4/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    redirectUri,
    body: {
      custom_fields_values: [{ field_id: field.id, values: [{ value: link }] }],
    },
  })
  return { ok: true, fieldId: field.id }
}

export async function clearAmoLeadPresentationUrl(connection, leadId, redirectUri) {
  return writeAmoLeadPresentationUrl(connection, leadId, '', redirectUri)
}

/** Чистый разбор ответа amo lead (+ контакт) → имя и статус. */
export function leadSnapshotFromAmo(lead, contact) {
  const statusRaw = lead?.status_id ?? lead?.statusId
  const pipelineRaw = lead?.pipeline_id ?? lead?.pipelineId
  return {
    name: guestFirstNameFromContact(contact),
    statusId: statusRaw != null && statusRaw !== '' ? String(statusRaw) : '',
    pipelineId: pipelineRaw != null && pipelineRaw !== '' ? String(pipelineRaw) : '',
    contactId: contact?.id != null ? String(contact.id) : '',
    phones: phonesFromAmoContact(contact),
  }
}

export async function fetchAmoLeadSnapshot(connection, leadId, redirectUri) {
  const id = String(leadId ?? '').trim()
  if (!id) return { name: '', statusId: '', pipelineId: '', contactId: '', phones: [] }
  const lead = await amoApi(connection, `/api/v4/leads/${encodeURIComponent(id)}?with=contacts`, {
    redirectUri,
  })
  const contacts = lead?._embedded?.contacts
  const list = Array.isArray(contacts) ? contacts : []
  const main = list.find((item) => item?.is_main) || list[0]
  const contactId = main?.id
  let contact = null
  if (contactId) {
    contact = await amoApi(connection, `/api/v4/contacts/${encodeURIComponent(contactId)}`, {
      redirectUri,
    })
  }
  return leadSnapshotFromAmo(lead, contact)
}

/** Воронки и статусы для UI маппинга шаблонов. */
export async function fetchAmoPipelines(connection, redirectUri) {
  const body = await amoApi(connection, '/api/v4/leads/pipelines', { redirectUri })
  const raw = body?._embedded?.pipelines
  const list = Array.isArray(raw) ? raw : []
  return list.map((pipe) => {
    const statuses = Array.isArray(pipe?._embedded?.statuses) ? pipe._embedded.statuses : []
    return {
      id: pipe?.id != null ? String(pipe.id) : '',
      name: String(pipe?.name ?? '').trim() || 'Воронка',
      statuses: statuses
        .map((st) => ({
          id: st?.id != null ? String(st.id) : '',
          name: String(st?.name ?? '').trim() || 'Статус',
        }))
        .filter((st) => st.id),
    }
  }).filter((pipe) => pipe.id)
}

export async function fetchAmoGuestName(connection, leadId, redirectUri) {
  const snap = await fetchAmoLeadSnapshot(connection, leadId, redirectUri)
  return snap.name
}

/** Sipuni часто пишет call_in/call_out в контакт — нужен note_contact.
 * status_lead — смена этапа: id сделки в теле, без параметров Salesbot. */
export const AMO_WEBHOOK_SETTINGS = ['note_lead', 'note_contact', 'status_lead']

export async function subscribeAmoWebhook(connection, destination, redirectUri) {
  return amoApi(connection, '/api/v4/webhooks', {
    method: 'POST',
    redirectUri,
    body: { destination, settings: AMO_WEBHOOK_SETTINGS },
  })
}

/** Обновляет подписку webhook (note_lead + note_contact у уже подключённых проектов). */
export async function ensureAmoWebhook(connection, destination, redirectUri) {
  if (!destination) return null
  return subscribeAmoWebhook(connection, destination, redirectUri)
}

export async function ensureAllAmoWebhooks(redirectUri) {
  const connections = await listAmoConnections()
  let ok = 0
  for (const connection of connections) {
    if (!connection?.webhookDestination) continue
    try {
      await ensureAmoWebhook(connection, connection.webhookDestination, redirectUri)
      amoLog('webhook.ensure', {
        project: connection.projectCode,
        destination: connection.webhookDestination,
      })
      ok += 1
    } catch (err) {
      amoWarn('webhook.ensure', {
        project: connection.projectCode,
        destination: connection.webhookDestination,
        error: err?.message || String(err),
      })
    }
  }
  if (connections.length) {
    amoLog('webhook.ensure.all', { ok, total: connections.length })
  }
  return ok
}

export async function unsubscribeAmoWebhook(connection, destination, redirectUri) {
  if (!destination) return
  try {
    await amoApi(connection, '/api/v4/webhooks', {
      method: 'DELETE',
      redirectUri,
      body: { destination },
    })
  } catch (err) {
    console.warn('amo webhook unsubscribe', err?.message || err)
  }
}

export function cabinetIntegrationsUrl(req, projectCode, query = '') {
  const q = query ? (query.startsWith('?') ? query : `?${query}`) : ''
  return `${publicOrigin(req)}/app/projects/${encodeURIComponent(projectCode)}/integrations${q}`
}
