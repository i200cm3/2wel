import { amoApi } from './amoAuth.mjs'
import { deleteLinkRawSource, insertLinkRawSources, listLinkRawSources, updateLinkAmoIdentity } from './links.mjs'
import { fetchWithTimeout } from './fetchTimeout.mjs'
import { amoError, amoLog, amoWarn } from './amoLog.mjs'
import {
  amoPhoneQueryVariants,
  normalizeAmoPhone,
  phonesFromAmoContact,
  phonesFromAmoNoteParams,
} from './amoPhone.mjs'
import { recordingUrlFromSource } from './recordingUrl.mjs'

export const AMO_NOTE_REF_PREFIX = 'amo:note:'
const CALL_NOTE_TYPES = new Set(['call_in', 'call_out'])
const RECORDING_PROBE_HEAD_TIMEOUT_MS = 1_500
const RECORDING_PROBE_TIMEOUT_MS = 4_000
const MAX_NOTE_PAGES = 10
const NOTE_FETCH_CONCURRENCY = 8
const RECORDING_PROBE_CONCURRENCY = 8
const NOTES_LIMIT = 250

function emptyTimings() {
  return {
    totalMs: 0,
    pruneMs: 0,
    fetchMs: 0,
    probeMs: 0,
    insertMs: 0,
    amoRequests: 0,
    amoMs: 0,
    amoSlowest: [],
    phases: [],
  }
}

function summarizeAmoTimings(requests) {
  const list = Array.isArray(requests) ? requests : []
  const sorted = [...list].sort((a, b) => b.ms - a.ms)
  return {
    amoRequests: list.length,
    amoMs: list.reduce((sum, item) => sum + (Number(item.ms) || 0), 0),
    amoSlowest: sorted.slice(0, 8).map((item) => ({
      method: item.method,
      path: item.path,
      ms: item.ms,
      status: item.status,
      ok: item.ok,
    })),
  }
}

export function amoNoteRef(noteId) {
  const id = String(noteId ?? '').trim()
  return id ? `${AMO_NOTE_REF_PREFIX}${id}` : ''
}

export function isAmoCallSourceRef(ref) {
  return String(ref ?? '').startsWith(AMO_NOTE_REF_PREFIX)
}

function asUnixIso(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  const ms = n > 1e12 ? n : n * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function noteCreatedAtMs(note) {
  const n = Number(note?.created_at)
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 1e12 ? n : n * 1000
}

const RECORDING_ERROR_SNIPPETS = [
  'user is not licensed',
  'not licensed',
  'access denied',
  'forbidden',
]

export const TRANSIENT_RECORDING_PROBE_REASONS = new Set(['network-error'])

/** @deprecated use recordingProbeAvailability */
export function isDefinitiveRecordingUnavailable(reason) {
  return recordingProbeAvailability({ ok: false, reason }) === 'unavailable'
}

/** available | unavailable | null (сеть — не скрываем звонок) */
export function recordingProbeAvailability(probe) {
  if (!probe?.ok) {
    const reason = String(probe?.reason ?? '').trim()
    if (TRANSIENT_RECORDING_PROBE_REASONS.has(reason)) return null
    if (!reason && probe?.status === 0) return null
    return 'unavailable'
  }
  return 'available'
}

export function recordingContentTypeLooksValid(contentType) {
  const ct = String(contentType ?? '').toLowerCase()
  if (ct.startsWith('audio/')) return true
  if (ct.includes('octet-stream')) return true
  if (ct.startsWith('text/') || ct.includes('html')) return false
  return false
}

export function recordingContentLooksValid(contentType, bodySnippet) {
  const ct = String(contentType ?? '').toLowerCase()
  const body = String(bodySnippet ?? '')
  const lower = body.trim().toLowerCase()
  if (RECORDING_ERROR_SNIPPETS.some((item) => lower.includes(item))) return false
  if (recordingContentTypeLooksValid(ct)) {
    if (ct.startsWith('text/') || ct.includes('html')) return false
    return true
  }
  if (lower.startsWith('id3') || body.includes('\xff\xfb')) return true
  if (ct.startsWith('text/') || ct.includes('html')) return false
  return false
}

function probeFailureReason(contentType, bodySnippet) {
  const lower = String(bodySnippet ?? '').trim().toLowerCase()
  if (lower.includes('user is not licensed')) return 'sipuni-not-licensed'
  if (lower.includes('not licensed')) return 'not-licensed'
  const ct = String(contentType ?? '').toLowerCase()
  if (ct.startsWith('text/') || ct.includes('html')) return 'not-a-recording'
  return lower.slice(0, 120) || 'unavailable'
}

async function readResponseSnippet(res) {
  try {
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.subarray(0, 512).toString('utf8')
  } catch {
    return ''
  }
}

export async function probeRecordingUrl(url) {
  const target = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(target)) return { ok: false, status: 0, reason: 'invalid-url' }
  try {
    let headType = ''
    try {
      const head = await fetchWithTimeout(
        target,
        { method: 'HEAD', redirect: 'follow' },
        RECORDING_PROBE_HEAD_TIMEOUT_MS,
      )
      headType = head.headers.get('content-type') ?? ''
      if ((head.ok || head.status === 206) && recordingContentTypeLooksValid(headType)) {
        return { ok: true, status: head.status }
      }
    } catch (err) {
      if (err?.name !== 'TimeoutError') throw err
    }

    const res = await fetchWithTimeout(
      target,
      { method: 'GET', headers: { Range: 'bytes=0-511' }, redirect: 'follow' },
      RECORDING_PROBE_TIMEOUT_MS,
    )
    const contentType = res.headers.get('content-type') ?? headType
    const snippet = await readResponseSnippet(res)
    const ok = (res.ok || res.status === 206) && recordingContentLooksValid(contentType, snippet)
    return {
      ok,
      status: res.status,
      reason: ok ? undefined : probeFailureReason(contentType, snippet),
    }
  } catch (err) {
    if (err?.name === 'TimeoutError') return { ok: false, status: 0, reason: 'timeout' }
    return { ok: false, status: 0, reason: 'network-error' }
  }
}

