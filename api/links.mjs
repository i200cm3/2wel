import crypto from 'node:crypto'
import { query } from './db.js'
import { guestLinkUrl } from './publicUrl.mjs'

function isPropertyConfig(value) {
  if (!value || typeof value !== 'object') return false
  return (
    typeof value.brand === 'object' &&
    value.brand !== null &&
    typeof value.sequences === 'object' &&
    value.sequences !== null &&
    Array.isArray(value.flow) &&
    Array.isArray(value.branches)
  )
}

/** Пути SPA, которые нельзя выдавать как public_id (особенно при короткой длине). */
const RESERVED_PUBLIC_IDS = new Set([
  'app',
  'api',
  'src',
  'login',
  'media',
  'assets',
  'editor',
  'register',
  'join',
  'dashboard',
  'properties',
])

export const PUBLIC_ID_RE = /^[a-z0-9]{3,16}$/

/** Новые гостевые ссылки — 4 символа; старые 3-символьные id остаются валидными. */
export function generatePublicId(length = 4) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length]
  return out
}

function isUsablePublicId(id) {
  return PUBLIC_ID_RE.test(id) && !RESERVED_PUBLIC_IDS.has(id)
}

function mapIssued(row) {
  const projectCode = row.project_code || row.projectCode
  return {
    id: row.id,
    publicId: row.public_id,
    guestName: row.guest_name,
    url: guestLinkUrl(projectCode, row.public_id),
    templateCode: row.template_code,
    templateName: row.template_name,
    externalId: row.external_id ?? null,
    createdAt: row.created_at,
  }
}

export async function getLinkByExternalId(projectId, externalId) {
  const id = String(externalId ?? '').trim()
  if (!id) return null
  const { rows } = await query(
    `SELECT l.id, l.public_id, l.guest_name, l.external_id, l.created_at,
            t.code AS template_code, t.name AS template_name,
            p.code AS project_code
     FROM links l
     JOIN templates t ON t.id = l.template_id
     JOIN projects p ON p.id = l.project_id
     WHERE l.project_id = $1 AND l.external_id = $2`,
    [projectId, id],
  )
  return rows[0] ? mapIssued(rows[0]) : null
}

/** Статус ссылки для виджета amo: + summary_meta (pipeline / presentationUrl). */
export async function getLinkWidgetStatusByExternalId(projectId, externalId) {
  const id = String(externalId ?? '').trim()
  if (!id) return null
  const { rows } = await query(
    `SELECT l.id, l.public_id, l.guest_name, l.external_id, l.created_at, l.summary_meta,
            t.code AS template_code, t.name AS template_name,
            p.code AS project_code
     FROM links l
     JOIN templates t ON t.id = l.template_id
     JOIN projects p ON p.id = l.project_id
     WHERE l.project_id = $1 AND l.external_id = $2
     ORDER BY l.created_at DESC
     LIMIT 1`,
    [projectId, id],
  )
  const row = rows[0]
  if (!row) return null
  const issued = mapIssued(row)
  const meta =
    row.summary_meta && typeof row.summary_meta === 'object' && !Array.isArray(row.summary_meta)
      ? row.summary_meta
      : null
  return { ...issued, summaryMeta: meta }
}

export async function getLinksByExternalIds(projectId, externalIds) {
  const ids = [
    ...new Set(
      (Array.isArray(externalIds) ? externalIds : [])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean),
    ),
  ]
  if (!ids.length) return []
  const { rows } = await query(
    `SELECT l.id, l.public_id, l.guest_name, l.external_id, l.created_at,
            t.code AS template_code, t.name AS template_name,
            p.code AS project_code
     FROM links l
     JOIN templates t ON t.id = l.template_id
     JOIN projects p ON p.id = l.project_id
     WHERE l.project_id = $1 AND l.external_id = ANY($2::text[])`,
    [projectId, ids],
  )
  return rows.map(mapIssued)
}

function uniqueText(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((id) => String(id ?? '').trim()).filter(Boolean))]
}

