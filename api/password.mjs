import crypto from 'node:crypto'

const KEY_LEN = 32
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT)
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('scrypt:')) return false
  const parts = stored.split(':')
  if (parts.length !== 3) return false
  const salt = Buffer.from(parts[1], 'base64')
  const expected = Buffer.from(parts[2], 'base64')
  if (!salt.length || expected.length !== KEY_LEN) return false
  const actual = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT)
  return crypto.timingSafeEqual(actual, expected)
}