/** @param {string[]} urls */
export async function probeRecordingUrlsDetailed(urls) {
  const list = [...new Set(Array.isArray(urls) ? urls.map((item) => String(item ?? '').trim()).filter(Boolean) : [])]
  const results = []
  for (let i = 0; i < list.length; i += RECORDING_PROBE_CONCURRENCY) {
    const batch = list.slice(i, i + RECORDING_PROBE_CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const probe = await probeRecordingUrl(url)
        return {
          url,
          ok: probe.ok,
          status: probe.status,
          reason: probe.reason ?? null,
        }
      }),
    )
    results.push(...batchResults)
  }
  return results
}

async function probeRecordingUrls(urls) {
  const list = [...new Set(Array.isArray(urls) ? urls.map((item) => String(item ?? '').trim()).filter(Boolean) : [])]
  const ok = new Set()
  for (let i = 0; i < list.length; i += RECORDING_PROBE_CONCURRENCY) {
    const batch = list.slice(i, i + RECORDING_PROBE_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (url) => {
        const probe = await probeRecordingUrl(url)
        return probe.ok ? url : ''
      }),
    )
    for (const url of results) {
      if (url) ok.add(url)
    }
  }
  return ok
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  if (!total) return ''
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function normalizeNoteParams(raw) {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return normalizeNoteParams(parsed)
    } catch {
      const text = raw.trim()
      if (/^https?:\/\//i.test(text)) return { link: text }
      return {}
    }
  }
  if (Array.isArray(raw)) {
    const out = {}
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const key = String(item.name ?? item.param ?? item.code ?? '').trim()
      if (key) out[key] = item.value
    }
    return out
  }
  return typeof raw === 'object' ? raw : {}
}

export function phonesFromAmoCallNote(note) {
  return phonesFromAmoNoteParams(normalizeNoteParams(note?.params), note?.text)
}

