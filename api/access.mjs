import crypto from 'node:crypto'
import { query } from './db.mjs'
import { loadEnv } from './env.mjs'
import { generatePublicId } from './links.mjs'

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000
const RESET_TTL_MS = 2 * 60 * 60 * 1000

export function registrationMode() {
  loadEnv()
  const raw = String(process.env.AUTH_REGISTRATION ?? 'open').trim().toLowerCase()
  if (raw === 'closed' || raw === 'invite' || raw === 'open') return raw
  return 'open'
}

export function publicRegistration() {
  const mode = registrationMode()
  return { mode, open: mode === 'open', invite: mode === 'invite' }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex')
}

function mapInvite(row, extras = {}) {
  return {
    id: row.id,
    email: row.email ?? null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    ...extras,
  }
}

export async function listInvites() {
  const { rows } = await query(
    `SELECT id, email, created_at, expires_at, used_at
     FROM invites
     ORDER BY created_at DESC
     LIMIT 50`,
  )
  return rows.map((row) => mapInvite(row))
}

export async function createInvite({ createdBy, email } = {}) {
  const emailValue = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const token = generatePublicId(24)
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  const { rows } = await query(
    `INSERT INTO invites (token, email, created_by, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, created_at, expires_at, used_at`,
    [token, emailValue || null, createdBy || null, expiresAt],
  )
  return { ...mapInvite(rows[0]), token }
}

export async function consumeInvite(token, email) {
  const value = String(token ?? '').trim()
  if (!value) return { ok: false, error: 'Нужно приглашение' }
  const { rows } = await query(
    `SELECT id, token, email, expires_at, used_at
     FROM invites WHERE token = $1`,
    [value],
  )
  const row = rows[0]
  if (!row) return { ok: false, error: 'Приглашение недействительно' }
  if (row.used_at) return { ok: false, error: 'Приглашение уже использовано' }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Срок приглашения истёк' }
  }
  if (row.email && String(row.email).toLowerCase() !== String(email ?? '').trim().toLowerCase()) {
    return { ok: false, error: 'Приглашение выдано на другой email' }
  }
  return { ok: true, id: row.id }
}

export async function markInviteUsed(inviteId, userId) {
  await query(
    `UPDATE invites SET used_at = now(), used_by = $2 WHERE id = $1 AND used_at IS NULL`,
    [inviteId, userId],
  )
}

export async function createPasswordReset(userId) {
  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString()
  await query(
    `UPDATE password_resets SET used_at = now()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  )
  await query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashToken(token), expiresAt],
  )
  return token
}

export async function consumePasswordReset(token) {
  const value = String(token ?? '').trim()
  if (!value || value.length < 16) return { ok: false, error: 'Ссылка недействительна' }
  const { rows } = await query(
    `SELECT id, user_id, expires_at, used_at
     FROM password_resets WHERE token_hash = $1`,
    [hashToken(value)],
  )
  const row = rows[0]
  if (!row || row.used_at) return { ok: false, error: 'Ссылка недействительна' }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Срок ссылки истёк' }
  }
  await query(`UPDATE password_resets SET used_at = now() WHERE id = $1`, [row.id])
  return { ok: true, userId: row.user_id }
}

export function resetUrl(req, token) {
  loadEnv()
  const fromEnv = String(process.env.PUBLIC_ORIGIN ?? '').trim().replace(/\/$/, '')
  if (fromEnv) return `${fromEnv}/reset?token=${encodeURIComponent(token)}`
  const raw = req?.headers?.host
  const host = Array.isArray(raw) ? raw[0] : raw
  if (host) {
    const protoHeader = req.headers?.['x-forwarded-proto']
    const protoRaw = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader
    const proto = String(protoRaw || 'http').split(',')[0].trim() || 'http'
    return `${proto}://${host}/reset?token=${encodeURIComponent(token)}`
  }
  const domain = String(process.env.DOMAIN ?? '').trim().replace(/^https?:\/\//, '')
  if (domain) return `https://${domain}/reset?token=${encodeURIComponent(token)}`
  return `/reset?token=${encodeURIComponent(token)}`
}
