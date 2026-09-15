import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemblyTextConfigured, generateAssemblyText } from './yandexGpt.mjs'
import { assemblyTextConfigError } from './platformIntegrations.mjs'

const API_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROMPT_NAME = 'call-summary.md'

function resolveCallSummaryPromptPath() {
  const candidates = [
    path.join(API_DIR, 'prompts', PROMPT_NAME),
    path.join(API_DIR, '..', 'prompts', PROMPT_NAME),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

export function loadCallSummaryPrompt() {
  const promptPath = resolveCallSummaryPromptPath()
  try {
    return fs.readFileSync(promptPath, 'utf8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Не найден промпт ${PROMPT_NAME} (${promptPath}): ${message}`)
  }
}

function stripMarkdownFence(text) {
  const trimmed = String(text ?? '').trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```/i)
  return match ? match[1].trim() : trimmed
}

export function buildCallSummaryPrompt(transcript) {
  const template = loadCallSummaryPrompt()
  if (!template.includes('{{TRANSCRIPT}}')) {
    throw new Error('В промпте нет плейсхолдера {{TRANSCRIPT}}')
  }
  return template.replaceAll('{{TRANSCRIPT}}', String(transcript ?? ''))
}

export function parseCallSummaryResponse(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: 'Пустой ответ модели' }

  let jsonText = ''
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim()
  } else {
    const start = text.indexOf('{')
    if (start < 0) return { ok: false, error: 'В ответе нет JSON-объекта' }
    let depth = 0
    let end = -1
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) return { ok: false, error: 'Не удалось разобрать JSON в ответе' }
    jsonText = text.slice(start, end + 1)
  }

  let parsed
  try {
    parsed = JSON.parse(stripMarkdownFence(jsonText))
  } catch {
    return { ok: false, error: 'Модель вернула невалидный JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Ожидался JSON-объект' }
  }

  const outcome = String(parsed.outcome ?? parsed.итог ?? parsed.summary ?? '').trim()
  const nextStep = String(
    parsed.nextStep ?? parsed.next_step ?? parsed['следующий шаг'] ?? parsed.next ?? '',
  ).trim()
  if (!outcome && !nextStep) {
    return { ok: false, error: 'Пустые outcome/nextStep' }
  }

  return {
    ok: true,
    outcome: outcome || 'Итог неясен',
    nextStep: nextStep || 'Уточнить интерес при следующем контакте',
  }
}

const PRICE_CONTEXT_RE =
  /(?:руб(?:л|\.)?|₽|стоимость|стоит|цена|прайс|тысяч(?:и|а)?\s*руб)/i
const MONEY_CLAIM_RE =
  /(?:стоимост\w*\s+(?:услуги\s+)?составит\s+)?\d[\d\s]{2,}\s*(?:руб(?:л(?:ей|я|\.)?)?|₽)|(?:за\s+)?\d[\d\s]{2,}\s*(?:руб(?:л(?:ей|я|\.)?)?|₽)/gi
const LOOSE_AMOUNT_SENTENCE_RE =
  /[^.!?]*?(?:стоимост\w*|цена|стоит)[^.!?]*?\d[\d\s]{2,}[^.!?]*[.!?]?/gi
// \b плохо работает с кириллицей в JS — без word boundary.
const PRICE_MENTION_RE =
  /[^.!?]*?(?:была\s+упомянута\s+)?(?:цена|стоимост\w*|прайс)[^.!?]*[.!?]?/gi

/** Убрать выдуманные цены, если в транскрипте нет явного ценового контекста. */
export function sanitizeCallSummaryFacts(transcript, { outcome = '', nextStep = '' } = {}) {
  const raw = String(transcript ?? '')
  const hasPriceContext = PRICE_CONTEXT_RE.test(raw)
  if (hasPriceContext) {
    return { outcome: String(outcome ?? '').trim(), nextStep: String(nextStep ?? '').trim() }
  }

  const clean = (text) =>
    String(text ?? '')
      .replace(MONEY_CLAIM_RE, '')
      .replace(LOOSE_AMOUNT_SENTENCE_RE, '')
      .replace(PRICE_MENTION_RE, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .replace(/^[.\s,;:]+|[.\s,;:]+$/g, '')
      .trim()

  let nextOutcome = clean(outcome)
  let nextNext = clean(nextStep)

  if (!nextOutcome || /^[.\s]*$/.test(nextOutcome)) {
    nextOutcome = 'Короткий разговор без ясных договорённостей по брони или услугам.'
  }
  if (!nextNext) {
    nextNext = 'Уточнить интерес при следующем контакте'
  }

  return { outcome: nextOutcome, nextStep: nextNext }
}

export async function extractCallSummaryFromTranscript(transcript, options = {}) {
  if (!(await assemblyTextConfigured())) {
    return {
      ok: false,
      status: 503,
      error: (await assemblyTextConfigError()) || 'Саммари не настроено',
    }
  }
  const text = String(transcript ?? '').trim()
  if (!text) {
    return { ok: false, status: 400, error: 'Пустой транскрипт' }
  }

  const prompt = buildCallSummaryPrompt(text)
  const generated = await generateAssemblyText(prompt, {
    temperature: 0,
    maxTokens: 500,
    format: 'json',
    ...options,
  })
  if (!generated.ok) return generated

  const parsed = parseCallSummaryResponse(generated.text)
  if (!parsed.ok) {
    return {
      ok: false,
      status: 502,
      error: parsed.error,
      detail: generated.text.slice(0, 1200),
      model: generated.model,
    }
  }

  const safe = sanitizeCallSummaryFacts(text, parsed)

  return {
    ok: true,
    outcome: safe.outcome,
    nextStep: safe.nextStep,
    model: generated.model,
    rawModelText: generated.text,
  }
}