function pickRecordingUrl(params) {
  const normalized = normalizeNoteParams(params)
  const candidates = [
    normalized.link,
    normalized.LINK,
    normalized.recording,
    normalized.record,
    normalized.record_link,
    normalized.audio,
    normalized.file,
  ]
  for (const item of candidates) {
    const url = String(item ?? '').trim()
    if (/^https?:\/\//i.test(url)) return url
  }
  for (const value of Object.values(normalized)) {
    const url = String(value ?? '').trim()
    if (/^https?:\/\//i.test(url) && /record|sipuni|\.mp3|\.wav/i.test(url)) return url
  }
  return ''
}

function extractRecordingFromNote(note) {
  const url = pickRecordingUrl(note?.params)
  if (url) return url
  const text = String(note?.text ?? '').trim()
  const match = text.match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return ''
  const candidate = match[0]
  const noteType = String(note?.note_type ?? '').toLowerCase()
  if (CALL_NOTE_TYPES.has(noteType)) return candidate
  if (/record|sipuni|\.mp3|\.wav|\.ogg/i.test(candidate)) return candidate
  return ''
}

function summarizeNoteInspect(notes) {
  const list = Array.isArray(notes) ? notes : []
  const byReason = {}
  for (const item of list) {
    const key = item?.ok ? 'ok' : String(item?.reason || 'other')
    byReason[key] = (byReason[key] || 0) + 1
  }
  return {
    ...byReason,
    latestOk: list.filter((item) => item?.ok).slice(-3).map((item) => item.noteId),
  }
}

export function inspectCallNoteFromAmo(note) {
  const noteId = note?.id != null ? String(note.id) : ''
  const noteType = String(note?.note_type ?? '').toLowerCase()
  const entityType = String(note?.entity_type ?? note?.element_type ?? '').toLowerCase()
  const entityId = String(note?.entity_id ?? note?.element_id ?? '').trim()
  if (!CALL_NOTE_TYPES.has(noteType)) {
    return { ok: false, reason: 'not_call', noteId, noteType, entityType, entityId }
  }
  const recordingUrl = extractRecordingFromNote(note)
  if (!recordingUrl) {
    const params = normalizeNoteParams(note?.params)
    return {
      ok: false,
      reason: 'no_recording_url',
      noteId,
      noteType,
      entityType,
      entityId,
      paramKeys: Object.keys(params),
      hasText: Boolean(String(note?.text ?? '').trim()),
    }
  }
  return { ok: true, reason: 'ok', noteId, noteType, entityType, entityId }
}

/** Разбор note amo call_in/call_out → запись для link_raw_sources. */
export function parseCallNoteFromAmo(note) {
  const noteType = String(note?.note_type ?? '').toLowerCase()
  if (!CALL_NOTE_TYPES.has(noteType)) return null

  const recordingUrl = extractRecordingFromNote(note)
  if (!recordingUrl) return null

  const params = normalizeNoteParams(note?.params)
  const noteId = note?.id != null ? String(note.id) : ''
  const direction = noteType === 'call_in' ? 'in' : 'out'
  const directionLabel = direction === 'in' ? 'Входящий' : 'Исходящий'
  const duration = formatDuration(params.duration)
  const durationSec = Math.max(0, Math.floor(Number(params.duration) || 0))
  const phone = String(params.phone ?? '').trim()

  let title = directionLabel
  if (duration) title += ` · ${duration}`
  if (phone) title += ` · ${phone}`

  return {
    noteId,
    kind: 'call_transcript',
    title: title.slice(0, 200),
    body: recordingUrl,
    externalRef: noteId ? amoNoteRef(noteId) : recordingUrl.slice(0, 256),
    capturedAt: asUnixIso(note?.created_at),
    meta: durationSec > 0 ? { durationSec } : null,
  }
}

function callNoteTypeQuery() {
  return ['call_in', 'call_out']
    .map((type, index) => `filter[note_type][${index}]=${encodeURIComponent(type)}`)
    .join('&')
}

function noteIdFilterQuery(noteIds) {
  return noteIds
    .map((id, index) => `filter[id][${index}]=${encodeURIComponent(id)}`)
    .join('&')
}

function isCallNote(note) {
  const noteType = String(note?.note_type ?? '').toLowerCase()
  return CALL_NOTE_TYPES.has(noteType)
}

function mergeNotes(target, notes) {
  for (const note of Array.isArray(notes) ? notes : []) {
    const noteId = note?.id != null ? String(note.id) : ''
    if (!noteId || target.has(noteId)) continue
    target.set(noteId, note)
  }
}

function mergeCallNotes(target, notes) {
  mergeNotes(target, (Array.isArray(notes) ? notes : []).filter(isCallNote))
}

function isLeadLinkType(type) {
  const t = String(type ?? '').toLowerCase()
  return t === 'leads' || t === 'lead' || t === '2'
}

/** Сделки из GET /contacts/{id}/links (amo иногда шлёт to_entity_type числом 2). */
export function leadIdsFromAmoLinks(body) {
  const links = Array.isArray(body?._embedded?.links) ? body._embedded.links : []
  const out = []
  for (const link of links) {
    const type = link?.to_entity_type ?? link?.to_entity ?? link?.entity_type
    if (!isLeadLinkType(type)) continue
    const id = link?.to_entity_id ?? link?.entity_id
    if (id != null && String(id).trim()) out.push(String(id).trim())
  }
  return [...new Set(out)]
}

export function leadIdsFromEmbeddedLeads(body) {
  const leads = Array.isArray(body?._embedded?.leads) ? body._embedded.leads : []
  return [...new Set(leads.map((item) => (item?.id != null ? String(item.id).trim() : '')).filter(Boolean))]
}

async function fetchEntityCallNotesPages(connection, collection, entityId, redirectUri, { maxPages = MAX_NOTE_PAGES } = {}) {
  const id = String(entityId ?? '').trim()
  if (!id) return []
  const typeQuery = callNoteTypeQuery()
  const all = []
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await amoApi(
      connection,
      `/api/v4/${collection}/${encodeURIComponent(id)}/notes?${typeQuery}&limit=${NOTES_LIMIT}&page=${page}`,
      { redirectUri },
    )
    const notes = body?._embedded?.notes
    const list = Array.isArray(notes) ? notes : []
    all.push(...list)
    if (list.length < NOTES_LIMIT) break
  }
  return all
}

async function fetchNotesByIdsFromCollection(connection, collection, noteIds, redirectUri) {
  const ids = [...new Set(noteIds.map((item) => String(item ?? '').trim()).filter(Boolean))]
  if (!ids.length) return []
  const out = []
  const chunkSize = 50
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    try {
      const body = await amoApi(
        connection,
        `/api/v4/${collection}/notes?${noteIdFilterQuery(chunk)}&limit=${Math.min(NOTES_LIMIT, chunk.length)}`,
        { redirectUri },
      )
      const list = Array.isArray(body?._embedded?.notes) ? body._embedded.notes : []
      out.push(...list)
    } catch (err) {
      console.error('amo fetch notes by ids', collection, err?.message || err)
    }
  }
  return out
}

