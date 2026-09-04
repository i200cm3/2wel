import crypto from 'node:crypto'
import { query } from './db.mjs'

function mapRow(row) {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    projectCode: row.project_code,
    baseDomain: row.base_domain,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    webhookToken: row.webhook_token || null,
    webhookDestination: row.webhook_destination || null,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  }
}

export async function listAmoConnections() {
  const { rows } = await query(
    `SELECT c.*, p.code AS project_code
     FROM amo_connections c
     JOIN projects p ON p.id = c.project_id`,
  )
  return rows.map(mapRow)
}

export async function getAmoConnection(projectId) {
  const { rows } = await query(
    `SELECT c.*, p.code AS project_code
     FROM amo_connections c
     JOIN projects p ON p.id = c.project_id
     WHERE c.project_id = $1`,
    [projectId],
  )
  return mapRow(rows[0])
}

export async function getProjectById(projectId) {
  const { rows } = await query(
    `SELECT id, code, name, type, status, created_at, updated_at
     FROM projects WHERE id = $1`,
    [projectId],
  )
  return rows[0] ?? null
}

export async function upsertAmoConnection({
  projectId,
  baseDomain,
  accessToken,
  refreshToken,
  tokenExpiresAt,
  webhookToken,
  webhookDestination,
}) {
  const { rows } = await query(
    `INSERT INTO amo_connections (
       project_id, base_domain, access_token, refresh_token, token_expires_at,
       webhook_token, webhook_destination, connected_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
     ON CONFLICT (project_id) DO UPDATE SET
       base_domain = EXCLUDED.base_domain,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       webhook_token = COALESCE(EXCLUDED.webhook_token, amo_connections.webhook_token),
       webhook_destination = COALESCE(EXCLUDED.webhook_destination, amo_connections.webhook_destination),
       updated_at = now()
     RETURNING *, (SELECT code FROM projects WHERE id = $1) AS project_code`,
    [
      projectId,
      baseDomain,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      webhookToken || null,
      webhookDestination || null,
    ],
  )
  return mapRow(rows[0])
}

export async function updateAmoTokens(projectId, { accessToken, refreshToken, tokenExpiresAt }) {
  const { rows } = await query(
    `UPDATE amo_connections
     SET access_token = $2,
         refresh_token = $3,
         token_expires_at = $4,
         updated_at = now()
     WHERE project_id = $1
     RETURNING *, (SELECT code FROM projects WHERE id = $1) AS project_code`,
    [projectId, accessToken, refreshToken, tokenExpiresAt],
  )
  return mapRow(rows[0])
}

export async function deleteAmoConnection(projectId) {
  const existing = await getAmoConnection(projectId)
  await query(`DELETE FROM amo_connections WHERE project_id = $1`, [projectId])
  return existing
}
