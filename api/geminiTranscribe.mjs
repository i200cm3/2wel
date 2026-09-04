import { loadEnv } from './env.js'
import { fetchWithTimeout } from './fetchTimeout.mjs'

const MIME_BY_EXT = {
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac',
  aac: 'audio/aac',
}

const DEFAULT_PROMPT =
  'Транскрибируй этот аудиофайл. Выведи только текст расшифровки на языке оригинала. ' +
  'Если несколько говорящих — помечай «Говорящий 1:», «Говорящий 2:» и т.д.'

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000
const DEFAULT_GEMINI_TIMEOUT_MS = 180_000
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_MODEL_FALLBACKS = ['gemini-3.6-flash', 'gemini-2.5-pro']

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildModelList(options = {}) {
  const primary = String(options.model ?? env('GEMINI_MODEL', 'gemini-3.5-flash')).trim()
  const fromEnv = String(options.modelFallbacks ?? env('GEMINI_MODEL_FALLBACKS', ''))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const out = []
  for (const model of [primary, ...fromEnv, ...DEFAULT_MODEL_FALLBACKS]) {
    if (model && !out.includes(model)) out.push(model)
  }
  return out
}

function isTransientGeminiError(result, httpStatus = 0) {
  const msg = `${result?.error ?? ''} ${result?.detail ?? ''}`.toLowerCase()
  if (/high demand|overloaded|capacity|resource exhausted|try again|unavailable|rate limit/.test(msg)) {
    return true
  }
  return httpStatus === 429 || httpStatus === 503 || httpStatus === 502
}

function env(key, fallback = '') {
  loadEnv()
  return String(process.env[key] ?? fallback).trim()
}

export function geminiTranscribeConfigured() {
  return Boolean(env('GEMINI_TRANSCRIBE_URL') || env('GEMINI_API_KEY'))
}

function proxyErrorMessage(payload, status) {
  const detail = String(payload?.detail ?? '').trim()
  const error = String(payload?.error ?? '').trim()
  if (detail && error && !detail.includes(error)) return `${error}: ${detail}`
  return detail || error || `Прокси транскрибации HTTP ${status}`
}

async function transcribeViaProxy(proxyBase, audioUrl, options = {}) {
  const secret = env('GEMINI_TRANSCRIBE_SECRET')
  if (!secret) {
    return { ok: false, status: 503, error: 'Не задан GEMINI_TRANSCRIBE_SECRET' }
  }

  const downloadTimeoutMs =
    options.downloadTimeoutMs ??
    Number(env('DOWNLOAD_TIMEOUT_MS', String(DEFAULT_DOWNLOAD_TIMEOUT_MS)))
  const geminiTimeoutMs =
    options.geminiTimeoutMs ?? Number(env('GEMINI_TIMEOUT_MS', String(DEFAULT_GEMINI_TIMEOUT_MS)))
  const timeoutMs = downloadTimeoutMs + geminiTimeoutMs

  const language = options.language ?? env('GEMINI_TRANSCRIBE_LANGUAGE')
  const promptHint = options.prompt ?? env('GEMINI_TRANSCRIBE_PROMPT')
  const body = { url: audioUrl }
  if (language) body.language = language
  if (promptHint) body.prompt = promptHint

  const started = Date.now()
  try {
    const res = await fetchWithTimeout(
      `${proxyBase.replace(/\/$/, '')}/v1/transcribe`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
    )

    const raw = await res.text()
    let payload = {}
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      payload = { detail: raw.slice(0, 800) }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status >= 500 ? 502 : res.status,
        error: proxyErrorMessage(payload, res.status),
        detail: String(payload?.detail ?? '').trim() || undefined,
      }
    }

    const text = String(payload?.text ?? '').trim()
    if (!text) {
      return {
        ok: false,
        status: 502,
        error: 'Прокси не вернул текст транскрибации',
        detail: raw.slice(0, 800),
      }
    }

    console.info(
      'transcribe proxy',
      JSON.stringify({
        ms: Date.now() - started,
        model: String(payload?.model ?? '').trim() || null,
        bytes: Number(payload?.bytes) || null,
        textLen: text.length,
      }),
    )

    return {
      ok: true,
      text,
      model: String(payload?.model ?? '').trim() || env('GEMINI_MODEL', 'gemini-3.6-flash'),
      mimeType: String(payload?.mimeType ?? '').trim() || undefined,
      bytes: Number(payload?.bytes) || undefined,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      status: timeout ? 504 : 502,
      error: timeout ? 'Прокси транскрибации не ответил' : 'Прокси транскрибации недоступен',
      detail: message,
    }
  }
}

function mimeFromUrl(url) {
  const path = String(url).split('?')[0].split('#')[0]
  const ext = path.includes('.') ? path.split('.').pop()?.toLowerCase() : ''
  return MIME_BY_EXT[ext] ?? null
}

function normalizeMimeType(value, url = '') {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return mimeFromUrl(url) ?? 'audio/mpeg'
  if (raw.startsWith('audio/')) return raw
  if (raw === 'application/octet-stream') return mimeFromUrl(url) ?? 'audio/mpeg'
  return MIME_BY_EXT[raw.replace(/^\./, '')] ?? mimeFromUrl(url) ?? 'audio/mpeg'
}

