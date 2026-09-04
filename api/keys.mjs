import crypto from 'node:crypto'
import { query } from './db.js'

const PREFIX = 'pk_live_'
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function hashApiKey(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex')
}

function mapKey(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }
}

export function generateApiKey() {
  const secret = crypto.randomBytes(24).toString('hex')
  const token = `${PREFIX}${secret}`
  return {
    token,
    prefix: token.slice(0, PREFIX.length + 8),
    hash: hashApiKey(token),
  }
}

export async function listApiKeys(projectId) {
  const { rows } = await query(
    `SELECT id, name, prefix, created_at, last_used_at, revoked_at
     FROM api_keys
     WHERE project_id = $1
     ORDER BY (revoked_at IS NULL) DESC, created_at DESC`,
    [projectId],
  )
  return rows.map(mapKey)
}

export async function createApiKey(projectId, name) {
  const label = String(name ?? '').trim() || 'default'
  const { token, prefix, hash } = generateApiKey()
  const { rows } = await query(
    `INSERT INTO api_keys (project_id, name, prefix, key_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, prefix, created_at, last_used_at, revoked_at`,
    [projectId, label.slice(0, 64), prefix, hash],
  )
  return { ...mapKey(rows[0]), token }
}

export async function revokeApiKey(projectId, keyId) {
  if (!UUID_RE.test(String(keyId))) return false
  const result = await query(
    `UPDATE api_keys
     SET revoked_at = now()
     WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL`,
    [keyId, projectId],
  )
  return Number(result.rowCount) > 0
}

export async function deleteApiKey(projectId, keyId) {
  if (!UUID_RE.test(String(keyId))) return false
  const result = await query(
    `DELETE FROM api_keys
     WHERE id = $1 AND project_id = $2`,
    [keyId, projectId],
  )
  return Number(result.rowCount) > 0
}

export async function findApiKey(token) {
  const value = String(token ?? '')
  if (!value.startsWith(PREFIX) || value.length < PREFIX.length + 16) return null
  const { rows } = await query(
    `SELECT k.id, k.revoked_at,
            p.id AS project_id, p.code AS project_code, p.name AS project_name,
            p.skip_tts_on_link_issue
     FROM api_keys k
     JOIN projects p ON p.id = k.project_id
     WHERE k.key_hash = $1`,
    [hashApiKey(value)],
  )
  const row = rows[0]
  if (!row || row.revoked_at) return null
  return {
    id: row.id,
    project: {
      id: row.project_id,
      code: row.project_code,
      name: row.project_name,
      skip_tts_on_link_issue: Boolean(row.skip_tts_on_link_issue),
    },
  }
}

export async function touchApiKeyUsed(keyId) {
  await query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [keyId])
}
