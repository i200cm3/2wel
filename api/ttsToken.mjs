import crypto from 'node:crypto'
import { authEnv, safeEqual } from './auth.mjs'
import { loadEnv } from './env.mjs'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const FILE_RE = /^[a-z0-9_+.-]{1,120}$/i

function ttlMs() {
  loadEnv()
  const hours = Number(String(process.env.TTS_LINK_TTL_HOURS ?? '').trim())
  if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000
  return DEFAULT_TTL_MS
}

function sign(payload) {
  return crypto.createHmac('sha256', authEnv().secret).update(payload).digest('base64url')
}

/** Гостю уходит подписанная ссылка вместо пути к файлу: файлы озвучки не отдаются напрямую. */
export function signTtsToken(code, fileName) {
  if (!code || !FILE_RE.test(String(fileName ?? ''))) return ''
  const payload = `${Date.now() + ttlMs()}:${code}:${fileName}`
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload)}`
}

/** @returns {{ code: string, fileName: string } | null} */
export function verifyTtsToken(token) {
  const raw = String(token ?? '')
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = Buffer.from(raw.slice(0, dot), 'base64url').toString('utf8')
  if (!safeEqual(raw.slice(dot + 1), sign(payload))) return null

  const [exp, code, fileName] = payload.split(':')
  if (!exp || !code || !fileName) return null
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return null
  if (/[^a-z0-9-]/.test(code) || !FILE_RE.test(fileName)) return null
  return { code, fileName }
}
