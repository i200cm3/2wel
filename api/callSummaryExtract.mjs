import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemblyTextConfigured, generateAssemblyText } from './yandexGpt.mjs'
import { assemblyTextConfigError } from './platformIntegrations.mjs'

const API_DIR = path.dirname(fileURLToPath(import.meta.url))
const SUMMARY_PROMPT = 'call-summary.md'
const REVIEW_PROMPT = 'call-operator-review.md'

function resolvePromptPath(name) {
  const candidates = [
    path.join(API_DIR, 'prompts', name),
    path.join(API_DIR, '..', 'prompts', name),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

function loadPrompt(name) {
  const promptPath = resolvePromptPath(name)
  try {
    return fs.readFileSync(promptPath, 'utf8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Не найден промпт ${name} (${promptPath}): ${message}`)
  }
}

export function loadCallSummaryPrompt() {
  return loadPrompt(SUMMARY_PROMPT)
}

export function loadOperatorReviewPrompt() {
  return loadPrompt(REVIEW_PROMPT)
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

export function buildOperatorReviewPrompt(transcript, { outcome = '', nextStep = '' } = {}) {
  const template = loadOperatorReviewPrompt()
  for (const key of ['{{TRANSCRIPT}}', '{{OUTCOME}}', '{{NEXT_STEP}}']) {
    if (!template.includes(key)) {
      throw new Error(`В промпте разбора нет плейсхолдера ${key}`)
    }
  }
  return template
    .replaceAll('{{TRANSCRIPT}}', String(transcript ?? ''))
    .replaceAll('{{OUTCOME}}', String(outcome ?? '').trim() || 'не указан')
    .replaceAll('{{NEXT_STEP}}', String(nextStep ?? '').trim() || 'не указан')
}

function extractJsonObject(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { ok: false, error: 'Пустой ответ модели' }

  let jsonText = ''
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim()
  } else {
    const start = raw.indexOf('{')
    if (start < 0) return { ok: false, error: 'В ответе нет JSON-объекта' }
    let depth = 0
    let end = -1
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i]
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
    jsonText = raw.slice(start, end + 1)
  }

  try {
    const parsed = JSON.parse(stripMarkdownFence(jsonText))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Ожидался JSON-объект' }
    }
    return { ok: true, parsed }
  } catch {
    return { ok: false, error: 'Модель вернула невалидный JSON' }
  }
}

export function parseCallSummaryResponse(raw) {
  const extracted = extractJsonObject(raw)
  if (!extracted.ok) return extracted
  const parsed = extracted.parsed

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
    // pass1 больше не отдаёт разбор; оставляем на случай старого ответа модели
    operatorReview: normalizeOperatorReview(
      parsed.operatorReview ?? parsed.operator_review ?? parsed['разбор оператора'],
    ),
  }
}

export function parseOperatorReviewResponse(raw) {
  const extracted = extractJsonObject(raw)
  if (!extracted.ok) return extracted
  const parsed = extracted.parsed
  return {
    ok: true,
    operatorReview: normalizeOperatorReview(
      parsed.operatorReview ?? parsed.operator_review ?? parsed['разбор оператора'] ?? parsed,
    ),
  }
}

/** null или { miss, detail } — только при упущенном закрытии. */
export function normalizeOperatorReview(raw) {
  if (raw == null || raw === false || raw === '') return null
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase()
    if (!t || t === 'null' || t === 'none' || t === 'нет') return null
    return { miss: raw.trim().slice(0, 200), detail: '' }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  // если пришёл весь объект ответа без вложенного operatorReview — не путать с {miss,detail}
  if ('outcome' in raw || 'nextStep' in raw) {
    return normalizeOperatorReview(raw.operatorReview ?? raw.operator_review)
  }
  const miss = String(raw.miss ?? raw.ошибка ?? raw.gap ?? '').trim()
  const detail = String(raw.detail ?? raw.разбор ?? raw.note ?? '').trim()
  if (!miss && !detail) return null
  return {
    miss: miss || 'Недоработка при возможности закрыть сделку',
    detail: detail || miss,
  }
}

