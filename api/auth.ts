import crypto from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnvFile(filePath: string, into: Record<string, string | undefined>): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const eq = line.indexOf('=')
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
      val = val.slice(1, -1)
    }
    if (!key) continue
    into[key] = val
  }
}

const SESSION_COOKIE = 'promo_session'
const WEAK_SECRETS = new Set([
  '',
  'changeme',
  'change-me-to-a-long-random-string',
  'secret',
  'password',
  'promo',
])

export type AuthEnv = {
  login: string
  password: string
  secret: string
  allowInsecure: boolean
}

export function authEnv(): AuthEnv {
  const out: Record<string, string | undefined> = { ...process.env }
  const root = path.resolve(__dirname, '..')
  loadEnvFile(path.join(root, '.env'), out)
  loadEnvFile(path.join(root, 'web', '.env'), out)
  return {
    login: String(out.EDITOR_LOGIN ?? '').trim(),
    password: String(out.EDITOR_PASSWORD ?? '').trim(),
    secret: String(out.AUTH_SECRET ?? '').trim(),
    allowInsecure:
      String(out.AUTH_ALLOW_INSECURE ?? '').trim().toLowerCase() === '1' ||
      String(out.AUTH_ALLOW_INSECURE ?? '').trim().toLowerCase() === 'true' ||
      String(out.AUTH_ALLOW_INSECURE ?? '').trim().toLowerCase() === 'yes',
  }
}

export function isWeakAuthSecret(secret: string | null | undefined): boolean {
  const value = String(secret ?? '').trim()
  if (value.length < 24) return true
  return WEAK_SECRETS.has(value)
}

/** Падать при старте API, если секрет слабый. Не вызывать из vite-плагинов. */
export function assertAuthSecret(): void {
  const env = authEnv()
  if (!isWeakAuthSecret(env.secret)) return
  const msg =
    'AUTH_SECRET слишком слабый: минимум 24 символа, не changeme / change-me-…. Локально можно AUTH_ALLOW_INSECURE=1'
  if (env.allowInsecure) {
    console.warn(msg)
    return
  }
  console.error(msg)
  process.exit(1)
}

export function safeEqual(a: unknown, b: unknown): boolean {
  const left = Buffer.from(String(a), 'utf8')
  const right = Buffer.from(String(b), 'utf8')
  const len = Math.max(left.length, right.length, 1)
  const la = Buffer.alloc(len)
  const ra = Buffer.alloc(len)
  left.copy(la)
  right.copy(ra)
  return crypto.timingSafeEqual(la, ra) && left.length === right.length
}

export function checkCredentials(
  login: string,
  password: string,
): { ok: true } | { ok: false; error: string } {
  const env = authEnv()
  if (!env.login || !env.password) {
    return { ok: false, error: 'EDITOR_LOGIN / EDITOR_PASSWORD не заданы в .env' }
  }
  if (!env.secret) {
    return { ok: false, error: 'AUTH_SECRET не задан в .env' }
  }
  if (!safeEqual(login, env.login) || !safeEqual(password, env.password)) {
    return { ok: false, error: 'Неверный логин или пароль' }
  }
  return { ok: true }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function issueToken(userId: string, { remember = false }: { remember?: boolean } = {}): string {
  if (!userId || !UUID_RE.test(String(userId))) {
    throw new Error('issueToken: нужен user id')
  }
  const exp = String(Date.now() + (remember ? REMEMBER_TTL_MS : TOKEN_TTL_MS))
  const payload = `${exp}.${userId}`
  const sig = crypto.createHmac('sha256', authEnv().secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

export function readSession(token: string | null | undefined): { userId: string; exp: number } | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [exp, userId, sig] = parts
  if (!exp || !userId || !sig || !/^\d+$/.test(exp) || !UUID_RE.test(userId)) return null
  if (Number(exp) < Date.now()) return null
  const expected = crypto.createHmac('sha256', authEnv().secret).update(`${exp}.${userId}`).digest('hex')
  if (!safeEqual(sig, expected)) return null
  return { userId, exp: Number(exp) }
}

export function verifyToken(token: string | null | undefined): boolean {
  return Boolean(readSession(token))
}

type HeaderCarrier = {
  headers?: IncomingMessage['headers'] | Record<string, string | string[] | undefined>
  /** net.Socket | tls.TLSSocket — encrypted есть только у TLS. */
  socket?: object | null
}

export function bearerToken(req: HeaderCarrier): string {
  const raw = req.headers?.authorization
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return ''
  const m = String(value).match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() ?? ''
}

export function cookieToken(req: HeaderCarrier, name = SESSION_COOKIE): string {
  const raw = req.headers?.cookie
  const header = Array.isArray(raw) ? raw[0] : raw
  if (!header) return ''
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    if (key !== name) continue
    const value = part.slice(eq + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return ''
}

/** Bearer или httpOnly cookie. */
export function requestSessionToken(req: HeaderCarrier): string {
  return bearerToken(req) || cookieToken(req)
}

export function requestIsHttps(req: HeaderCarrier): boolean {
  const raw = req?.headers?.['x-forwarded-proto']
  const value = Array.isArray(raw) ? raw[0] : raw
  const proto = String(value || '').split(',')[0].trim().toLowerCase()
  if (proto === 'https') return true
  const sock = req?.socket as { encrypted?: boolean } | null | undefined
  return Boolean(sock?.encrypted)
}

function cookieHeader(
  token: string,
  { remember = false, secure = false, clear = false }: { remember?: boolean; secure?: boolean; clear?: boolean } = {},
): string {
  const maxAge = clear ? 0 : Math.floor((remember ? REMEMBER_TTL_MS : TOKEN_TTL_MS) / 1000)
  const parts = [
    `${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function setSessionCookie(
  res: ServerResponse,
  token: string,
  { remember = false, secure = false }: { remember?: boolean; secure?: boolean } = {},
): void {
  res.setHeader('Set-Cookie', cookieHeader(token, { remember, secure }))
}

export function clearSessionCookie(
  res: ServerResponse,
  { secure = false }: { secure?: boolean } = {},
): void {
  res.setHeader('Set-Cookie', cookieHeader('', { secure, clear: true }))
}

export function isPublicApi(url: string, method: string): boolean {
  if (url === '/health' || url === '/api/health') return true
  if (url === '/api/auth/login' && method === 'POST') return true
  if (url === '/api/auth/register' && method === 'POST') return true
  if (url === '/api/auth/logout' && method === 'POST') return true
  if (url === '/api/auth/registration' && (method === 'GET' || method === 'HEAD')) return true
  if (url === '/api/auth/forgot' && method === 'POST') return true
  if (url === '/api/auth/otp/verify' && method === 'POST') return true
  if (url === '/api/auth/otp/resend' && method === 'POST') return true
  if (url === '/api/auth/reset' && method === 'POST') return true
  if (
    (url === '/api/auth/join' || url === '/api/auth/join/') &&
    (method === 'GET' || method === 'HEAD' || method === 'POST')
  ) {
    return true
  }
  if (url === '/api/auth/me' && (method === 'GET' || method === 'HEAD')) return true
  if (url.startsWith('/api/public/') && (method === 'GET' || method === 'HEAD')) return true
  if (url.startsWith('/api/public/') && method === 'POST') return true
  return false
}

export function isProjectKeyApi(url: string): boolean {
  return String(url ?? '').startsWith('/api/v1/')
}

export function isProtectedApi(url: string, method: string): boolean {
  if (!url.startsWith('/api/')) return false
  if (isPublicApi(url, method)) return false
  if (isProjectKeyApi(url)) return false
  return true
}