/** Ссылки по id сделки, id контакта amo или совпадению телефона (дубли контактов). */
export async function findLinksForAmoCall(projectId, { leadIds = [], contactIds = [], phones = [] } = {}) {
  const leads = uniqueText(leadIds)
  const contacts = uniqueText(contactIds)
  const nums = uniqueText(phones)
  if (!leads.length && !contacts.length && !nums.length) return []
  const { rows } = await query(
    `SELECT l.id, l.public_id, l.guest_name, l.external_id, l.created_at,
            t.code AS template_code, t.name AS template_name,
            p.code AS project_code
     FROM links l
     JOIN templates t ON t.id = l.template_id
     JOIN projects p ON p.id = l.project_id
     WHERE l.project_id = $1
       AND (
         (cardinality($2::text[]) > 0 AND l.external_id = ANY($2::text[]))
         OR (cardinality($3::text[]) > 0 AND l.amo_contact_id = ANY($3::text[]))
         OR (cardinality($4::text[]) > 0 AND l.amo_phones && $4::text[])
       )`,
    [projectId, leads, contacts, nums],
  )
  return rows.map(mapIssued)
}

export async function updateLinkAmoIdentity(linkId, { contactId = '', phones = [] } = {}) {
  const id = String(linkId ?? '').trim()
  if (!id) return false
  const contact = String(contactId ?? '').trim()
  const nums = uniqueText(phones)
  if (!contact && !nums.length) return false
  await query(
    `UPDATE links
     SET amo_contact_id = COALESCE(NULLIF($2, ''), amo_contact_id),
         amo_phones = (
           SELECT COALESCE(array_agg(DISTINCT x), '{}'::text[])
           FROM unnest(COALESCE(amo_phones, '{}'::text[]) || $3::text[]) AS x
           WHERE x <> ''
         ),
         amo_snapshot = COALESCE(amo_snapshot, '{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
                'contactId', NULLIF($2, ''),
                'phones', to_jsonb($3::text[])
              ))
     WHERE id = $1`,
    [id, contact, nums],
  )
  return true
}

export async function insertLink({
  projectId,
  templateId,
  guestName,
  externalId,
  guestSummary = null,
  derivedFlow = null,
  assemblyTrace = null,
  amoSnapshot = null,
  summaryMeta = null,
}) {
  const name = String(guestName ?? '').trim()
  if (!name) throw new Error('guest name required')
  const ext = String(externalId ?? '').trim() || null
  const contactId = String(amoSnapshot?.contactId ?? amoSnapshot?.contact_id ?? '').trim() || null
  const amoPhones = uniqueText(amoSnapshot?.phones)
  for (let i = 0; i < 8; i += 1) {
    const publicId = generatePublicId()
    if (!isUsablePublicId(publicId)) continue
    try {
      const { rows } = await query(
        `INSERT INTO links (
           project_id, template_id, public_id, guest_name, external_id,
           guest_summary, derived_flow, assembly_trace, amo_snapshot, summary_meta,
           amo_contact_id, amo_phones
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::text[])
         RETURNING id, public_id, guest_name, external_id, created_at`,
        [
          projectId,
          templateId,
          publicId,
          name,
          ext,
          guestSummary ? JSON.stringify(guestSummary) : null,
          derivedFlow ? JSON.stringify(derivedFlow) : null,
          assemblyTrace ? JSON.stringify(assemblyTrace) : null,
          amoSnapshot ? JSON.stringify(amoSnapshot) : null,
          summaryMeta ? JSON.stringify(summaryMeta) : null,
          contactId,
          amoPhones,
        ],
      )
      const row = rows[0]
      const { rows: joined } = await query(
        `SELECT t.code AS template_code, t.name AS template_name, p.code AS project_code
         FROM templates t
         JOIN projects p ON p.id = t.project_id
         WHERE t.id = $1`,
        [templateId],
      )
      return mapIssued({ ...row, ...joined[0] })
    } catch (err) {
      if (err && err.code === '23505') {
        if (ext && String(err.constraint || '').includes('external')) {
          const existing = await getLinkByExternalId(projectId, ext)
          if (existing) return existing
        }
        continue
      }
      throw err
    }
  }
  throw new Error('Не удалось выдать уникальную ссылку')
}

