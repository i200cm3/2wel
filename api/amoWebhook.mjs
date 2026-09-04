/**
 * Разбор входящего webhook amoCRM / Salesbot → поля выдачи ссылки.
 * Ключ в URL, не в Authorization: блок «Отправить webhook» заголовки не ставит.
 */

import { phonesFromAmoNoteParams } from './amoPhone.mjs'

const NAME_KEYS = [
  'name',
  'guestName',
  'guest_name',
  'first_name',
  'firstName',
  'contact_name',
  'contactName',
  'contact.name',
  'contact.first_name',
]

const ID_KEYS = [
  'externalId',
  'external_id',
  'lead_id',
  'leadId',
  'lead.id',
  'entity_id',
  'entityId',
]

const CATEGORY_KEYS = ['category', 'template', 'templateCode', 'template_code']

function asText(value) {
  if (value == null) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object' && !Array.isArray(value)) {
    return asText(value.name ?? value.first_name ?? value.firstName ?? '')
  }
  return ''
}

function firstWord(full) {
  const text = asText(full)
  if (!text) return ''
  return text.split(/\s+/)[0].slice(0, 80)
}

function pickFrom(record, keys, map = asText) {
  if (!record || typeof record !== 'object') return ''
  for (const key of keys) {
    const got = map(record[key])
    if (got) return got
  }
  return ''
}

function firstRow(group) {
  if (!group) return null
  if (Array.isArray(group)) return group[0] ?? null
  if (typeof group !== 'object') return null
  for (const action of ['status', 'add', 'update', 'responsible', 'note']) {
    const rows = group[action]
    if (Array.isArray(rows) && rows[0]) return rows[0]
    if (rows && typeof rows === 'object' && rows[0]) return rows[0]
  }
  if (group[0]) return group[0]
  return null
}

/** Строка сделки для выдачи ссылки — без leads.note (это звонки/примечания). */
function leadRowForGuestLink(group) {
  if (!group) return null
  if (Array.isArray(group)) return group[0] ?? null
  if (typeof group !== 'object') return null
  for (const action of ['status', 'add', 'update', 'responsible']) {
    const rows = group[action]
    if (Array.isArray(rows) && rows[0]) return rows[0]
    if (rows && typeof rows === 'object' && rows.id) return rows
  }
  return null
}

function unwrapData(data) {
  if (!data) return {}
  if (Array.isArray(data)) {
    const merged = {}
    for (const item of data) {
      if (item && typeof item === 'object' && !Array.isArray(item)) Object.assign(merged, item)
      else if (typeof item === 'string' && item.trim()) merged.name = merged.name || item.trim()
    }
    return merged
  }
  if (typeof data === 'object') return data
  if (typeof data === 'string') return { name: data }
  return {}
}

export function decodeJwtPayload(token) {
  const raw = String(token ?? '')
  const parts = raw.split('.')
  if (parts.length < 2) return null
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=')
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const payload = JSON.parse(json)
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

/** PHP-style leads[status][0][id]=… → вложенный объект. */
export function parseNestedForm(text) {
  const out = {}
  const params = new URLSearchParams(String(text ?? ''))
  let n = 0
  for (const [rawKey, value] of params) {
    n += 1
    if (n > 400) break
    assignBracket(out, rawKey, value)
  }
  return out
}

function assignBracket(root, rawKey, value) {
  const parts = []
  const re = /([^[\]]+)|\[([^[\]]*)\]/g
  let match
  while ((match = re.exec(rawKey))) {
    const part = match[1] ?? match[2]
    if (part !== undefined && part !== '') parts.push(part)
  }
  if (!parts.length) return
  let cur = root
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]
    const next = parts[i + 1]
    const nextIndex = /^\d+$/.test(next)
    if (cur[key] == null) cur[key] = nextIndex ? [] : {}
    if (typeof cur[key] !== 'object') cur[key] = nextIndex ? [] : {}
    cur = cur[key]
  }
  cur[parts[parts.length - 1]] = value
}

export function parseV1Body(raw, contentType) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? '')
  if (!text.trim()) return { ok: true, body: {} }
  const type = String(contentType || '').toLowerCase()
  const trimmed = text.trim()
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[')
  const looksForm = type.includes('x-www-form-urlencoded') || (!looksJson && trimmed.includes('='))
  if (type.includes('json') || looksJson) {
    try {
      const body = JSON.parse(trimmed)
      if (body && typeof body === 'object') return { ok: true, body }
      return { ok: false, error: 'invalid json' }
    } catch {
      return { ok: false, error: 'invalid json' }
    }
  }
  if (looksForm) return { ok: true, body: parseNestedForm(text) }
  return { ok: false, error: 'invalid json' }
}

