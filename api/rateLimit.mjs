const buckets = new Map()

function prune(now) {
  if (buckets.size < 4000) return
  for (const [key, times] of buckets) {
    const kept = times.filter((t) => now - t < 60 * 60 * 1000)
    if (kept.length) buckets.set(key, kept)
    else buckets.delete(key)
  }
}

export function clientIp(req) {
  const raw = req.headers?.['x-forwarded-for']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value) return String(value).split(',')[0].trim() || 'unknown'
  return req.socket?.remoteAddress || 'unknown'
}

/**
 * @returns {{ ok: true } | { ok: false, retryAfterSec: number }}
 */
export function consumeRateLimit(key, { windowMs, max }) {
  const now = Date.now()
  prune(now)
  const prev = buckets.get(key) ?? []
  const times = prev.filter((t) => now - t < windowMs)
  if (times.length >= max) {
    buckets.set(key, times)
    const retryAfterSec = Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000))
    return { ok: false, retryAfterSec }
  }
  times.push(now)
  buckets.set(key, times)
  return { ok: true }
}

export function rateLimited(res, json, retryAfterSec, message) {
  res.setHeader('Retry-After', String(retryAfterSec))
  json(res, 429, { error: message || 'Слишком много запросов. Подождите и повторите.' })
}