/** Gemini лучше принимает audio/mp3, а Sipuni отдаёт audio/mpeg. */
function mimeForGemini(mimeType) {
  const raw = String(mimeType ?? '').trim().toLowerCase()
  if (raw === 'audio/mpeg' || raw === 'audio/mpga') return 'audio/mp3'
  return raw || 'audio/mp3'
}

async function readStreamWithLimit(body, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of body) {
    size += chunk.byteLength
    if (size > maxBytes) {
      return { ok: false, error: `Файл слишком большой (лимит ${maxBytes} байт)` }
    }
    chunks.push(chunk)
  }
  return { ok: true, buffer: Buffer.concat(chunks), bytes: size }
}

export async function downloadAudio(url, options = {}) {
  const maxBytes = options.maxBytes ?? Number(env('MAX_AUDIO_BYTES', String(DEFAULT_MAX_BYTES)))
  const timeoutMs = options.timeoutMs ?? Number(env('DOWNLOAD_TIMEOUT_MS', String(DEFAULT_DOWNLOAD_TIMEOUT_MS)))

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'audio/*,*/*' },
      },
      timeoutMs,
    )
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 400)
      return {
        ok: false,
        status: 400,
        error: `Не удалось загрузить аудио: HTTP ${res.status}`,
        detail,
      }
    }
    if (!res.body) {
      return { ok: false, status: 400, error: 'Пустой ответ при загрузке аудио' }
    }
    const read = await readStreamWithLimit(res.body, maxBytes)
    if (!read.ok) {
      return { ok: false, status: 400, error: read.error }
    }
    const mimeType = normalizeMimeType(res.headers.get('content-type'), url)
    return { ok: true, buffer: read.buffer, mimeType, bytes: read.bytes }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      status: timeout ? 504 : 400,
      error: timeout ? 'Таймаут загрузки аудио' : 'Ошибка загрузки аудио',
      detail: message,
    }
  }
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim()
}

export async function transcribeWithGemini({ buffer, mimeType, prompt, language, options = {} }) {
  const apiKey = env('GEMINI_API_KEY')
  if (!apiKey) {
    return { ok: false, status: 503, error: 'GEMINI_API_KEY не задан' }
  }

  const model = options.model ?? env('GEMINI_MODEL', 'gemini-3.5-flash')
  const timeoutMs =
    options.timeoutMs ?? Number(env('GEMINI_TIMEOUT_MS', String(DEFAULT_GEMINI_TIMEOUT_MS)))
  const textPrompt = language
    ? `${prompt ?? DEFAULT_PROMPT}\n\nЯзык аудио (подсказка): ${language}.`
    : prompt ?? DEFAULT_PROMPT
  const geminiMime = mimeForGemini(mimeType)

  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

  try {
    const res = await fetchWithTimeout(
      geminiUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: textPrompt },
                {
                  inline_data: {
                    mime_type: geminiMime,
                    data: buffer.toString('base64'),
                  },
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.1 },
        }),
      },
      timeoutMs,
    )

    const raw = await res.text()
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      body = { detail: raw.slice(0, 800) }
    }

    if (!res.ok) {
      const detail =
        body?.error?.message ||
        body?.message ||
        (typeof body?.detail === 'string' ? body.detail : JSON.stringify(body).slice(0, 800))
      return {
        ok: false,
        status: 502,
        httpStatus: res.status,
        error: `Gemini HTTP ${res.status}`,
        detail,
        retryable: isTransientGeminiError({ error: detail, detail }, res.status),
      }
    }

    const text = extractGeminiText(body)
    if (!text) {
      return {
        ok: false,
        status: 502,
        error: 'Gemini не вернул текст',
        detail: JSON.stringify(body).slice(0, 800),
      }
    }

    return { ok: true, text, model }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      status: timeout ? 504 : 502,
      error: timeout ? 'Gemini не ответил вовремя' : 'Gemini недоступен',
      detail: message,
    }
  }
}

export function geminiTextConfigured() {
  return Boolean(env('GEMINI_TRANSCRIBE_URL') || env('GEMINI_API_KEY'))
}