/**
 * @param {object} body
 * @param {Record<string, string>} query
 * @param {{ allowLeadName?: boolean }} [opts]
 */
export function extractAmoGuestLink(body, query = {}, opts = {}) {
  const allowLeadName = opts.allowLeadName !== false
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const data = unwrapData(payload.data)
  const jwt = decodeJwtPayload(payload.token)
  const lead = leadRowForGuestLink(payload.leads)
  const contact = firstRow(payload.contacts)

  const queryName = asText(query.name)
  const dataName = pickFrom(data, NAME_KEYS, firstWord) || firstWord(data.contact)
  const jwtName = jwt ? pickFrom(jwt, NAME_KEYS, firstWord) || firstWord(jwt.contact) : ''
  const contactName = firstWord(contact)
  const leadName = allowLeadName ? firstWord(lead) : ''

  const name = firstWord(queryName) || dataName || jwtName || contactName || leadName

  const queryExt = asText(query.externalId || query.external_id)
  const dataId = pickFrom(data, ID_KEYS)
  const jwtId = jwt ? pickFrom(jwt, ['lead_id', 'leadId', 'entity_id', 'entityId']) : ''
  const leadId = asText(lead?.id)
  const contactId = asText(contact?.id)
  const externalId = (queryExt || dataId || jwtId || leadId || (dataId ? '' : contactId)).slice(0, 128)

  const category = asText(
    query.category || pickFrom(data, CATEGORY_KEYS) || pickFrom(payload, CATEGORY_KEYS),
  )

  const statusId = asText(
    lead?.status_id ??
      lead?.statusId ??
      data.status_id ??
      data.statusId ??
      query.status_id ??
      query.statusId,
  ).slice(0, 64)
  const pipelineId = asText(
    lead?.pipeline_id ??
      lead?.pipelineId ??
      data.pipeline_id ??
      data.pipelineId ??
      query.pipeline_id ??
      query.pipelineId,
  ).slice(0, 64)

  return { name, category, externalId, statusId, pipelineId }
}

function noteRowsFromGroup(group) {
  if (!group || typeof group !== 'object') return []
  const out = []
  for (const action of ['add', 'update', 'note']) {
    const rows = group[action]
    if (Array.isArray(rows)) out.push(...rows)
    else if (rows && typeof rows === 'object' && (rows.id || rows.note)) out.push(rows)
  }
  return out
}

function asRowList(group) {
  if (!group) return []
  if (Array.isArray(group)) return group
  if (typeof group === 'object') return [group]
  return []
}

/** amo/Kommo: leads.note[0].note = { id: noteId, element_id: leadId }. */
function innerNote(row) {
  if (!row || typeof row !== 'object') return null
  const nested = row.note
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested
  return null
}

function noteEntityType(row) {
  return asText(row?.entity_type ?? row?.element_type ?? row?.entity).toLowerCase()
}

function isLeadEntityType(type) {
  return type === 'lead' || type === 'leads' || type === '2'
}

function isContactEntityType(type) {
  return type === 'contact' || type === 'contacts' || type === '1'
}

export function isCallLikeNoteType(type) {
  const t = asText(type).toLowerCase()
  return t === 'call_in' || t === 'call_out' || t === '10' || t === '11'
}

function pushNoteEvent(events, seen, { noteId, leadId, contactId, noteType }) {
  const id = asText(noteId)
  if (!id) return
  const lead = asText(leadId)
  const contact = asText(contactId)
  const key = `${id}:${lead || contact || 'note'}`
  if (seen.has(key)) return
  seen.add(key)
  events.push({
    noteId: id,
    leadId: lead,
    contactId: contact,
    noteType: asText(noteType).toLowerCase(),
  })
}

function eventFromNoteRow(row, { defaultLeadId = '', forceLeadId = '', forceContactId = '' } = {}) {
  const nested = innerNote(row)
  const note = nested || row
  const noteId = asText(note?.id)
  if (!noteId) return null
  const entityType = noteEntityType(note) || noteEntityType(row)
  const entityId = asText(
    note?.entity_id ?? note?.element_id ?? note?.lead_id ?? note?.leadId ?? row?.entity_id ?? row?.element_id,
  )
  let leadId = forceLeadId || defaultLeadId
  let contactId = forceContactId
  if (isLeadEntityType(entityType)) {
    leadId = entityId || forceLeadId || defaultLeadId
  } else if (isContactEntityType(entityType)) {
    contactId = entityId || forceContactId
    leadId = forceLeadId || defaultLeadId
  } else if (!entityType && entityId && !nested) {
    leadId = entityId
  }
  return {
    noteId,
    leadId,
    contactId,
    noteType: asText(note?.note_type ?? note?.noteType ?? row?.note_type),
  }
}

