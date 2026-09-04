import crypto from 'node:crypto'
import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAX_TEXT_CHARS = 1200
const ELEVEN_TIMEOUT_MS = 60_000

function loadEnvFile() {
  const path = resolve(__dirname, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvFile()

function env(key, fallback = '') {
  return String(process.env[key] ?? fallback).trim()
}

const PORT = Number(env('PORT', '3099'))
const SECRET = env('ELEVENLABS_PROXY_SECRET')
const API_KEY = env('ELEVENLABS_API_KEY')
const ALLOW_IPS = env('ELEVENLABS_PROXY_ALLOW_IPS')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim()
  return forwarded || req.socket.remoteAddress || ''
}

function isLocalhost(ip) {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.startsWith('127.')
  )
}

function ipAllowed(req) {
  if (!ALLOW_IPS.length) return true
  if (env('ELEVENLABS_PROXY_TRUST_SECRET') === '1' && secretOk(req)) return true
  const ip = clientIp(req)
  if (isLocalhost(ip)) return true
  return ALLOW_IPS.some((allowed) => ip === allowed || ip.endsWith(allowed))
}

function secretOk(req) {
  if (!SECRET) return false
  const raw = String(req.headers.authorization ?? '')
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : ''
  if (!token || token.length !== SECRET.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(SECRET))
  } catch {
    return false
  }
}

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readBody(req, maxBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > maxBytes) throw new Error('payload too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function synthesizeEleven({ text, voice, modelId, voiceSettings }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ELEVEN_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: voiceSettings,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 800)
      return { ok: false, status: 502, error: `ElevenLabs HTTP ${res.status}`, detail }
    }
    return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 504 : 502,
      error: err?.name === 'AbortError' ? 'ElevenLabs не ответил вовремя' : 'ElevenLabs недоступен',
      detail: message,
    }
  } finally {
    clearTimeout(timer)
  }
}

function elevenDetailMessage(detail) {
  if (!detail) return ''
  if (typeof detail === 'string') {
    try {
      const parsed = JSON.parse(detail)
      return elevenDetailMessage(parsed?.detail ?? parsed)
    } catch {
      return detail.slice(0, 800)
    }
  }
  if (typeof detail === 'object') {
    return String(detail.message || detail.status || JSON.stringify(detail)).slice(0, 800)
  }
  return String(detail).slice(0, 800)
}

async function fetchSubscription() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      method: 'GET',
      headers: { 'xi-api-key': API_KEY },
      signal: ctrl.signal,
    })
    const text = await res.text()
    let body = {}
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = { detail: text.slice(0, 800) }
    }
    if (!res.ok) {
      const message = elevenDetailMessage(body?.detail) || text.slice(0, 800)
      const missingPerm =
        (body?.detail && typeof body.detail === 'object' && body.detail.status === 'missing_permissions') ||
        /missing_permissions|user_read/i.test(message)
      return {
        ok: false,
        status: 502,
        error: missingPerm
          ? 'У API-ключа нет права user_read (нужно для баланса)'
          : `ElevenLabs HTTP ${res.status}`,
        detail: message,
      }
    }
    return { ok: true, body }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 504 : 502,
      error: err?.name === 'AbortError' ? 'ElevenLabs не ответил вовремя' : 'ElevenLabs недоступен',
      detail: message,
    }
  } finally {
    clearTimeout(timer)
  }
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET'
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (method === 'GET' && url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      elevenlabs: Boolean(API_KEY),
      auth: Boolean(SECRET),
    })
    return
  }

  if (method === 'GET' && url.pathname === '/v1/subscription') {
    if (!API_KEY || !SECRET) {
      json(res, 503, { error: 'proxy not configured' })
      return
    }
    if (!secretOk(req)) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    if (!ipAllowed(req)) {
      json(res, 403, { error: 'forbidden' })
      return
    }
    const result = await fetchSubscription()
    if (!result.ok) {
      json(res, result.status, { error: result.error, detail: result.detail ?? '' })
      return
    }
    json(res, 200, result.body)
    return
  }

  if (method !== 'POST' || url.pathname !== '/v1/synthesize') {
    json(res, 404, { error: 'not found' })
    return
  }

  if (!API_KEY || !SECRET) {
    json(res, 503, { error: 'proxy not configured' })
    return
  }

  if (!secretOk(req)) {
    json(res, 401, { error: 'unauthorized' })
    return
  }

  if (!ipAllowed(req)) {
    json(res, 403, { error: 'forbidden' })
    return
  }

  let payload
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'))
  } catch {
    json(res, 400, { error: 'invalid json' })
    return
  }

  const text = String(payload?.text ?? '').trim()
  const voice = String(payload?.voice ?? '').trim()
  if (!text || !voice) {
    json(res, 400, { error: 'text and voice required' })
    return
  }
  if (text.length > MAX_TEXT_CHARS) {
    json(res, 400, { error: `text too long (max ${MAX_TEXT_CHARS})` })
    return
  }

  const modelId = String(payload?.modelId ?? env('ELEVENLABS_MODEL_ID', 'eleven_v3'))
  const vs = payload?.voiceSettings && typeof payload.voiceSettings === 'object' ? payload.voiceSettings : {}
  const voiceSettings = {
    stability: Number(vs.stability ?? env('ELEVENLABS_STABILITY', '0.55')),
    similarity_boost: Number(vs.similarity_boost ?? env('ELEVENLABS_SIMILARITY_BOOST', '0.75')),
    style: Number(vs.style ?? env('ELEVENLABS_STYLE', '0.35')),
    use_speaker_boost: vs.use_speaker_boost !== false,
  }

  const result = await synthesizeEleven({ text, voice, modelId, voiceSettings })
  if (!result.ok) {
    json(res, result.status, { error: result.error, detail: result.detail ?? '' })
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'audio/mpeg')
  res.setHeader('Content-Length', String(result.buffer.byteLength))
  res.end(result.buffer)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ElevenLabs proxy listening on :${PORT}`)
})
