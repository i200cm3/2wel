import { loadEnv } from './env.js'
import { fetchWithTimeout } from './fetchTimeout.mjs'

const DEFAULT_TIMEOUT_MS = 180_000
const LIST_TIMEOUT_MS = 5_000

function env(key, fallback = '') {
  loadEnv()
  return String(process.env[key] ?? fallback).trim()
}

export function localLlmBaseUrl() {
  return env('LOCAL_LLM_URL').replace(/\/$/, '')
}

export function defaultLocalLlmModel() {
  return env('LOCAL_LLM_MODEL', 'assembly') || 'assembly'
}

export function normalizeLocalModelId(value, fallback = '') {
  let id = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
  if (id.endsWith(':latest')) id = id.slice(0, -':latest'.length)
  if (!id || id.length > 200) return String(fallback ?? '').trim()
  return id
}

export function formatLocalModelLabel(name) {
  const id = String(name ?? '').trim()
  if (id === 'assembly' || id === 'assembly:latest') return 'Qwen2.5-7B (assembly)'
  return id.replace(/^hf\.co\//, '')
}

/** @param {unknown} payload */
export function parseOllamaTagList(payload) {
  const rows = Array.isArray(payload?.models) ? payload.models : []
  const seen = new Set()
  const models = []
  for (const row of rows) {
    const id = normalizeLocalModelId(row?.name || row?.model)
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      label: formatLocalModelLabel(id),
      sizeBytes: Number(row?.size) || 0,
    })
  }
  models.sort((a, b) => {
    const rank = (id) => (id === 'assembly' || id.startsWith('assembly:') ? 0 : 1)
    const d = rank(a.id) - rank(b.id)
    if (d !== 0) return d
    return a.id.localeCompare(b.id)
  })
  return models
}

function authHeaders(extra = {}) {
  const headers = { ...extra }
  const secret = env('LOCAL_LLM_SECRET')
  if (secret) headers.Authorization = `Bearer ${secret}`
  return headers
}

export async function listLocalLlmModels() {
  const base = localLlmBaseUrl()
  if (!base) {
    return { ok: false, models: [], error: 'Не задан LOCAL_LLM_URL' }
  }
  try {
    const res = await fetchWithTimeout(
      `${base}/api/tags`,
      { method: 'GET', headers: authHeaders() },
      LIST_TIMEOUT_MS,
    )
    const raw = await res.text().catch(() => '')
    let payload = {}
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      payload = {}
    }
    if (!res.ok) {
      return {
        ok: false,
        models: [],
        error: `Локальная модель HTTP ${res.status}`,
      }
    }
    return { ok: true, models: parseOllamaTagList(payload), error: null }
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      models: [],
      error: timeout ? 'Локальная модель не ответила' : 'Локальная модель недоступна',
    }
  }
}

export async function generateTextWithLocal(prompt, options = {}) {
  const base = localLlmBaseUrl()
  if (!base) {
    return { ok: false, status: 503, error: 'Не задан LOCAL_LLM_URL' }
  }
  const model = normalizeLocalModelId(options.model, defaultLocalLlmModel()) || defaultLocalLlmModel()
  const temperature = Number.isFinite(options.temperature) ? options.temperature : 0
  const maxTokens = Math.max(64, Math.min(4096, Number(options.maxTokens ?? 512) || 512))
  const timeoutMs =
    options.timeoutMs ??
    (Number(env('LOCAL_LLM_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS))) || DEFAULT_TIMEOUT_MS)

  const body = {
    model,
    messages: [{ role: 'user', content: String(prompt ?? '') }],
    stream: false,
    think: false,
    keep_alive: -1,
    options: {
      temperature,
      num_predict: maxTokens,
      num_ctx: 8192,
      num_thread: 6,
    },
  }
  if (options.format === 'json') body.format = 'json'

  let res
  try {
    res = await fetchWithTimeout(
      `${base}/api/chat`,
      {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      },
      timeoutMs,
    )
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      status: timeout ? 504 : 502,
      error: timeout ? 'Локальная модель не ответила вовремя' : 'Локальная модель недоступна',
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  const raw = await res.text().catch(() => '')
  let payload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = { detail: raw.slice(0, 800) }
  }
  if (!res.ok) {
    const detail = String(payload?.error ?? payload?.detail ?? '').trim() || raw.slice(0, 800)
    return {
      ok: false,
      status: res.status >= 500 ? 502 : res.status,
      error: `Локальная модель HTTP ${res.status}`,
      detail,
    }
  }

  const text = String(payload?.message?.content ?? payload?.response ?? '').trim()
  if (!text) {
    return {
      ok: false,
      status: 502,
      error: 'Локальная модель не вернула текст',
      detail: raw.slice(0, 800),
    }
  }

  return { ok: true, text, model, provider: 'local' }
}