function leadIdFromLeadsNoteRow(row) {
  if (!row || typeof row !== 'object') return ''
  const nested = innerNote(row)
  if (nested) {
    if (isContactEntityType(noteEntityType(nested))) return ''
    return asText(nested.element_id ?? nested.entity_id ?? nested.lead_id ?? nested.leadId)
  }
  return asText(row.id ?? row.entity_id ?? row.element_id)
}

function contactIdFromContactsNoteRow(row) {
  if (!row || typeof row !== 'object') return ''
  const nested = innerNote(row)
  if (nested) {
    if (isLeadEntityType(noteEntityType(nested))) return ''
    return asText(nested.element_id ?? nested.entity_id ?? nested.contact_id ?? nested.contactId)
  }
  return asText(row.id ?? row.entity_id ?? row.element_id)
}

/** События note_lead / note_contact (id примечания + id сделки если известен). */
export function extractAmoNoteEvents(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const events = []
  const seen = new Set()
  const leadIds = extractLeadIdsFromNoteWebhook(body)
  const defaultLeadId = leadIds[0] || ''

  for (const row of noteRowsFromGroup(payload.notes)) {
    pushNoteEvent(events, seen, eventFromNoteRow(row, { defaultLeadId }) || {})
  }

  for (const row of asRowList(payload.leads?.note)) {
    if (!innerNote(row)) continue
    pushNoteEvent(
      events,
      seen,
      eventFromNoteRow(row, { defaultLeadId, forceLeadId: leadIdFromLeadsNoteRow(row) }) || {},
    )
  }

  for (const row of asRowList(payload.contacts?.note)) {
    if (!innerNote(row)) continue
    pushNoteEvent(
      events,
      seen,
      eventFromNoteRow(row, { defaultLeadId, forceContactId: contactIdFromContactsNoteRow(row) }) || {},
    )
  }

  return events
}

/** Id сделок из note webhook (leads.note + notes на lead). */
export function extractLeadIdsFromNoteWebhook(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const leadIds = new Set()

  for (const row of asRowList(payload.leads?.note)) {
    const leadId = leadIdFromLeadsNoteRow(row)
    if (leadId) leadIds.add(leadId)
  }

  for (const row of noteRowsFromGroup(payload.notes)) {
    const note = innerNote(row) || row
    const entityType = noteEntityType(note) || noteEntityType(row)
    if (entityType && !isLeadEntityType(entityType)) continue
    const leadId = asText(note?.entity_id ?? note?.element_id ?? note?.lead_id ?? note?.leadId)
    if (leadId) leadIds.add(leadId)
  }

  return [...leadIds]
}

/** Id контактов из note_contact webhook (Sipuni). */
export function extractContactIdsFromNoteWebhook(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const contactIds = new Set()

  for (const row of asRowList(payload.contacts?.note)) {
    const contactId = contactIdFromContactsNoteRow(row)
    if (contactId) contactIds.add(contactId)
  }

  for (const row of noteRowsFromGroup(payload.notes)) {
    const note = innerNote(row) || row
    const entityType = noteEntityType(note) || noteEntityType(row)
    if (!isContactEntityType(entityType)) continue
    const contactId = asText(
      note?.entity_id ?? note?.element_id ?? note?.contact_id ?? note?.contactId,
    )
    if (contactId) contactIds.add(contactId)
  }

  return [...contactIds]
}

/** Повторно тянуть звонок, если webhook пришёл раньше URL записи Sipuni. */
export function shouldRetryAmoCallSync(result, noteEvents = []) {
  const inserted = Array.isArray(result?.inserted) ? result.inserted.length : Number(result?.inserted || 0)
  if (inserted > 0) return false
  if (Number(result?.found || 0) > 0) return true
  return (Array.isArray(noteEvents) ? noteEvents : []).some((event) => isCallLikeNoteType(event?.noteType))
}

export function shouldSyncCallsFromNoteEvents(noteEvents) {
  const events = Array.isArray(noteEvents) ? noteEvents : []
  if (!events.length) return true
  if (events.some((event) => isCallLikeNoteType(event?.noteType))) return true
  if (events.every((event) => event?.noteType)) return false
  return true
}