/** Заметки по id без фильтра call — чтобы достать entity_id из webhook-заглушки. */
export async function fetchNotesByIds(connection, noteIds, redirectUri) {
  const ids = [...new Set(Array.isArray(noteIds) ? noteIds.map((item) => String(item ?? '').trim()).filter(Boolean) : [])]
  if (!ids.length) return []

  const byKey = new Map()
  mergeNotes(byKey, await fetchNotesByIdsFromCollection(connection, 'leads', ids, redirectUri))

  const missing = ids.filter((id) => !byKey.has(id))
  if (missing.length) {
    mergeNotes(byKey, await fetchNotesByIdsFromCollection(connection, 'contacts', missing, redirectUri))
  }

  const stillMissing = ids.filter((id) => !byKey.has(id))
  if (stillMissing.length) {
    for (let i = 0; i < stillMissing.length; i += NOTE_FETCH_CONCURRENCY) {
      const batch = stillMissing.slice(i, i + NOTE_FETCH_CONCURRENCY)
      const notes = await Promise.all(batch.map((noteId) => fetchAmoNote(connection, noteId, redirectUri)))
      mergeNotes(byKey, notes.filter(Boolean))
    }
  }

  return [...byKey.values()]
}

/** Точечная загрузка call-notes по id (leads, затем contacts для недостающих). */
export async function fetchCallNotesByIds(connection, noteIds, redirectUri) {
  return (await fetchNotesByIds(connection, noteIds, redirectUri)).filter(isCallNote)
}

export function entityIdsFromAmoNotes(notes) {
  const leadIds = new Set()
  const contactIds = new Set()
  for (const note of Array.isArray(notes) ? notes : []) {
    const type = String(note?.entity_type ?? note?.element_type ?? '').toLowerCase()
    const id = String(note?.entity_id ?? note?.element_id ?? '').trim()
    if (!id) continue
    if (type === 'leads' || type === 'lead' || type === '2') leadIds.add(id)
    else if (type === 'contacts' || type === 'contact' || type === '1') contactIds.add(id)
  }
  return { leadIds: [...leadIds], contactIds: [...contactIds] }
}

