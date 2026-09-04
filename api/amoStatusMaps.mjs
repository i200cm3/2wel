import { query } from './db.mjs'

const STATUS_ID_RE = /^[0-9]{1,64}$/
const TEMPLATE_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

function mapRow(row) {
  return {
    statusId: row.status_id,
    templateCode: row.template_code,
    label: row.label || null,
  }
}

export function normalizeStatusMapRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  const out = []
  const seen = new Set()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const statusId = String(item.statusId ?? item.status_id ?? '').trim()
    const templateCode = String(item.templateCode ?? item.template_code ?? '')
      .trim()
      .toLowerCase()
    const label = String(item.label ?? '').trim().slice(0, 120) || null
    if (!STATUS_ID_RE.test(statusId) || !TEMPLATE_CODE_RE.test(templateCode)) continue
    if (seen.has(statusId)) continue
    seen.add(statusId)
    out.push({ statusId, templateCode, label })
  }
  return out
}

export async function listAmoStatusMaps(projectId) {
  const { rows } = await query(
    `SELECT status_id, template_code, label
     FROM amo_status_maps
     WHERE project_id = $1
     ORDER BY status_id`,
    [projectId],
  )
  return rows.map(mapRow)
}

/**
 * Полная замена карты. templateCodes — Set кодов шаблонов проекта.
 * @returns {{ ok: true, maps: object[] } | { ok: false, error: string }}
 */
export async function replaceAmoStatusMaps(projectId, rows, templateCodes) {
  const maps = normalizeStatusMapRows(rows)
  const codes = templateCodes instanceof Set ? templateCodes : new Set(templateCodes || [])
  for (const item of maps) {
    if (!codes.has(item.templateCode)) {
      return { ok: false, error: `Неизвестный шаблон: ${item.templateCode}` }
    }
  }

  await query('DELETE FROM amo_status_maps WHERE project_id = $1', [projectId])
  for (const item of maps) {
    await query(
      `INSERT INTO amo_status_maps (project_id, status_id, template_code, label, updated_at)
       VALUES ($1, $2, $3, $4, now())`,
      [projectId, item.statusId, item.templateCode, item.label],
    )
  }
  return { ok: true, maps }
}