function compactNoteRow(row) {
  const nested = innerNote(row)
  const note = nested || row
  if (!note || typeof note !== 'object') return null
  return {
    id: asText(note.id),
    noteType: asText(note.note_type ?? note.noteType),
    entityType: asText(note.entity_type ?? note.element_type),
    entityId: asText(note.entity_id ?? note.element_id),
    hasParams: note.params != null,
    hasText: Boolean(asText(note.text)),
  }
}

function compactIdRows(group, nested = false) {
  return asRowList(group)
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      if (nested) {
        const inner = compactNoteRow(row)
        return inner || { id: asText(row.id) }
      }
      return { id: asText(row.id ?? row.entity_id ?? row.element_id) }
    })
    .filter((row) => row && (row.id || row.entityId))
}

function phonesFromNoteRow(row) {
  const nested = innerNote(row)
  const note = nested || row
  if (!note || typeof note !== 'object') return []
  return phonesFromAmoNoteParams(note.params, note.text)
}

/** Телефоны из webhook Sipuni (params.phone), без логирования самих номеров. */
export function extractPhonesFromAmoWebhook(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const out = []
  for (const row of noteRowsFromGroup(payload.notes)) out.push(...phonesFromNoteRow(row))
  for (const row of asRowList(payload.leads?.note)) out.push(...phonesFromNoteRow(row))
  for (const row of asRowList(payload.contacts?.note)) out.push(...phonesFromNoteRow(row))
  return [...new Set(out.filter(Boolean))]
}

/** Короткий дамп webhook amo — без телефонов и текста. */
export function summarizeAmoWebhookBody(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  return {
    keys: Object.keys(payload),
    notesAdd: noteRowsFromGroup(payload.notes).map(compactNoteRow).filter(Boolean),
    leadsNote: compactIdRows(payload.leads?.note, true),
    contactsNote: compactIdRows(payload.contacts?.note, true),
    leadsStatus: compactIdRows(payload.leads?.status),
    hasData: Boolean(payload.data),
    hasToken: Boolean(payload.token),
  }
}

export function hasLeadStatusWebhook(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const statusRows = payload.leads?.status
  if (Array.isArray(statusRows) && statusRows.length) return true
  if (statusRows && typeof statusRows === 'object' && !Array.isArray(statusRows)) {
    if (statusRows.id || statusRows.status_id || statusRows.statusId) return true
  }
  return false
}

/** Webhook amo «примечание в сделке/контакте» (звонок Sipuni и т.п.). */
export function isNoteLeadWebhook(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  if (payload.notes && typeof payload.notes === 'object') return true
  if (payload.leads?.note) return true
  if (payload.contacts?.note) return true
  return false
}

function hasSalesbotIssuePayload(body, query = {}) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const data = unwrapData(payload.data)
  if (pickFrom(data, ID_KEYS) || pickFrom(data, CATEGORY_KEYS) || pickFrom(data, NAME_KEYS)) return true
  if (payload.token) return true
  if (pickFrom(query, ID_KEYS) || pickFrom(query, CATEGORY_KEYS) || pickFrom(query, NAME_KEYS)) return true
  return false
}

/**
 * Ограничение автовыдачи по воронкам (тест, пока не включаем боевые).
 * AMO_ISSUE_PIPELINE_IDS=8922994,123 — пусто = все воронки.
 */
export function issuePipelineAllowlist() {
  const raw = String(process.env.AMO_ISSUE_PIPELINE_IDS ?? '')
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return new Set(raw)
}

export function isPipelineAllowedForIssue(pipelineId) {
  const allow = issuePipelineAllowlist()
  if (!allow.size) return true
  const id = String(pipelineId ?? '').trim()
  return Boolean(id && allow.has(id))
}

/**
 * Выдавать гостевую ссылку:
 * — Salesbot с явным data/token/query (если вдруг передают);
 * — нативный status_lead: в теле уже есть id сделки, имя/звонки добираем через API.
 * Примечания/звонки сами ссылку не создают (только sync).
 */
export function shouldIssueGuestLinkFromAmoWebhook(body, query = {}) {
  if (hasSalesbotIssuePayload(body, query)) return true
  if (!hasLeadStatusWebhook(body)) return false
  const parsed = extractAmoGuestLink(body, query)
  if (!parsed.externalId) return false
  // pipeline_id может прийти в webhook; если нет — resolveGuestFields доберёт из API,
  // а финальный фильтр воронки — в handleAmoWebhook после snapshot.
  return true
}

/** Финальная проверка воронки после snapshot (когда pipelineId уже известен). */
export function shouldIssueAfterPipelineCheck(pipelineId) {
  return isPipelineAllowedForIssue(pipelineId)
}