/** Переключает шаблон и/или обновляет dossier-снимок у уже выданной ссылки. */
export async function updateLinkTemplate(
  linkId,
  templateId,
  {
    guestSummary = null,
    derivedFlow = null,
    assemblyTrace = null,
    amoSnapshot = null,
    summaryMeta = null,
    guestName = null,
  } = {},
) {
  const id = String(linkId ?? '').trim()
  const tid = String(templateId ?? '').trim()
  if (!id || !tid) return null
  const name = guestName != null ? String(guestName).trim() : null
  const { rows } = await query(
    `UPDATE links
     SET template_id = $2,
         guest_name = COALESCE(NULLIF($7, ''), guest_name),
         guest_summary = $3::jsonb,
         derived_flow = $4::jsonb,
         assembly_trace = $5::jsonb,
         amo_snapshot = COALESCE($6::jsonb, amo_snapshot),
         summary_meta = COALESCE($8::jsonb, summary_meta)
     WHERE id = $1
     RETURNING id, public_id, guest_name, external_id, created_at`,
    [
      id,
      tid,
      guestSummary != null ? JSON.stringify(guestSummary) : null,
      derivedFlow != null ? JSON.stringify(derivedFlow) : null,
      assemblyTrace != null ? JSON.stringify(assemblyTrace) : null,
      amoSnapshot != null ? JSON.stringify(amoSnapshot) : null,
      name,
      summaryMeta != null ? JSON.stringify(summaryMeta) : null,
    ],
  )
  const row = rows[0]
  if (!row) return null
  if (amoSnapshot) {
    await updateLinkAmoIdentity(id, {
      contactId: amoSnapshot.contactId ?? amoSnapshot.contact_id,
      phones: amoSnapshot.phones,
    })
  }
  const { rows: joined } = await query(
    `SELECT t.code AS template_code, t.name AS template_name, p.code AS project_code
     FROM templates t
     JOIN projects p ON p.id = t.project_id
     WHERE t.id = $1`,
    [tid],
  )
  return mapIssued({ ...row, ...joined[0] })
}

/** Мержит patch в summary_meta ссылки (статус пайплайна и т.п.). */
export async function patchLinkSummaryMeta(linkId, patch = {}) {
  const id = String(linkId ?? '').trim()
  if (!id || !patch || typeof patch !== 'object') return null
  const { rows: current } = await query(`SELECT summary_meta FROM links WHERE id = $1`, [id])
  if (!current[0]) return null
  const prev =
    current[0].summary_meta && typeof current[0].summary_meta === 'object' && !Array.isArray(current[0].summary_meta)
      ? { ...current[0].summary_meta }
      : {}
  const next = { ...prev, ...patch }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
  }
  const { rows } = await query(
    `UPDATE links SET summary_meta = $2::jsonb WHERE id = $1
     RETURNING id, summary_meta`,
    [id, JSON.stringify(next)],
  )
  return rows[0] ?? null
}

const RAW_KINDS = new Set(['chat', 'call_transcript', 'note', 'manual', 'amo_export'])

export function normalizeRawKind(value) {
  const kind = String(value ?? '')
    .trim()
    .toLowerCase()
  return RAW_KINDS.has(kind) ? kind : 'manual'
}

export async function linkHasRawSourceRef(linkId, externalRef) {
  const lid = String(linkId ?? '').trim()
  const ref = String(externalRef ?? '').trim()
  if (!lid || !ref) return false
  const { rows } = await query(
    `SELECT 1 FROM link_raw_sources WHERE link_id = $1 AND external_ref = $2 LIMIT 1`,
    [lid, ref],
  )
  return Boolean(rows[0])
}

