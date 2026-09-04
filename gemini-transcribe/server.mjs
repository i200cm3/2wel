import crypto from 'node:crypto'
import http from 'node:http'
import { loadEnvFile, env } from './env.mjs'
import { generateText, transcribeFromUrl } from './lib.mjs'

loadEnvFile()

const PORT = Number(env('PORT', '3100'))
const SECRET = env('GEMINI_TRANSCRIBE_SECRET')
const API_KEY = env('GEMINI_API_KEY')
const MODEL = env('GEMINI_MODEL', 'gemini-3.5-flash')
const MODEL_FALLBACKS = env('GEMINI_MODEL_FALLBACKS')
const MAX_AUDIO_BYTES = Number(env('MAX_AUDIO_BYTES', String(20 * 1024 * 1024)))
const DOWNLOAD_TIMEOUT_MS = Number(env('DOWNLOAD_TIMEOUT_MS', '120000'))
const GEMINI_TIMEOUT_MS = Number(env('GEMINI_TIMEOUT_MS', '180000'))
const MAX_GENERATE_BYTES = Number(env('MAX_GENERATE_BYTES', String(512 * 1024)))
const ALLOW_IPS = env('GEMINI_TRANSCRIBE_ALLOW_IPS')
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

function ipAllowed(req) {
  if (!ALLOW_IPS.length) return true
  if (env('GEMINI_TRANSCRIBE_TRUST_SECRET') === '1' && secretOk(req)) return true
  const ip = clientIp(req)
  if (isLocalhost(ip)) return true
  return ALLOW_IPS.some((allowed) => ip === allowed || ip.endsWith(allowed))
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

function authorize(req, res) {
  if (!API_KEY || !SECRET) {
    json(res, 503, { error: 'service not configured' })
    return false
  }
  if (!secretOk(req)) {
    json(res, 401, { error: 'unauthorized' })
    return false
  }
  if (!ipAllowed(req)) {
    json(res, 403, { error: 'forbidden' })
    return false
  }
  return true
}

async function handleTranscribe(req, res) {
  if (!authorize(req, res)) return

  let payload
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'))
  } catch {
    json(res, 400, { error: 'invalid json' })
    return
  }

  const audioUrl = String(payload?.url ?? '').trim()
  if (!audioUrl) {
    json(res, 400, { error: 'url required' })
    return
  }

  try {
    new URL(audioUrl)
  } catch {
    json(res, 400, { error: 'invalid url' })
    return
  }

  const language = String(payload?.language ?? env('GEMINI_TRANSCRIBE_LANGUAGE', '')).trim()
  const prompt = String(payload?.prompt ?? env('GEMINI_TRANSCRIBE_PROMPT', '')).trim()

  const result = await transcribeFromUrl(audioUrl, {
    apiKey: API_KEY,
    model: MODEL,
    modelFallbacks: MODEL_FALLBACKS,
    prompt: prompt || undefined,
    language: language || undefined,
    maxBytes: MAX_AUDIO_BYTES,
    downloadTimeoutMs: DOWNLOAD_TIMEOUT_MS,
    geminiTimeoutMs: GEMINI_TIMEOUT_MS,
  })

  if (!result.ok) {
    json(res, result.status, { error: result.error, detail: result.detail ?? '' })
    return
  }

  json(res, 200, {
    text: result.text,
    model: result.model,
    mimeType: result.mimeType,
    bytes: result.bytes,
  })
}

async function handleGenerate(req, res) {
  if (!authorize(req, res)) return

  let payload
  try {
    payload = JSON.parse((await readBody(req, MAX_GENERATE_BYTES)).toString('utf8'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    json(res, message === 'payload too large' ? 413 : 400, {
      error: message === 'payload too large' ? 'payload too large' : 'invalid json',
    })
    return
  }

  const prompt = String(payload?.prompt ?? '').trim()
  if (!prompt) {
    json(res, 400, { error: 'prompt required' })
    return
  }

  const temperatureRaw = Number(payload?.temperature)
  const temperature = Number.isFinite(temperatureRaw) ? temperatureRaw : 0.1

  const result = await generateText(prompt, {
    apiKey: API_KEY,
    model: MODEL,
    modelFallbacks: MODEL_FALLBACKS,
    temperature,
    geminiTimeoutMs: GEMINI_TIMEOUT_MS,
  })

  if (!result.ok) {
    json(res, result.status, { error: result.error, detail: result.detail ?? '' })
    return
  }

  json(res, 200, {
    text: result.text,
    model: result.model,
  })
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET'
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (method === 'GET' && url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      gemini: Boolean(API_KEY),
      auth: Boolean(SECRET),
      model: MODEL,
    })
    return
  }

  if (method === 'POST' && url.pathname === '/v1/transcribe') {
    await handleTranscribe(req, res)
    return
  }

  if (method === 'POST' && url.pathname === '/v1/generate') {
    await handleGenerate(req, res)
    return
  }

  json(res, 404, { error: 'not found' })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gemini proxy listening on :${PORT}`)
})
