import { loadEnv } from './env.js'
import { fetchWithTimeout } from './fetchTimeout.mjs'
import {
  isAssemblyTextConfigured,
  resolveAssemblyProvider,
  resolveYandexApiKey,
  resolveYandexFolderId,
} from './platformIntegrations.mjs'

const DEFAULT_TIMEOUT_MS = 120_000

function env(key, fallback = '') {
  loadEnv()
  return String(process.env[key] ?? fallback).trim()
}

/**
 * Синхронный completion YandexGPT.
 * Нужны API-ключ сервисного аккаунта и folder id каталога.
 */
export async function generateTextWithYandex(prompt, options = {}) {
  const apiKey = options.apiKey || (await resolveYandexApiKey())
  if (!apiKey) {
    return { ok: false, status: 503, error: 'YANDEX_SPEECHKIT_API_KEY не задан' }
  }
  const folderId = options.folderId || (await resolveYandexFolderId())
  if (!folderId) {
    return {
      ok: false,
      status: 503,
      error: 'Не задан folder id Яндекса (YANDEX_FOLDER_ID или админка API)',
    }
  }

  const modelName =
    String(options.model ?? env('YANDEX_GPT_MODEL', 'yandexgpt-lite')).trim() || 'yandexgpt-lite'
  const modelUri = modelName.startsWith('gpt://')
    ? modelName
    : `gpt://${folderId}/${modelName.replace(/^\/+|\/+$/g, '')}/latest`
  const temperature = Number.isFinite(options.temperature) ? options.temperature : 0.1
  const maxTokens = Math.max(
    256,
    Math.min(8000, Number(options.maxTokens ?? env('YANDEX_GPT_MAX_TOKENS', '4000')) || 4000),
  )
  const timeoutMs =
    options.timeoutMs ?? Number(env('YANDEX_GPT_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS)))

  let res
  try {
    res = await fetchWithTimeout(
      'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
      {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          modelUri,
          completionOptions: {
            stream: false,
            temperature,
            maxTokens: String(maxTokens),
          },
          messages: [{ role: 'user', text: String(prompt ?? '') }],
        }),
      },
      timeoutMs,
    )
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      status: timeout ? 504 : 502,
      error: timeout ? 'YandexGPT не ответил вовремя' : 'YandexGPT недоступен',
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
    const detail =
      String(
        payload?.message ??
          payload?.error?.message ??
          payload?.error_message ??
          payload?.detail ??
          '',
      ).trim() || raw.slice(0, 800)
    return {
      ok: false,
      status: res.status >= 500 ? 502 : res.status,
      error: `YandexGPT HTTP ${res.status}`,
      detail,
      retryable: res.status === 429 || res.status === 503,
    }
  }

  const text = String(payload?.result?.alternatives?.[0]?.message?.text ?? '').trim()
  if (!text) {
    return {
      ok: false,
      status: 502,
      error: 'YandexGPT не вернул текст',
      detail: raw.slice(0, 800),
    }
  }

  return { ok: true, text, model: modelUri, provider: 'yandex' }
}

/** Текст для сводки/сборки: по выбранному провайдеру в админке. */
export async function generateAssemblyText(prompt, options = {}) {
  const provider = options.provider || (await resolveAssemblyProvider())
  if (provider === 'local') {
    const { generateTextWithLocal } = await import('./localLlm.mjs')
    const { resolveExtractModel } = await import('./platformIntegrations.mjs')
    const model = options.model || (await resolveExtractModel())
    return generateTextWithLocal(prompt, { ...options, model })
  }
  if (provider === 'yandex') return generateTextWithYandex(prompt, options)

  const { generateTextWithGemini } = await import('./geminiTranscribe.mjs')
  const generated = await generateTextWithGemini(prompt, options)
  if (generated?.ok) return { ...generated, provider: 'gemini' }
  return generated
}

export async function assemblyTextConfigured() {
  return isAssemblyTextConfigured()
}
