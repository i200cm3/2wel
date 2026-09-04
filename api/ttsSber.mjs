import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import { loadEnv } from './env.mjs'

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
const SYNTH_URL = 'https://smartspeech.sber.ru/rest/v1/text:synthesize'
const TOKEN_SKEW_MS = 60_000
const OAUTH_TIMEOUT_MS = 20_000
const SYNTH_TIMEOUT_MS = 60_000

/** Синтез отдаёт wav16: играет везде, дальше сжимаем в mp3. */
const SYNTH_FORMAT = 'wav16'

let cachedToken = null

function env(key, fallback = '') {
  loadEnv()
  return String(process.env[key] ?? fallback).trim()
}

function basicAuthKey() {
  const direct = env('SALUTE_SPEECH_AUTH_KEY')
  if (direct) return direct
  const id = env('SALUTE_SPEECH_CLIENT_ID')
  const secret = env('SALUTE_SPEECH_CLIENT_SECRET')
  if (!id || !secret) return ''
  return Buffer.from(`${id}:${secret}`, 'utf8').toString('base64')
}

/**
 * У Сбера цепочка на «Russian Trusted Root CA»: на обычном образе её нет,
 * поэтому корневой сертификат подкладывается файлом.
 */
function tlsOptions() {
  const caFile = env('SALUTE_SPEECH_CA_FILE')
  const insecure = ['1', 'true', 'yes'].includes(env('SALUTE_SPEECH_TLS_INSECURE').toLowerCase())
  const options = {}
  if (caFile && fs.existsSync(caFile)) options.ca = fs.readFileSync(caFile)
  if (insecure) options.rejectUnauthorized = false
  return options
}

function httpsPost(url, { headers = {}, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8')
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(payload.byteLength) },
        ...tlsOptions(),
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers['content-type'] ?? ''),
            buffer: Buffer.concat(chunks),
          }),
        )
      },
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`${target.host} не ответил за ${Math.round(timeoutMs / 1000)} с`))
    })
    req.on('error', reject)
    req.end(payload)
  })
}

async function accessToken() {
  const key = basicAuthKey()
  if (!key) {
    return { ok: false, status: 500, error: 'Не задан SALUTE_SPEECH_AUTH_KEY' }
  }
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt - TOKEN_SKEW_MS > Date.now()) {
    return { ok: true, token: cachedToken.token }
  }

  let res
  try {
    res = await httpsPost(
      OAUTH_URL,
      {
        headers: {
          Authorization: `Basic ${key}`,
          RqUID: crypto.randomUUID(),
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ scope: env('SALUTE_SPEECH_SCOPE', 'SALUTE_SPEECH_PERS') }).toString(),
        timeoutMs: OAUTH_TIMEOUT_MS,
      },
    )
  } catch (err) {
    return {
      ok: false,
      status: 504,
      error: 'SaluteSpeech не отдал токен',
      detail: err instanceof Error ? err.message : '',
    }
  }

  if (res.status !== 200) {
    return {
      ok: false,
      status: 502,
      error: `SaluteSpeech OAuth HTTP ${res.status}`,
      detail: res.buffer.toString('utf8').slice(0, 800),
    }
  }

  let data
  try {
    data = JSON.parse(res.buffer.toString('utf8'))
  } catch {
    return { ok: false, status: 502, error: 'SaluteSpeech вернул не JSON на OAuth' }
  }
  const token = String(data.access_token ?? '')
  if (!token) {
    return { ok: false, status: 502, error: 'SaluteSpeech не вернул access_token' }
  }
  const expiresAt = Number(data.expires_at)
  cachedToken = {
    key,
    token,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt : Date.now() + 25 * 60_000,
  }
  return { ok: true, token }
}

/** @returns {Promise<{ok: true, buffer: Buffer, ext: string} | {ok: false, status: number, error: string, detail?: string}>} */
export async function synthesizeSber(text, voice) {
  const auth = await accessToken()
  if (!auth.ok) return auth

  const url = `${SYNTH_URL}?format=${SYNTH_FORMAT}&voice=${encodeURIComponent(voice)}`
  let res
  try {
    res = await httpsPost(url, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/text',
      },
      body: text,
      timeoutMs: SYNTH_TIMEOUT_MS,
    })
  } catch (err) {
    return {
      ok: false,
      status: 504,
      error: 'SaluteSpeech не ответил',
      detail: err instanceof Error ? err.message : '',
    }
  }

  if (res.status === 401) {
    cachedToken = null
  }
  if (res.status !== 200) {
    return {
      ok: false,
      status: 502,
      error: `SaluteSpeech HTTP ${res.status}`,
      detail: res.buffer.toString('utf8').slice(0, 800),
    }
  }
  if (!res.buffer.byteLength) {
    return { ok: false, status: 502, error: 'SaluteSpeech вернул пустой ответ' }
  }
  return { ok: true, buffer: res.buffer, ext: 'wav' }
}