export async function insertLinkRawSources(linkId, sources, { skipDup = false } = {}) {
  const id = String(linkId ?? '').trim()
  const list = Array.isArray(sources) ? sources : []
  if (!id || !list.length) return []
  const inserted = []
  for (const item of list) {
    const body = String(item?.body ?? item?.text ?? '').trim()
    const kind = normalizeRawKind(item?.kind)
    const title = String(item?.title ?? '').trim().slice(0, 200)
    const externalRef = String(item?.externalRef ?? item?.external_ref ?? '').trim().slice(0, 256) || null
    if (!body && !externalRef) continue
    if (skipDup && externalRef && (await linkHasRawSourceRef(id, externalRef))) continue
    let capturedAt = item?.capturedAt ?? item?.captured_at ?? null
    if (capturedAt != null) {
      const d = new Date(capturedAt)
      capturedAt = Number.isNaN(d.getTime()) ? null : d.toISOString()
    }
    const meta = normalizeRawMeta(item?.meta)
    const { rows } = await query(
      `INSERT INTO link_raw_sources (link_id, kind, title, body, external_ref, captured_at, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, kind, title, body, external_ref, captured_at, created_at, meta`,
      [id, kind, title, body, externalRef, capturedAt, meta ? JSON.stringify(meta) : null],
    )
    if (rows[0]) inserted.push(mapRawSource(rows[0]))
  }
  return inserted
}

function normalizeRawMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function mapRawSource(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title || '',
    body: row.body,
    externalRef: row.external_ref ?? null,
    capturedAt: row.captured_at ?? null,
    createdAt: row.created_at,
    meta: normalizeRawMeta(row.meta),
  }
}

export async function listLinkRawSources(linkId) {
  const { rows } = await query(
    `SELECT id, kind, title, body, external_ref, captured_at, created_at, meta
     FROM link_raw_sources
     WHERE link_id = $1
     ORDER BY created_at DESC`,
    [linkId],
  )
  return rows.map(mapRawSource)
}

export async function getLinkRawSource(linkId, sourceId) {
  const lid = String(linkId ?? '').trim()
  const sid = String(sourceId ?? '').trim()
  if (!lid || !sid) return null
  const { rows } = await query(
    `SELECT id, kind, title, body, external_ref, captured_at, created_at, meta
     FROM link_raw_sources
     WHERE id = $1 AND link_id = $2
     LIMIT 1`,
    [sid, lid],
  )
  return rows[0] ? mapRawSource(rows[0]) : null
}

export async function mergeLinkRawSourceMeta(linkId, sourceId, patch = {}) {
  const lid = String(linkId ?? '').trim()
  const sid = String(sourceId ?? '').trim()
  if (!lid || !sid) return null
  const existing = await getLinkRawSource(lid, sid)
  if (!existing) return null
  const prev = normalizeRawMeta(existing.meta) || {}
  const patchNorm = normalizeRawMeta(patch) || {}
  const next = { ...prev, ...patchNorm }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
  }
  const { rows } = await query(
    `UPDATE link_raw_sources
     SET meta = $3::jsonb
     WHERE id = $1 AND link_id = $2
     RETURNING id, kind, title, body, external_ref, captured_at, created_at, meta`,
    [sid, lid, JSON.stringify(next)],
  )
  return rows[0] ? mapRawSource(rows[0]) : null
}

export async function updateLinkRawSource(linkId, sourceId, patch = {}) {
  const lid = String(linkId ?? '').trim()
  const sid = String(sourceId ?? '').trim()
  if (!lid || !sid) return null
  const body = String(patch?.body ?? patch?.text ?? '').trim()
  if (!body) return null
  const kind = normalizeRawKind(patch?.kind)
  const title = String(patch?.title ?? '').trim().slice(0, 200)
  const metaProvided = patch?.meta !== undefined
  const meta = metaProvided ? normalizeRawMeta(patch.meta) : undefined
  const { rows } = await query(
    `UPDATE link_raw_sources
     SET kind = $3,
         title = $4,
         body = $5,
         meta = CASE WHEN $6 THEN $7::jsonb ELSE meta END
     WHERE id = $1 AND link_id = $2
     RETURNING id, kind, title, body, external_ref, captured_at, created_at, meta`,
    [sid, lid, kind, title, body, metaProvided, meta ? JSON.stringify(meta) : null],
  )
  return rows[0] ? mapRawSource(rows[0]) : null
}

