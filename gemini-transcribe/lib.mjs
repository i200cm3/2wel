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

const DEFAULT_MODEL_FALLBACKS = ['gemini-3.6-flash']

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildModelList(options = {}) {
  const primary = String(options.model ?? 'gemini-3.5-flash').trim()
  const fromEnv = String(options.modelFallbacks ?? '')
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

export function mimeFromUrl(url) {
  const path = String(url).split('?')[0].split('#')[0]
  const ext = path.includes('.') ? path.split('.').pop()?.toLowerCase() : ''
  return MIME_BY_EXT[ext] ?? null
}

export function normalizeMimeType(value, url = '') {
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

export async function downloadAudio(url, { maxBytes, timeoutMs }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { Accept: 'audio/*,*/*' },
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 400)
      return {
        ok: false,
        status: 400,
        error: `Не удалось загрузить аудио: HTTP ${res.status}`,
        detail,
      }
    }

    const chunks = []
    let size = 0
    const body = res.body
    if (!body) {
      return { ok: false, status: 400, error: 'Пустой ответ при загрузке аудио' }
    }

    for await (const chunk of body) {
      size += chunk.byteLength
      if (size > maxBytes) {
        return {
          ok: false,
          status: 400,
          error: `Файл слишком большой (лимит ${maxBytes} байт)`,
        }
      }
      chunks.push(chunk)
    }

    const buffer = Buffer.concat(chunks)
    const mimeType = normalizeMimeType(res.headers.get('content-type'), url)
    return { ok: true, buffer, mimeType, bytes: buffer.byteLength }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 504 : 400,
      error: err?.name === 'AbortError' ? 'Таймаут загрузки аудио' : 'Ошибка загрузки аудио',
      detail: message,
    }
  } finally {
    clearTimeout(timer)
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

export async function transcribeWithGemini({
  apiKey,
  model,
  buffer,
  mimeType,
  prompt = DEFAULT_PROMPT,
  language,
  timeoutMs,
}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const textPrompt = language
    ? `${prompt}\n\nЯзык аудио (подсказка): ${language}.`
    : prompt
  const geminiMime = mimeForGemini(mimeType)

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      signal: ctrl.signal,
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
        generationConfig: {
          temperature: 0.1,
        },
      }),
    })

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
        status: res.status >= 500 ? 502 : 502,
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
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 504 : 502,
      error: err?.name === 'AbortError' ? 'Gemini не ответил вовремя' : 'Gemini недоступен',
      detail: message,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Текстовый generateContent (без аудио). */
export async function generateTextWithGemini({
  apiKey,
  model,
  prompt,
  temperature = 0.1,
  timeoutMs,
}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: String(prompt ?? '') }] }],
        generationConfig: { temperature },
      }),
    })

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
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 504 : 502,
      error: err?.name === 'AbortError' ? 'Gemini не ответил вовремя' : 'Gemini недоступен',
      detail: message,
      retryable: err?.name === 'AbortError',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function generateText(prompt, options = {}) {
  const text = String(prompt ?? '').trim()
  if (!text) {
    return { ok: false, status: 400, error: 'prompt required' }
  }

  const temperature = Number.isFinite(options.temperature) ? options.temperature : 0.1
  const models = buildModelList(options)
  let lastError = null

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(2500 * attempt)

      const gemini = await generateTextWithGemini({
        apiKey: options.apiKey,
        model,
        prompt: text,
        temperature,
        timeoutMs: options.geminiTimeoutMs,
      })

      if (gemini.ok) {
        return { ok: true, text: gemini.text, model: gemini.model }
      }

      lastError = gemini
      if (!gemini.retryable) break
    }
  }

  return lastError ?? { ok: false, status: 502, error: 'Gemini не ответил' }
}

export async function transcribeFromUrl(url, options) {
  const download = await downloadAudio(url, {
    maxBytes: options.maxBytes,
    timeoutMs: options.downloadTimeoutMs,
  })
  if (!download.ok) return download

  const models = buildModelList(options)
  let lastError = null

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(2500 * attempt)

      const gemini = await transcribeWithGemini({
        apiKey: options.apiKey,
        model,
        buffer: download.buffer,
        mimeType: download.mimeType,
        prompt: options.prompt,
        language: options.language,
        timeoutMs: options.geminiTimeoutMs,
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