async function generateTextViaProxy(proxyBase, prompt, options = {}) {
  const secret = env('GEMINI_TRANSCRIBE_SECRET')
  if (!secret) {
    return { ok: false, status: 503, error: 'Не задан GEMINI_TRANSCRIBE_SECRET' }
  }

  const timeoutMs =
    options.timeoutMs ?? Number(env('GEMINI_TIMEOUT_MS', String(DEFAULT_GEMINI_TIMEOUT_MS)))
  const temperature = Number.isFinite(options.temperature) ? options.temperature : 0.1
  const body = { prompt: String(prompt ?? '') }
  if (Number.isFinite(temperature)) body.temperature = temperature

  const started = Date.now()
  try {
    const res = await fetchWithTimeout(
      `${proxyBase.replace(/\/$/, '')}/v1/generate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
    )

    const raw = await res.text()
    let payload = {}
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      payload = { detail: raw.slice(0, 800) }
    }

    if (!res.ok) {
      const status = res.status >= 500 ? 502 : res.status
      let error = proxyErrorMessage(payload, res.status)
      if (res.status === 404) {
        error =
          'Прокси Gemini не знает /v1/generate — обновите gemini-transcribe на VDS (./deploy-to-vds.sh)'
      }
      return {
        ok: false,
        status,
        error,
        detail: String(payload?.detail ?? payload?.error ?? '').trim() || undefined,
      }
    }

    const text = String(payload?.text ?? '').trim()
    if (!text) {
      return {
        ok: false,
        status: 502,
        error: 'Прокси не вернул текст',
        detail: raw.slice(0, 800),
      }
    }

    console.info(
      'generate proxy',
      JSON.stringify({
        ms: Date.now() - started,
        model: String(payload?.model ?? '').trim() || null,
        textLen: text.length,
        promptLen: String(prompt ?? '').length,
      }),
    )

    return {
      ok: true,
      text,
      model: String(payload?.model ?? '').trim() || env('GEMINI_MODEL', 'gemini-3.6-flash'),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      status: timeout ? 504 : 502,
      error: timeout ? 'Прокси Gemini не ответил' : 'Прокси Gemini недоступен',
      detail: message,
    }
  }
}

async function generateTextDirect(prompt, options = {}) {
  const apiKey = env('GEMINI_API_KEY')
  if (!apiKey) {
    return { ok: false, status: 503, error: 'GEMINI_API_KEY не задан' }
  }

  const timeoutMs =
    options.timeoutMs ?? Number(env('GEMINI_TIMEOUT_MS', String(DEFAULT_GEMINI_TIMEOUT_MS)))
  const temperature = Number.isFinite(options.temperature) ? options.temperature : 0.1
  const models = buildModelList(options)
  let lastError = null

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(2500 * attempt)
      const geminiUrl =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      try {
        const res = await fetchWithTimeout(
          geminiUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: String(prompt ?? '') }] }],
              generationConfig: { temperature },
            }),
          },
          timeoutMs,
        )

        const raw = await res.text()
        let body = {}
        try {
          body = raw ? JSON.parse(raw) : {}
        } catch {
          body = { detail: raw.slice(0, 800) }
        }

        if (!res.ok) {
          const detail =
            body?.error?.message ||
            body?.message ||
            (typeof body?.detail === 'string' ? body.detail : JSON.stringify(body).slice(0, 800))
          lastError = {
            ok: false,
            status: 502,
            httpStatus: res.status,
            error: `Gemini HTTP ${res.status}`,
            detail,
            retryable: isTransientGeminiError({ error: detail, detail }, res.status),
          }
          if (!lastError.retryable) break
          continue
        }

        const text = extractGeminiText(body)
        if (!text) {
          lastError = {
            ok: false,
            status: 502,
            error: 'Gemini не вернул текст',
            detail: JSON.stringify(body).slice(0, 800),
            retryable: false,
          }
          break
        }

        return { ok: true, text, model }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        lastError = {
          ok: false,
          status: timeout ? 504 : 502,
          error: timeout ? 'Gemini не ответил вовремя' : 'Gemini недоступен',
          detail: message,
          retryable: timeout,
        }
        if (!timeout) break
      }
    }
  }

  return lastError ?? { ok: false, status: 502, error: 'Gemini не ответил' }
}

/** Текстовый generateContent: через VDS-прокси, иначе напрямую. */
export async function generateTextWithGemini(prompt, options = {}) {
  const proxyUrl = env('GEMINI_TRANSCRIBE_URL')
  if (proxyUrl) return generateTextViaProxy(proxyUrl, prompt, options)
  return generateTextDirect(prompt, options)
}

export async function transcribeAudioFromUrl(url, options = {}) {
  const audioUrl = String(url ?? '').trim()
  if (!audioUrl) {
    return { ok: false, status: 400, error: 'Укажите URL аудио' }
  }
  try {
    new URL(audioUrl)
  } catch {
    return { ok: false, status: 400, error: 'Некорректный URL аудио' }
  }

  const proxyUrl = env('GEMINI_TRANSCRIBE_URL')
  if (proxyUrl) return transcribeViaProxy(proxyUrl, audioUrl, options)

  const download = await downloadAudio(audioUrl, options)
  if (!download.ok) return download

  const language = options.language ?? env('GEMINI_TRANSCRIBE_LANGUAGE')
  const promptHint = options.prompt ?? env('GEMINI_TRANSCRIBE_PROMPT')
  const models = buildModelList(options)
  let lastError = null

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(2500 * attempt)
      const gemini = await transcribeWithGemini({
        buffer: download.buffer,
        mimeType: download.mimeType,
        prompt: promptHint || undefined,
        language: language || undefined,
        options: { ...options, model },
      })
      if (gemini.ok) {
        return {
          ok: true,
          text: gemini.text,
          model: gemini.model,
          mimeType: download.mimeType,
          bytes: download.bytes,
        }
      }
      lastError = gemini
      if (!gemini.retryable) break
    }
  }

  return lastError ?? { ok: false, status: 502, error: 'Gemini не ответил' }
}
