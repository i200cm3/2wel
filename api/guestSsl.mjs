import dns from 'node:dns/promises'
import { authEnv, bearerToken, safeEqual } from './auth.js'
import { guestBaseDomain } from './publicUrl.mjs'
import { loadEnv } from './env.js'

const PROJECT_CODE_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/
const inFlight = new Map()

export function guestHostname(projectCode) {
  const code = String(projectCode ?? '').trim().toLowerCase()
  const base = guestBaseDomain()
  if (!PROJECT_CODE_RE.test(code)) return base
  return `${code}.${base}`
}

export function parseSanNames(text) {
  const names = []
  const re = /DNS:\s*([A-Za-z0-9*.-]+)/g
  let match
  while ((match = re.exec(String(text ?? '')))) {
    names.push(match[1].trim().toLowerCase())
  }
  return [...new Set(names)]
}

export function guestSslEnsureUrl() {
  loadEnv()
  return String(process.env.GUEST_SSL_ENSURE_URL ?? '').trim()
}

export function guestSslEnabled() {
  loadEnv()
  const flag = String(process.env.ENSURE_GUEST_SSL ?? '').trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

export function guestSslEnsureHeaders() {
  const secret = authEnv().secret
  const headers = { 'content-type': 'application/json' }
  if (secret) headers.authorization = `Bearer ${secret}`
  return headers
}

export function guestSslRequestAuthorized(req) {
  const expected = authEnv().secret
  if (!expected) return false
  const got = bearerToken(req)
  return Boolean(got) && safeEqual(got, expected)
}

export async function lookupGuestHost(hostname) {
  try {
    const { address } = await dns.lookup(hostname)
    return address || null
  } catch {
    return null
  }
}

export async function probeGuestHttps(hostname) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(`https://${hostname}/`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: ctrl.signal,
    })
    return res.status > 0 && res.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function inspectGuestHost(projectCode) {
  const host = guestHostname(projectCode)
  const [ip, httpsOk] = await Promise.all([lookupGuestHost(host), probeGuestHttps(host)])
  return { host, ip, httpsOk }
}

/**
 * Проверяет {code}.2wel.ru и при необходимости просит агент дописать SSL.
 * Nginx не трогаем по одному отелю: server_name уже *.2wel.ru.
 */
export async function ensureGuestHost(projectCode) {
  const host = guestHostname(projectCode)
  if (!guestSslEnabled()) {
    return { ok: true, skipped: true, host }
  }
  const pending = inFlight.get(host)
  if (pending) return pending
  const job = ensureGuestHostOnce(host)
  inFlight.set(host, job)
  try {
    return await job
  } finally {
    inFlight.delete(host)
  }
}

async function ensureGuestHostOnce(host) {
  const httpsOk = await probeGuestHttps(host)
  if (httpsOk) return { ok: true, host, already: true }

  const ip = await lookupGuestHost(host)
  if (!ip) {
    return {
      ok: false,
      host,
      error:
        'Нет DNS для поддомена. Один раз добавьте A-запись * → IP сервера (wildcard *.2wel.ru). Nginx править не нужно.',
    }
  }

  const url = guestSslEnsureUrl()
  if (!url) {
    return { ok: false, host, error: 'GUEST_SSL_ENSURE_URL не задан' }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120_000)
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/ensure`, {
      method: 'POST',
      headers: guestSslEnsureHeaders(),
      body: JSON.stringify({ host }),
      signal: ctrl.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        host,
        error: data.error || `SSL-агент ответил ${res.status}`,
      }
    }
    return { ok: true, host, ...data }
  } catch (err) {
    return {
      ok: false,
      host,
      error: err instanceof Error ? err.message : 'Не удалось связаться с SSL-агентом',
    }
  } finally {
    clearTimeout(timer)
  }
}