export async function fetchAmoNote(connection, noteId, redirectUri) {
  const id = String(noteId ?? '').trim()
  if (!id) return null
  for (const collection of ['leads', 'contacts']) {
    try {
      const note = await amoApi(connection, `/api/v4/${collection}/notes/${encodeURIComponent(id)}`, {
        redirectUri,
      })
      if (note?.id != null) return note
    } catch {
      // пробуем другую сущность
    }
  }
  return null
}

async function fetchLeadContactIds(connection, leadId, redirectUri) {
  const id = String(leadId ?? '').trim()
  if (!id) return []
  const lead = await amoApi(connection, `/api/v4/leads/${encodeURIComponent(id)}?with=contacts`, {
    redirectUri,
  })
  const contacts = lead?._embedded?.contacts
  const list = Array.isArray(contacts) ? contacts : []
  return list.map((item) => (item?.id != null ? String(item.id) : '')).filter(Boolean)
}

/** Сделки, связанные с контактом (Sipuni пишет звонок в контакт). */
export async function fetchLeadIdsForContact(connection, contactId, redirectUri) {
  const id = String(contactId ?? '').trim()
  if (!id) return []
  const collected = new Set()

  try {
    const body = await amoApi(
      connection,
      `/api/v4/contacts/${encodeURIComponent(id)}/links?filter[to_entity_type]=leads&limit=50`,
      { redirectUri },
    )
    for (const leadId of leadIdsFromAmoLinks(body)) collected.add(leadId)
  } catch (err) {
    console.error('amo contact links', id, err?.message || err)
  }

  try {
    const body = await amoApi(connection, `/api/v4/contacts/${encodeURIComponent(id)}?with=leads`, {
      redirectUri,
    })
    for (const leadId of leadIdsFromEmbeddedLeads(body)) collected.add(leadId)
  } catch (err) {
    console.error('amo contact with leads', id, err?.message || err)
  }

  return [...collected]
}

export async function fetchAmoContact(connection, contactId, redirectUri) {
  const id = String(contactId ?? '').trim()
  if (!id) return null
  try {
    return await amoApi(connection, `/api/v4/contacts/${encodeURIComponent(id)}`, { redirectUri })
  } catch (err) {
    console.error('amo contact', id, err?.message || err)
    return null
  }
}

/** Контакты amo с тем же телефоном — дубли после звонка на номер компании. */
export async function fetchContactsByPhones(connection, phones, redirectUri) {
  const normalized = [...new Set((Array.isArray(phones) ? phones : []).map(normalizeAmoPhone).filter(Boolean))]
  const byId = new Map()
  for (const phone of normalized) {
    const variants = amoPhoneQueryVariants(phone)
    for (const q of variants.slice(0, 2)) {
      try {
        const body = await amoApi(
          connection,
          `/api/v4/contacts?query=${encodeURIComponent(q)}&limit=50`,
          { redirectUri },
        )
        const list = Array.isArray(body?._embedded?.contacts) ? body._embedded.contacts : []
        for (const row of list) {
          const id = row?.id != null ? String(row.id) : ''
          if (!id || byId.has(id)) continue
          let found = phonesFromAmoContact(row)
          if (!found.length) {
            const full = await fetchAmoContact(connection, id, redirectUri)
            found = phonesFromAmoContact(full)
          }
          if (found.includes(phone) || found.some((item) => normalized.includes(item))) {
            byId.set(id, { id, phones: found })
          }
        }
      } catch (err) {
        console.error('amo contacts by phone', q, err?.message || err)
      }
    }
  }
  return [...byId.values()]
}

async function expandContactIdsByPhone(connection, leadId, extraContactIds, redirectUri) {
  const extra = (Array.isArray(extraContactIds) ? extraContactIds : [])
    .map((id) => String(id ?? '').trim())
    .filter(Boolean)
  const seed = new Set(extra)
  const leadContacts = leadId ? await fetchLeadContactIds(connection, leadId, redirectUri) : []
  for (const id of leadContacts) seed.add(id)
  const phones = new Set()
  for (const contactId of [...seed].slice(0, 8)) {
    const contact = await fetchAmoContact(connection, contactId, redirectUri)
    for (const phone of phonesFromAmoContact(contact)) phones.add(phone)
  }
  if (phones.size) {
    const found = await fetchContactsByPhones(connection, [...phones], redirectUri)
    for (const row of found) {
      seed.add(row.id)
      for (const phone of row.phones || []) phones.add(phone)
    }
  }
  return {
    contactIds: [...seed],
    phones: [...phones],
    mainContactId: leadContacts[0] || extra[0] || '',
  }
}