/** Если модель сама пишет, что альтернативы предложили и клиент отказался — сбрасываем разбор. */
export function reconcileOperatorReview(review, { outcome = '', nextStep = '' } = {}) {
  if (!review) return null
  // «не предложил» не считать положительным предложением
  const rawBlob = `${outcome}\n${nextStep}\n${review.miss}\n${review.detail}`
  const blob = rawBlob.replace(/не\s+предлож\w*/gi, 'NO_OFFER')
  const offeredAndRefused =
    /предлож\w*.{0,100}(отказ|не подош|рано|поздно|не устро|не интерес)/i.test(blob) ||
    /(отказ|не подош|рано|поздно).{0,100}предлож/i.test(blob)
  if (offeredAndRefused) return null

  // Конкретная дата (число + месяц) уже названа как доступная/предложенная → разбор не нужен.
  // «только ноябрь» без числа сюда не попадает.
  const concreteAvailable =
    /(?:есть|предложен\w*|доступен\w*|номер\w*|вариант\w*).{0,48}\d{1,2}\s*(?:январ\w*|феврал\w*|март\w*|апрел\w*|ма[йя]|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)|\d{1,2}\s*(?:январ\w*|феврал\w*|март\w*|апрел\w*|ма[йя]|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*).{0,48}(?:есть|предложен\w*|доступен\w*|номер\w*|вариант\w*)/i
  if (concreteAvailable.test(rawBlob)) return null

  return review
}

/**
 * Дешёвый фильтр: второй проход только если саммари похоже на коммерческий срыв.
 * Время не критично — лучше лишний вызов, чем пропуск; но документы/массаж отсекаем.
 */
export function shouldRunOperatorReviewPass({ outcome = '', nextStep = '' } = {}) {
  const text = `${outcome}\n${nextStep}`.toLowerCase()
  if (!text.trim()) return false

  const bookingCue =
    /брон|номер|пут[её]вк|заезд|дат[аыеу]|мест\b|пакет|категор/i
  const closed =
    /оформлен[аоы]? бронь|бронь оформлен|забронировал|зафиксировал бронь|выставил сч[её]т|предоплат|оплатил|запись оформлен/i.test(
      text,
    )
  if (closed) return false

  const nonCommercial =
    /документ|калькулятор|флюорограф|массаж|автоответчик|недозвон|как доехать|адрес|режим работ|курортн\w* карт/i.test(
      text,
    ) && !bookingCue.test(text)
  if (nonCommercial) return false

  return bookingCue.test(text)
}

const PRICE_CONTEXT_RE =
  /(?:руб(?:л|\.)?|₽|стоимость|стоит|цена|прайс|тысяч(?:и|а)?\s*руб)/i
const MONEY_CLAIM_RE =
  /(?:стоимост\w*\s+(?:услуги\s+)?составит\s+)?\d[\d\s]{2,}\s*(?:руб(?:л(?:ей|я|\.)?)?|₽)|(?:за\s+)?\d[\d\s]{2,}\s*(?:руб(?:л(?:ей|я|\.)?)?|₽)/gi
const LOOSE_AMOUNT_SENTENCE_RE =
  /[^.!?]*?(?:стоимост\w*|цена|стоит)[^.!?]*?\d[\d\s]{2,}[^.!?]*[.!?]?/gi
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

export async function extractOperatorReviewFromTranscript(
  transcript,
  { outcome = '', nextStep = '', ...options } = {},
) {
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

  const prompt = buildOperatorReviewPrompt(text, { outcome, nextStep })
  const generated = await generateAssemblyText(prompt, {
    temperature: 0,
    maxTokens: 400,
    format: 'json',
    ...options,
  })
  if (!generated.ok) return generated

  const parsed = parseOperatorReviewResponse(generated.text)
  if (!parsed.ok) {
    return {
      ok: false,
      status: 502,
      error: parsed.error,
      detail: generated.text.slice(0, 1200),
      model: generated.model,
    }
  }

  return {
    ok: true,
    operatorReview: parsed.operatorReview,
    model: generated.model,
    rawModelText: generated.text,
  }
}

/**
 * Два прохода: 1) outcome/nextStep, 2) operatorReview только при коммерческом срыве.
 */
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
  let operatorReview = null
  let reviewModel = null
  let reviewRaw = null
  let reviewPass = 'skipped'

  if (shouldRunOperatorReviewPass(safe)) {
    reviewPass = 'ran'
    const review = await extractOperatorReviewFromTranscript(text, {
      outcome: safe.outcome,
      nextStep: safe.nextStep,
      ...options,
    })
    if (review.ok) {
      operatorReview = reconcileOperatorReview(review.operatorReview, safe)
      reviewModel = review.model || null
      reviewRaw = review.rawModelText || null
    } else {
      // саммари уже есть — разбор не валим весь пайплайн
      reviewPass = 'failed'
      reviewRaw = review.detail || review.error || null
    }
  }

  return {
    ok: true,
    outcome: safe.outcome,
    nextStep: safe.nextStep,
    operatorReview,
    model: generated.model,
    reviewModel,
    reviewPass,
    rawModelText: generated.text,
    rawReviewText: reviewRaw,
  }
}
