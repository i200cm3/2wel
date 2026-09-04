import crypto from 'node:crypto'
import { query } from './db.mjs'
import { sendOtpMail } from './mail.mjs'
import { normalizeEmail } from './users.mjs'

export const OTP_PURPOSES = ['register', 'login', 'reset']
export const OTP_LENGTH = 4
const OTP_TTL_MS = 10 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5

export function isOtpPurpose(value) {
  return OTP_PURPOSES.includes(String(value ?? ''))
}

export function normalizeOtpCode(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, OTP_LENGTH)
}

export function generateOtpCode() {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
}

export function hashOtp(email, purpose, code) {
  return crypto
    .createHash('sha256')
    .update(`${normalizeEmail(email)}:${purpose}:${normalizeOtpCode(code)}`)
    .digest('hex')
}

export async function issueEmailOtp(email, purpose) {
  const address = normalizeEmail(email)
  if (!address || !isOtpPurpose(purpose)) {
    return { ok: false, error: 'Не удалось отправить код' }
  }
  const code = generateOtpCode()
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString()
  await query(
    `UPDATE email_otps SET consumed_at = now()
     WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [address, purpose],
  )
  await query(
    `INSERT INTO email_otps (email, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [address, purpose, hashOtp(address, purpose, code), expiresAt],
  )
  const sent = await sendOtpMail(address, code, purpose)
  if (!sent.ok) {
    if (!sent.skipped) console.error('otp mail', address, purpose, sent.error)
    console.log(`otp ${purpose} for ${address}: ${code}`)
  }
  return { ok: true, sent: Boolean(sent.ok) }
}

export async function verifyEmailOtp(email, purpose, code) {
  const address = normalizeEmail(email)
  const normalized = normalizeOtpCode(code)
  if (!address || !isOtpPurpose(purpose)) {
    return { ok: false, error: 'Код недействителен' }
  }
  if (normalized.length !== OTP_LENGTH) {
    return { ok: false, error: 'Введите 4 цифры' }
  }
  const { rows } = await query(
    `SELECT id, code_hash, expires_at, attempts, consumed_at
     FROM email_otps
     WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [address, purpose],
  )
  const row = rows[0]
  if (!row) return { ok: false, error: 'Код недействителен' }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query(`UPDATE email_otps SET consumed_at = now() WHERE id = $1`, [row.id])
    return { ok: false, error: 'Срок кода истёк. Запросите новый.' }
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await query(`UPDATE email_otps SET consumed_at = now() WHERE id = $1`, [row.id])
    return { ok: false, error: 'Слишком много попыток. Запросите новый код.' }
  }
  const expected = Buffer.from(row.code_hash, 'hex')
  const got = Buffer.from(hashOtp(address, purpose, normalized), 'hex')
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
    await query(`UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id])
    return { ok: false, error: 'Неверный код' }
  }
  await query(`UPDATE email_otps SET consumed_at = now() WHERE id = $1`, [row.id])
  return { ok: true, email: address, purpose }
}