/** Все звонки по сделке и привязанным контактам (Sipuni часто пишет в контакт). */
export async function fetchAmoLeadCallNotes(connection, leadId, redirectUri, options = {}) {
  const id = String(leadId ?? '').trim()
  const extraContactIds = [
    ...new Set(
      (Array.isArray(options.extraContactIds) ? options.extraContactIds : [])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean),
    ),
  ]
  const { noteIds = null } = options
  const byKey = new Map()

  const explicitIds = Array.isArray(noteIds)
    ? noteIds.map((item) => String(item ?? '').trim()).filter(Boolean)
    : []
  if (explicitIds.length) {
    mergeCallNotes(byKey, await fetchCallNotesByIds(connection, explicitIds, redirectUri))
    return [...byKey.values()]
  }

  const [leadNotes, leadContactIds] = id
    ? await Promise.all([
        fetchEntityCallNotesPages(connection, 'leads', id, redirectUri),
        fetchLeadContactIds(connection, id, redirectUri),
      ])
    : [[], []]
  mergeCallNotes(byKey, leadNotes)

  const contactIds = [...new Set([...leadContactIds, ...extraContactIds])]
  if (contactIds.length) {
    const contactNoteLists = await Promise.all(
      contactIds.map((contactId) => fetchEntityCallNotesPages(connection, 'contacts', contactId, redirectUri)),
    )
    for (const contactNotes of contactNoteLists) mergeCallNotes(byKey, contactNotes)
  }

  return [...byKey.values()]
}

/**
 * @param {unknown[]} notes
 * @param {{ requireLive?: boolean }} [options]
 * requireLive=false — сохранить URL без probe (webhook: запись Sipuni может ещё доезжать).
 */
export async function callNotesToAvailableSources(notes, options = {}) {
  const requireLive = options.requireLive !== false
  const parsed = []
  const seen = new Set()
  for (const note of Array.isArray(notes) ? notes : []) {
    const item = parseCallNoteFromAmo(note)
    if (!item?.body) continue
    const key = item.externalRef || item.body
    if (!key || seen.has(key)) continue
    seen.add(key)
    parsed.push(item)
  }

  if (!requireLive) {
    return {
      sources: parsed,
      withRecording: parsed.length,
      recordingUnavailable: 0,
    }
  }

  const liveUrls = await probeRecordingUrls(parsed.map((item) => item.body))
  const available = parsed.filter((item) => liveUrls.has(item.body))
  return {
    sources: available,
    withRecording: parsed.length,
    recordingUnavailable: Math.max(0, parsed.length - available.length),
  }
}

export async function pruneUnavailableAmoCalls(linkId) {
  const lid = String(linkId ?? '').trim()
  if (!lid) return { pruned: 0 }

  const sources = await listLinkRawSources(lid)
  const amoCalls = sources.filter((source) => isAmoCallSourceRef(source.externalRef))
  if (!amoCalls.length) return { pruned: 0 }

  const urls = amoCalls.map((source) => recordingUrlFromSource(source)).filter(Boolean)
  const liveUrls = await probeRecordingUrls(urls)

  let pruned = 0
  for (const source of amoCalls) {
    const url = recordingUrlFromSource(source)
    if (!url || liveUrls.has(url)) continue
    if (await deleteLinkRawSource(lid, source.id)) pruned += 1
  }
  return { pruned }
}

/**
 * Сохраняет звонки amo в link_raw_sources (дедуп по amo:note:{id}).
 * extraContactIds — дубли контакта с тем же телефоном (звонок на номер компании).
 * @param {{ prune?: boolean, requireLive?: boolean, noteIds?: string[] | null, extraContactIds?: string[] }} opts
 */