export async function deleteLinkRawSource(linkId, sourceId) {
  const lid = String(linkId ?? '').trim()
  const sid = String(sourceId ?? '').trim()
  if (!lid || !sid) return false
  const result = await query(`DELETE FROM link_raw_sources WHERE id = $1 AND link_id = $2`, [sid, lid])
  return Number(result.rowCount) > 0
}

export async function getProjectLinkDetail(projectId, publicId) {
  const id = String(publicId ?? '').toLowerCase()
  if (!PUBLIC_ID_RE.test(id)) return null
  const { rows } = await query(
    `SELECT l.id, l.public_id, l.guest_name, l.external_id, l.created_at, l.first_opened_at, l.open_count,
            l.guest_summary, l.derived_flow, l.assembly_trace, l.amo_snapshot, l.summary_meta,
            l.crm_status_id, l.crm_pipeline_id, l.crm_status_at,
            t.code AS template_code, t.name AS template_name, p.code AS project_code
     FROM links l
     JOIN templates t ON t.id = l.template_id
     JOIN projects p ON p.id = l.project_id
     WHERE l.project_id = $1 AND l.public_id = $2`,
    [projectId, id],
  )
  const row = rows[0]
  if (!row) return null
  const rawSources = await listLinkRawSources(row.id)
  return {
    id: row.id,
    publicId: row.public_id,
    url: guestLinkUrl(row.project_code, row.public_id),
    guestName: row.guest_name,
    externalId: row.external_id ?? null,
    templateCode: row.template_code,
    templateName: row.template_name,
    createdAt: row.created_at,
    firstOpenedAt: row.first_opened_at,
    openCount: Number(row.open_count),
    guestSummary: row.guest_summary ?? null,
    derivedFlow: Array.isArray(row.derived_flow) ? row.derived_flow : null,
    assemblyTrace: Array.isArray(row.assembly_trace) ? row.assembly_trace : null,
    amoSnapshot: row.amo_snapshot ?? null,
    summaryMeta: row.summary_meta ?? null,
    crmStatusId: row.crm_status_id ?? null,
    crmPipelineId: row.crm_pipeline_id ?? null,
    crmStatusAt: row.crm_status_at ?? null,
    rawSources,
  }
}

export async function getProjectLinkRow(projectId, publicId) {
  const id = String(publicId ?? '').toLowerCase()
  if (!PUBLIC_ID_RE.test(id)) return null
  const { rows } = await query(
    `SELECT l.id, l.public_id, l.guest_name, l.external_id, l.created_at, l.template_id,
            l.guest_summary, t.code AS template_code, t.name AS template_name, t.config, t.status,
            p.code AS project_code, p.id AS project_uuid
     FROM links l
     JOIN templates t ON t.id = l.template_id
     JOIN projects p ON p.id = l.project_id
     WHERE l.project_id = $1 AND l.public_id = $2`,
    [projectId, id],
  )
  return rows[0] ?? null
}

export async function getPublicPlayback(publicId) {
  const id = String(publicId ?? '').toLowerCase()
  if (!PUBLIC_ID_RE.test(id)) return null
  const { rows } = await query(
    `SELECT l.id, l.public_id, l.guest_name, l.project_id, l.guest_summary, l.derived_flow, t.config,
            p.code AS project_code, p.captions_from_tts, p.fill_missing_tts
     FROM links l
     JOIN templates t ON t.id = l.template_id
     JOIN projects p ON p.id = l.project_id
     WHERE l.public_id = $1`,
    [id],
  )
  const row = rows[0]
  if (!row || !isPropertyConfig(row.config)) return null
  return row
}

export async function touchLinkOpen(linkId) {
  await query(
    `UPDATE links
     SET open_count = open_count + 1,
         first_opened_at = COALESCE(first_opened_at, now())
     WHERE id = $1`,
    [linkId],
  )
}