export async function syncAmoCallsToLink({
  connection,
  redirectUri,
  linkId,
  leadId,
  noteIds = null,
  prune = false,
  requireLive = false,
  extraContactIds = [],
}) {
  const lid = String(linkId ?? '').trim()
  const lead = String(leadId ?? '').trim()
  const timings = emptyTimings()
  const started = Date.now()
  if (!connection.amoTimings) connection.amoTimings = []

  if (!lid || !connection || (!lead && !(extraContactIds || []).length)) {
    amoLog('sync.skip', { reason: 'missing_args', linkId: lid || null, leadId: lead || null, hasConnection: Boolean(connection) })
    return {
      inserted: [],
      skipped: 0,
      found: 0,
      withRecording: 0,
      matched: 0,
      pruned: 0,
      recordingUnavailable: 0,
      notes: [],
      timings,
    }
  }

  const ids = Array.isArray(noteIds) ? noteIds.map((item) => String(item ?? '').trim()).filter(Boolean) : []
  const shouldPrune = prune && !ids.length
  const liveRequired = requireLive

  let removed = { pruned: 0 }
  if (shouldPrune) {
    const t0 = Date.now()
    removed = await pruneUnavailableAmoCalls(lid)
    timings.pruneMs = Date.now() - t0
    timings.phases.push({ name: 'prune', ms: timings.pruneMs, pruned: removed.pruned })
  }

  let expanded = { contactIds: extraContactIds, phones: [], mainContactId: '' }
  if (!ids.length) {
    try {
      const tExpand = Date.now()
      expanded = await expandContactIdsByPhone(connection, lead, extraContactIds, redirectUri)
      timings.phases.push({ name: 'expand_contacts', ms: Date.now() - tExpand, contacts: expanded.contactIds.length })
    } catch (err) {
      amoError('sync.expand_contacts', err, { leadId: lead, linkId: lid })
    }
  }

  let notes = []
  try {
    const t0 = Date.now()
    notes = await fetchAmoLeadCallNotes(connection, lead, redirectUri, {
      noteIds: ids.length ? ids : null,
      extraContactIds: expanded.contactIds,
    })
    timings.fetchMs = Date.now() - t0
    timings.phases.push({
      name: 'fetch_notes',
      ms: timings.fetchMs,
      notes: notes.length,
      noteIds: ids.length || undefined,
    })
  } catch (err) {
    amoError('sync.fetch', err, { leadId: lead, linkId: lid })
    Object.assign(timings, summarizeAmoTimings(connection.amoTimings))
    timings.totalMs = Date.now() - started
    return {
      inserted: [],
      skipped: 0,
      found: 0,
      withRecording: 0,
      matched: 0,
      pruned: removed.pruned,
      recordingUnavailable: 0,
      notes: [],
      error: err?.message || String(err),
      timings,
    }
  }

  const noteInspect = notes.map((note) => inspectCallNoteFromAmo(note))
  const tProbe = Date.now()
  const { sources, withRecording, recordingUnavailable } = await callNotesToAvailableSources(notes, {
    requireLive: liveRequired,
  })
  timings.probeMs = Date.now() - tProbe
  timings.phases.push({
    name: liveRequired ? 'probe_recordings' : 'skip_probe',
    ms: timings.probeMs,
    withRecording,
    recordingUnavailable,
  })

  const tInsert = Date.now()
  const inserted = await insertLinkRawSources(lid, sources, { skipDup: true })
  timings.insertMs = Date.now() - tInsert
  timings.phases.push({ name: 'insert', ms: timings.insertMs, inserted: inserted.length })

  try {
    await updateLinkAmoIdentity(lid, {
      contactId: expanded.mainContactId,
      phones: [...expanded.phones, ...notes.flatMap(phonesFromAmoCallNote)],
    })
  } catch (err) {
    amoError('sync.identity', err, { linkId: lid })
  }

  Object.assign(timings, summarizeAmoTimings(connection.amoTimings))
  timings.totalMs = Date.now() - started
  amoLog('sync.result', {
    leadId: lead,
    linkId: lid,
    extraContacts: expanded.contactIds.length,
    found: notes.filter(isCallNote).length,
    withRecording,
    matched: sources.length,
    inserted: inserted.length,
    skipped: Math.max(0, sources.length - inserted.length),
    notes: summarizeNoteInspect(noteInspect),
    ms: timings.totalMs,
  })

  return {
    inserted,
    skipped: Math.max(0, sources.length - inserted.length),
    found: notes.filter(isCallNote).length,
    withRecording,
    matched: sources.length,
    pruned: removed.pruned,
    recordingUnavailable,
    notes: noteInspect,
    timings,
  }
}