export async function getLinkForEvent(publicId) {
  const id = String(publicId ?? '').toLowerCase()
  if (!PUBLIC_ID_RE.test(id)) return null
  const { rows } = await query(
    `SELECT id, project_id FROM links WHERE public_id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function deleteProjectLink(projectId, publicId) {
  const id = String(publicId ?? '').toLowerCase()
  if (!PUBLIC_ID_RE.test(id)) return { ok: false, externalId: null }
  const { rows } = await query(
    `DELETE FROM links WHERE project_id = $1 AND public_id = $2 RETURNING external_id`,
    [projectId, id],
  )
  if (!rows[0]) return { ok: false, externalId: null }
  const externalId = rows[0].external_id != null ? String(rows[0].external_id).trim() : ''
  return { ok: true, externalId: externalId || null }
}

/** Есть ли смена статуса (пустой next не пишем). */
export function crmStatusChanged(prevStatusId, nextStatusId) {
  const next = String(nextStatusId ?? '').trim()
  if (!next) return false
  const prev = prevStatusId == null || prevStatusId === '' ? '' : String(prevStatusId)
  return prev !== next
}

const PRIOR_ORDER = ['open', 'autoplay', 'menu', 'whatsapp', 'topic', 'contact']

/**
 * Снимок действий гостя к моменту смены статуса CRM.
 * @param {Array<{ type?: string, created_at?: string | Date }>} events DESC по времени
 */
export function crmStatusContextFromEvents(events) {
  const list = Array.isArray(events) ? events : []
  if (!list.length) {
    return { lastEventType: null, lastEventAt: null, priorTypes: [] }
  }
  const seen = new Set()
  for (const row of list) {
    const type = String(row?.type ?? '')
    if (PRIOR_ORDER.includes(type)) seen.add(type)
  }
  const last = list[0]
  const lastType = String(last?.type ?? '')
  return {
    lastEventType: PRIOR_ORDER.includes(lastType) ? lastType : null,
    lastEventAt: last?.created_at ?? null,
    priorTypes: PRIOR_ORDER.filter((type) => seen.has(type)),
  }
}

/**
 * Обновляет снимок статуса на ссылке и пишет историю при смене.
 * В историю кладётся последнее действие гостя и набор prior-типов.
 * @returns {{ recorded: boolean, reason?: string }}
 */
export async function recordLinkCrmStatus(linkId, { statusId, pipelineId } = {}) {
  const id = String(linkId ?? '').trim()
  const status = String(statusId ?? '').trim().slice(0, 64)
  if (!id || !status) return { recorded: false, reason: 'no_status' }
  const pipeline = String(pipelineId ?? '').trim().slice(0, 64) || null

  const { rows } = await query(
    `SELECT crm_status_id, crm_pipeline_id FROM links WHERE id = $1`,
    [id],
  )
  const row = rows[0]
  if (!row) return { recorded: false, reason: 'missing' }

  if (!crmStatusChanged(row.crm_status_id, status)) {
    if (pipeline && String(row.crm_pipeline_id || '') !== pipeline) {
      await query(`UPDATE links SET crm_pipeline_id = $2 WHERE id = $1`, [id, pipeline])
    }
    return { recorded: false, reason: 'unchanged' }
  }

  const { rows: events } = await query(
    `SELECT type, created_at
     FROM link_events
     WHERE link_id = $1
     ORDER BY created_at DESC
     LIMIT 80`,
    [id],
  )
  const ctx = crmStatusContextFromEvents(events)

  await query(
    `UPDATE links
     SET crm_status_id = $2,
         crm_pipeline_id = COALESCE($3, crm_pipeline_id),
         crm_status_at = now()
     WHERE id = $1`,
    [id, status, pipeline],
  )
  await query(
    `INSERT INTO link_crm_events (
       link_id, status_id, pipeline_id, last_event_type, last_event_at, prior_types
     )
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, status, pipeline, ctx.lastEventType, ctx.lastEventAt, ctx.priorTypes],
  )
  return { recorded: true, context: ctx }
}
