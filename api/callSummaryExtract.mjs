import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemblyTextConfigured, generateAssemblyText } from './yandexGpt.mjs'
import { assemblyTextConfigError } from './platformIntegrations.mjs'
import { rewriteClientAsGuest } from './guestWording.mjs'

export { rewriteClientAsGuest }

const API_DIR = path.dirname(fileURLToPath(import.meta.url))
const SUMMARY_PROMPT = 'call-summary.md'
const REVIEW_PROMPT = 'call-operator-review.md'
const REVIEW_VERIFY_PROMPT = 'call-operator-review-verify.md'
const INSIGHTS_PROMPT = 'call-insights.md'

const INTENT_VALUES = new Set([
  'booking',
  'pricing',
  'treatment',
  'paid_medical',
  'transfer',
  'documents',
  'complaint',
  'returning',
  'queue',
  'other',
])

/** IVR / удержание без живого оператора — не коммерческий диалог. */
const QUEUE_CALL_RE =
  /все\s+менеджеры\s+на\s+линии|зафиксировали\s+ваш\s+звонок|вам\s+перезвонят[^.!]{0,40}освободит|ожидайте\s+на\s+линии|все\s+операторы\s+занят/i

const CONCRETE_FOLLOW_UP_RE =
  /перезвон|набер[уеё]|свяж(?:усь|емся|итесь)|пришл[ею]|вышл[ею]|отправл|напиш[уе](?:м|те)?\s+в\s+|whats?\s*app|ватсап|телеграм|выстав\w*\s+сч[её]т|подтверд\w*\s+(?:брон|заявк)|уточн\w*\s+и\s+(?:перезвон|связ|набер)/i

const MANAGER_ACTION_NEXT_STEP_RE =
  /пришл|вышл|отправ|перезвон|набер|связ|подтверд|выстав|соглас|заброниру|оформ|ожида|распечат|сч[её]т/i

/** Незакрытый интерес к брони/оплате в outcome — даже при шаблонном nextStep. */
const PENDING_BOOKING_INTEREST_RE =
  /согласил\w*.{0,40}заброн|запросил\w*\s+брон|интересуется\s+брон|оплат\w*.{0,24}(?:сч[её]т|завтра)|отправ\w*\s+сч[её]т|мест\s+нет|нет\s+мест/i

const COMPARING_DECLINE_RE =
  /друг(?:ом|ой|ого|ие|им)\s+санатор|уже\s+(?:в|у)\s+.{0,48}санатор|выбрал\w*\s+друг|сравнива\w*|в\s+другом\s+(?:месте|отеле)/i

const DOCUMENTS_INTENT_RE =
  /документ\w*.{0,48}реб[её]н|реб[её]н.{0,48}документ|согласован\w*.{0,40}документ|необходим\w*\s+документ|справк|аннуляц|флюорограф|курортн\w*\s+карт|калькулятор|подтверждени[ея]\s+в\s+письм/i

/** Трансфер/встреча: не только слово «трансфер», но и транспорт/вокзал/водитель. */
const CYR = '[а-яё]'
const TRANSFER_INTENT_RE = new RegExp(
  [
    'трансфер',
    'транспорт(?:ом|а|у)?(?![а-яё])',
    `встрет${CYR}{0,10}.{0,48}(?:вокзал|аэропорт|поезд|самол)`,
    `(?:вокзал|аэропорт|жд[\\s-]?вокзал).{0,48}(?:встрет|машин|транспорт)`,
    `дежурн${CYR}*\\s+водител`,
    `машин[ауиы].{0,40}(?:вокзал|аэропорт|встрет)`,
    `(?:вокзал|аэропорт).{0,40}машин`,
  ].join('|'),
  'i',
)
/** Платные медуслуги вне путёвки (не лечение в рамках проживания). */
const PAID_MEDICAL_INTENT_RE =
  /платн\w*\s+(?:мед(?:ицинск\w*)?\s+)?(?:услуг|процедур|при[её]м)|платн\w*\s+(?:консультац|при[её]м)|запис\w*.{0,40}(?:к\s+врач|на\s+процедур)|(?:мрт|кт|узи|анализ\w*|физиопроцедур)\w*.{0,40}платн|платн\w*.{0,40}(?:мрт|кт|узи|анализ\w*|физио)/i
const STRONG_BOOKING_SIGNAL_RE =
  /брон[а-яё]*|пут[её]вк|заезд|мест нет|нет мест|категор[а-яё]*\s+номер|улучшенн|комфортн/i
/** Отрицания вроде «бронь не обсуждалась» — не блокер для transfer/paid_medical. */
const NEGATED_BOOKING_MENTION_RE =
  /брон[а-яё]*\s+не\s+(?:был[а-яё]*\s+)?(?:обсуж|оформ|подтвер)|не\s+(?:был[а-яё]*\s+)?(?:обсуж|оформ|подтвер)[а-яё]*.{0,24}брон|без\s+(?:интереса\s+к\s+)?брон|не\s+стал[а-яё]*\s+брон/gi

export function hasStrongBookingInOutcome(outcome = '') {
  const cleaned = String(outcome ?? '').replace(NEGATED_BOOKING_MENTION_RE, ' ')
  return STRONG_BOOKING_SIGNAL_RE.test(cleaned)
}

export function isQueueHoldTranscript(transcript, outcome = '') {
  const text = `${transcript ?? ''}\n${outcome ?? ''}`
  return QUEUE_CALL_RE.test(text)
}

/**
 * Уже узкий отбор для эксперимента insights (не путать с shouldRunOperatorReviewPass):
 * реальный коммерческий интерес, без очереди/ошибки/водителя.
 */
export function isCallInsightsTargetCall({ outcome = '', nextStep = '', transcript = '' } = {}) {
  if (isQueueHoldTranscript(transcript, outcome)) return false
  const text = `${outcome}\n${nextStep}`
  if (
    /по ошибке|ошибочн(?:ый|ая)?\s+звонок|не тот номер|телефон водителя|записал(?:а|и)?\s+телефон|автоответчик|недозвон/i.test(
      text,
    )
  ) {
    return false
  }
  if (/не выразил(?:а|и)? интереса к брон|без интереса к брон|не интерес\w* к брон/i.test(text)) {
    return false
  }

  const positiveBooking =
    /брон\w+|пут[её]вк|заезд|мест нет|нет мест|категор\w*\s+номер|улучшенн|комфортн|двухместн|одноместн|(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\w*/i.test(
      text,
    ) && !/не выразил(?:а|и)? интереса к брон|без интереса к брон/i.test(text)
  const pricingAsk = /стоимост|сколько стоит|цен[аыу]\b|прайс|бюджет/i.test(text)
  const docsBlock =
    /документ|справк|аннуляц|согласие|флюорограф|курортн\w*\s+карт|калькулятор/i.test(text) &&
    /брон|заезд|номер|реб[её]н/i.test(text)
  const paidMedical = PAID_MEDICAL_INTENT_RE.test(text)

  return positiveBooking || pricingAsk || docsBlock || paidMedical
}
const DECLINE_VALUES = new Set([
  'price',
  'dates_full',
  'comparing',
  'family',
  'voucher',
  'think',
  'other',
])
const TOPIC_VALUES = new Set([
  'food',
  'procedures',
  'kids',
  'pets',
  'parking',
  'wifi',
  'location',
  'pool',
  'arrival',
  'cancellation',
  'payment',
  'other',
])
const SOURCE_VALUES = new Set(['referral', 'site', 'tour', 'other'])

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

export function loadOperatorReviewVerifyPrompt() {
  return loadPrompt(REVIEW_VERIFY_PROMPT)
}

export function loadCallInsightsPrompt() {
  return loadPrompt(INSIGHTS_PROMPT)
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

/** Китайские/японские/корейские иероглифы в тексте саммари — сбой языка модели. */
export function containsCjkScript(text) {
  return /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/.test(String(text ?? ''))
}

function summaryLooksWrongLanguage({ outcome = '', nextStep = '' } = {}) {
  return containsCjkScript(outcome) || containsCjkScript(nextStep)
}

/** Латиница внутри кириллического слова («альтernативных») — сбой модели. */
export function containsMixedScriptWord(text) {
  return /[а-яё][a-z]|[a-z][а-яё]/i.test(String(text ?? ''))
}

export function operatorReviewLooksBroken(review) {
  if (!review) return false
  const text = `${review.miss ?? ''}\n${review.detail ?? ''}`
  return containsCjkScript(text) || containsMixedScriptWord(text)
}

/** Нужен ли повторный проход: битый JSON, CJK в сыром ответе или в полях. */
export function callSummaryResponseNeedsRepair(parsed, rawText = '') {
  if (containsCjkScript(rawText)) return true
  if (!parsed?.ok) return true
  return summaryLooksWrongLanguage(parsed)
}

export function buildCallSummaryRepairPrompt(transcript) {
  return `${buildCallSummaryPrompt(transcript)}

## ИСПРАВЛЕНИЕ (обязательно)
Предыдущий ответ модели был непригоден: битый JSON и/или не русский язык.
Верни заново ТОЛЬКО один валидный JSON-объект вида:
{"outcome":"...","nextStep":"..."}
Требования:
- поля outcome и nextStep — только русский (кириллица);
- без китайских иероглифов, без английских фраз, без meta-текста («переведи», «продолжай», «JSON»);
- закрой все кавычки и скобки; никакого текста до или после JSON.`
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

/** Второй проход: перепроверка miss по полному транскрипту. */
export function buildOperatorReviewVerifyPrompt(
  transcript,
  { miss = '', detail = '', outcome = '', nextStep = '' } = {},
) {
  const template = loadOperatorReviewVerifyPrompt()
  for (const key of ['{{TRANSCRIPT}}', '{{OUTCOME}}', '{{NEXT_STEP}}', '{{MISS}}', '{{DETAIL}}']) {
    if (!template.includes(key)) {
      throw new Error(`В промпте проверки разбора нет плейсхолдера ${key}`)
    }
  }
  return template
    .replaceAll('{{TRANSCRIPT}}', String(transcript ?? ''))
    .replaceAll('{{OUTCOME}}', String(outcome ?? '').trim() || 'не указан')
    .replaceAll('{{NEXT_STEP}}', String(nextStep ?? '').trim() || 'не указан')
    .replaceAll('{{MISS}}', String(miss ?? '').trim() || 'не указан')
    .replaceAll('{{DETAIL}}', String(detail ?? '').trim() || 'не указан')
}

export function buildCallInsightsPrompt(transcript, { outcome = '', nextStep = '' } = {}) {
  const template = loadCallInsightsPrompt()
  for (const key of ['{{TRANSCRIPT}}', '{{OUTCOME}}', '{{NEXT_STEP}}']) {
    if (!template.includes(key)) {
      throw new Error(`В промпте insights нет плейсхолдера ${key}`)
    }
  }
  return template
    .replaceAll('{{TRANSCRIPT}}', String(transcript ?? ''))
    .replaceAll('{{OUTCOME}}', String(outcome ?? '').trim() || 'не указан')
    .replaceAll('{{NEXT_STEP}}', String(nextStep ?? '').trim() || 'не указан')
}

function extractJsonObject(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { ok: false, error: 'extract_empty_response' }

  let jsonText = ''
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim()
  } else {
    const start = raw.indexOf('{')
    if (start < 0) return { ok: false, error: 'extract_no_json' }
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
    if (end < 0) return { ok: false, error: 'extract_parse_failed' }
    jsonText = raw.slice(start, end + 1)
  }

  try {
    const parsed = JSON.parse(stripMarkdownFence(jsonText))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'extract_not_object' }
    }
    return { ok: true, parsed }
  } catch {
    return { ok: false, error: 'extract_invalid_json' }
  }
}

export function parseCallSummaryResponse(raw) {
  const extracted = extractJsonObject(raw)
  if (!extracted.ok) return extracted
  const parsed = extracted.parsed

  const outcome = rewriteClientAsGuest(
    String(parsed.outcome ?? parsed.итог ?? parsed.summary ?? '').trim(),
  )
  const nextStep = rewriteClientAsGuest(
    String(
      parsed.nextStep ?? parsed.next_step ?? parsed['следующий шаг'] ?? parsed.next ?? '',
    ).trim(),
  )
  if (!outcome && !nextStep) {
    return { ok: false, error: 'extract_empty_fields' }
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
  const miss = rewriteClientAsGuest(String(raw.miss ?? raw.ошибка ?? raw.gap ?? '').trim())
  const detail = rewriteClientAsGuest(String(raw.detail ?? raw.разбор ?? raw.note ?? '').trim())
  if (!miss && !detail) return null
  return {
    miss: miss || 'Недоработка при возможности закрыть сделку',
    detail: detail || miss,
  }
}

/** Если модель сама пишет, что альтернативы предложили и гость отказался — сбрасываем разбор. */
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
    ) ||
    /подтвердил\w*\s+(?:заезд|брон|приезд|прибыт)|подтверждени\w*\s+(?:заезд|брон|приезд|прибыт)|уже\s+(?:забронир|оформлен|куплен|оплачен)|(?:существующ|имеющ)\w*\s+брон|пут[её]вк\w*\s+(?:уже\s+)?(?:оформлен|куплен|оплачен)/i.test(
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

const EXISTING_BOOKING_RE = new RegExp(
  [
    `(?:к|в|по)\\s+вашей\\s+брон`,
    `ваша\\s+брон`,
    `пут[её]вк${CYR}*\\s+у\\s+вас\\s+со?(?!${CYR})`,
    `когда\\s+(?:мы\\s+)?(?:за)?бронировали`,
    `мы\\s+(?:уже\\s+)?(?:за)?бронировали`,
    `мы\\s+(?:уже\\s+)?купили\\s+пут[её]вк`,
    `у\\s+меня\\s+(?:уже\\s+)?(?:есть\\s+)?(?:брон|пут[её]вк)`,
    `вс[её]\\s+в\\s+силе`,
  ].join('|'),
  'i',
)

/** Звонок по уже оформленной брони/путёвке (подтверждение заезда, пожелания к номеру). */
export function transcriptShowsExistingBooking(transcript) {
  return EXISTING_BOOKING_RE.test(String(transcript ?? ''))
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
    return {
      outcome: rewriteClientAsGuest(String(outcome ?? '').trim()),
      nextStep: rewriteClientAsGuest(String(nextStep ?? '').trim()),
    }
  }

  const clean = (text) =>
    rewriteClientAsGuest(
      String(text ?? '')
        .replace(MONEY_CLAIM_RE, '')
        .replace(LOOSE_AMOUNT_SENTENCE_RE, '')
        .replace(PRICE_MENTION_RE, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.,;:])/g, '$1')
        .replace(/^[.\s,;:]+|[.\s,;:]+$/g, '')
        .trim(),
    )

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

async function runOperatorReviewPrompt(prompt, options = {}) {
  if (!(await assemblyTextConfigured())) {
    return {
      ok: false,
      status: 503,
      error: (await assemblyTextConfigError()) || 'Саммари не настроено',
    }
  }

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

export async function extractOperatorReviewFromTranscript(
  transcript,
  { outcome = '', nextStep = '', ...options } = {},
) {
  const text = String(transcript ?? '').trim()
  if (!text) {
    return { ok: false, status: 400, error: 'Пустой транскрипт' }
  }
  return runOperatorReviewPrompt(buildOperatorReviewPrompt(text, { outcome, nextStep }), options)
}

/** Если первый разбор не null — сверка кандидата с полным транскриптом. */
export async function verifyOperatorReviewAgainstTranscript(
  transcript,
  { miss = '', detail = '', outcome = '', nextStep = '', ...options } = {},
) {
  const text = String(transcript ?? '').trim()
  if (!text) {
    return { ok: false, status: 400, error: 'Пустой транскрипт' }
  }
  return runOperatorReviewPrompt(
    buildOperatorReviewVerifyPrompt(text, { miss, detail, outcome, nextStep }),
    options,
  )
}

const SUMMARY_REPAIR_ATTEMPTS = 2

/**
 * Проходы: 1) outcome/nextStep (+ repair при битом JSON/CJK),
 * 2) operatorReview только при коммерческом срыве,
 * 3) если разбор не null — verify по полному транскрипту.
 */
export async function extractCallSummaryFromTranscript(
  transcript,
  { skipOperatorReview = false, ...options } = {},
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

  const runOnce = async (prompt, genOpts = {}) => {
    const generated = await generateAssemblyText(prompt, {
      temperature: 0,
      maxTokens: 500,
      format: 'json',
      ...options,
      ...genOpts,
    })
    if (!generated.ok) return { generated, parsed: null }
    const parsed = parseCallSummaryResponse(generated.text)
    return { generated, parsed }
  }

  let { generated, parsed } = await runOnce(buildCallSummaryPrompt(text))
  if (!generated.ok) return generated

  let repairs = 0
  while (callSummaryResponseNeedsRepair(parsed, generated.text) && repairs < SUMMARY_REPAIR_ATTEMPTS) {
    repairs += 1
    const retry = await runOnce(buildCallSummaryRepairPrompt(text), {
      // чуть выше 0 — выйти из детерминированного «китайского» ответа
      temperature: Math.min(0.6, 0.25 + repairs * 0.15),
      maxTokens: 600,
    })
    if (!retry.generated.ok) {
      // сеть/LLM на repair — отдаём эту ошибку, если нормального JSON ещё нет
      if (!parsed?.ok) return retry.generated
      break
    }
    generated = retry.generated
    parsed = retry.parsed
  }

  if (!parsed?.ok) {
    return {
      ok: false,
      status: 502,
      error: parsed?.error || 'extract_parse_failed',
      detail: generated.text.slice(0, 1200),
      model: generated.model,
      repairs,
    }
  }

  const safe = sanitizeCallSummaryFacts(text, parsed)
  if (summaryLooksWrongLanguage(safe)) {
    return {
      ok: false,
      status: 502,
      error: 'extract_wrong_language',
      detail: generated.text.slice(0, 1200),
      model: generated.model,
      repairs,
    }
  }

  let operatorReview = null
  let reviewModel = null
  let reviewRaw = null
  let reviewVerifyRaw = null
  let reviewPass = 'skipped'

  if (skipOperatorReview) {
    reviewPass = 'skipped_stage'
  } else if (transcriptShowsExistingBooking(text)) {
    reviewPass = 'skipped_existing_booking'
  } else if (shouldRunOperatorReviewPass(safe)) {
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

      // Ложные miss (даты/варианты были в разговоре) — второй проход по транскрипту.
      if (operatorReview) {
        const verified = await verifyOperatorReviewAgainstTranscript(text, {
          miss: operatorReview.miss,
          detail: operatorReview.detail,
          outcome: safe.outcome,
          nextStep: safe.nextStep,
          ...options,
        })
        if (verified.ok) {
          reviewVerifyRaw = verified.rawModelText || null
          if (verified.model) reviewModel = verified.model
          operatorReview = reconcileOperatorReview(verified.operatorReview, safe)
          reviewPass = operatorReview ? 'verified' : 'cleared'
        } else {
          reviewPass = 'verify_failed'
          reviewVerifyRaw = verified.detail || verified.error || null
        }
      }
    } else {
      // саммари уже есть — разбор не валим весь пайплайн
      reviewPass = 'failed'
      reviewRaw = review.detail || review.error || null
    }
  }

  if (operatorReviewLooksBroken(operatorReview)) {
    operatorReview = null
    reviewPass = 'dropped_wrong_language'
  }

  return {
    ok: true,
    outcome: safe.outcome,
    nextStep: safe.nextStep,
    operatorReview,
    model: generated.model,
    reviewModel,
    reviewPass,
    repairs,
    rawModelText: generated.text,
    rawReviewText: reviewRaw,
    rawReviewVerifyText: reviewVerifyRaw,
  }
}

function normalizeEnum(raw, allowed) {
  if (raw == null || raw === false || raw === '') return null
  const value = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!value || value === 'null' || value === 'none' || value === 'нет') return null
  return allowed.has(value) ? value : null
}

function normalizeGuests(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw)
  const match = String(raw).match(/\d{1,3}/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeBudgetMax(raw, transcript) {
  if (raw == null || raw === '') return null
  const hasPriceContext = PRICE_CONTEXT_RE.test(String(transcript ?? ''))
  if (!hasPriceContext) return null
  const digits = String(raw).replace(/[^\d]/g, '')
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeTopicLabel(raw) {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  return text.slice(0, 48)
}

function normalizeTopics(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const topic = normalizeEnum(item.topic ?? item.name ?? item.тема, TOPIC_VALUES)
    if (!topic) continue
    const label = normalizeTopicLabel(item.label ?? item.title ?? item.название ?? item.тема_текст)
    // «other» без подписи бесполезен — пропускаем; с разными label можно несколько.
    if (topic === 'other' && !label) continue
    const key = topic === 'other' ? `other:${label.toLowerCase()}` : topic
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      topic,
      addressed: Boolean(item.addressed ?? item.answered ?? item.закрыто ?? false),
      ...(label ? { label } : {}),
    })
  }
  return out
}

function normalizeFacts(raw, transcript) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const checkIn = String(src.checkIn ?? src.check_in ?? src.заезд ?? '').trim() || null
  const checkOut = String(src.checkOut ?? src.check_out ?? src.выезд ?? '').trim() || null
  const roomCategory =
    String(src.roomCategory ?? src.room_category ?? src.номер ?? '').trim() || null
  const treatment = String(src.treatment ?? src.лечение ?? '').trim() || null
  return {
    checkIn,
    checkOut,
    guests: normalizeGuests(src.guests ?? src.гостей ?? src.guestCount),
    roomCategory,
    treatment,
    budgetMax: normalizeBudgetMax(src.budgetMax ?? src.budget_max ?? src.бюджет, transcript),
    source: normalizeEnum(src.source ?? src.канал ?? src.channel, SOURCE_VALUES),
  }
}

function hasConcreteFollowUpCue(text) {
  return CONCRETE_FOLLOW_UP_RE.test(String(text ?? ''))
}

function isVagueNextStep(nextStep) {
  const step = String(nextStep ?? '').trim().toLowerCase()
  if (!step) return true
  return /уточнить интерес|при следующем контакте|дальнейших действий не требуется|не требуется/.test(
    step,
  )
}

/**
 * Follow-up: конкретная договорённость о контакте / действии менеджера.
 * Общий «уточнить интерес…» сам по себе → false, но:
 * - think / dates_full / обещание перезвона в тексте → true;
 * - nextStep с явным действием менеджера (не шаблон) → true;
 * - booking/pricing/documents + незакрытый интерес в outcome → true.
 */
export function deriveNeedsFollowUp(
  nextStep,
  explicit,
  { outcome = '', transcript = '', declineReason = null, intent = null } = {},
) {
  if (hasConcreteFollowUpCue(nextStep)) return true
  if (hasConcreteFollowUpCue(outcome)) return true

  const step = String(nextStep ?? '')
  if (/дальнейших действий не требуется/i.test(step)) return false

  if (declineReason === 'think' || declineReason === 'dates_full') return true
  if (declineReason === 'comparing') return false

  // Транскрипт не сканируем: IVR («вам перезвонят») даёт ложные срабатывания.
  if (!isVagueNextStep(nextStep) && MANAGER_ACTION_NEXT_STEP_RE.test(nextStep)) return true

  const commercial =
    intent === 'booking' || intent === 'pricing' || intent === 'documents'
  if (commercial && PENDING_BOOKING_INTEREST_RE.test(String(outcome ?? ''))) return true

  if (explicit === true && commercial) {
    if (/уточн|перезвон|связ|пришл|набер|жду|ожида/i.test(`${outcome}\n${nextStep}`)) {
      return true
    }
  }

  if (explicit === false) return false
  return false
}

function reconcileDeclineReason(decline, { outcome = '', transcript = '' } = {}) {
  const blob = `${outcome}\n${String(transcript ?? '').slice(0, 2500)}`
  if (COMPARING_DECLINE_RE.test(blob)) return 'comparing'
  return decline
}

/** Поправки intent, когда модель путает pricing с документами/трансфером. */
export function reconcileCallInsightsIntent(
  intent,
  { outcome = '', nextStep = '', transcript = '' } = {},
) {
  const blob = `${outcome}\n${nextStep}\n${String(transcript ?? '').slice(0, 2500)}`
  if (isQueueHoldTranscript(transcript, outcome)) return 'queue'
  if (DOCUMENTS_INTENT_RE.test(blob)) return 'documents'
  if (PAID_MEDICAL_INTENT_RE.test(blob) && !hasStrongBookingInOutcome(outcome)) {
    return 'paid_medical'
  }
  if (TRANSFER_INTENT_RE.test(blob) && !hasStrongBookingInOutcome(outcome)) {
    return 'transfer'
  }
  // Модель иногда ставит queue на короткий отказ «уже в другом санатории».
  if (intent === 'queue' && !isQueueHoldTranscript(transcript, outcome) && COMPARING_DECLINE_RE.test(blob)) {
    return 'booking'
  }
  return intent
}

const EMPTY_FACTS = {
  checkIn: null,
  checkOut: null,
  guests: null,
  roomCategory: null,
  treatment: null,
  budgetMax: null,
  source: null,
}

/** Нормализация insights JSON от модели. */
export function normalizeCallInsights(raw, { transcript = '', outcome = '', nextStep = '' } = {}) {
  if (isQueueHoldTranscript(transcript, outcome)) {
    return {
      intent: 'queue',
      declineReason: null,
      topics: [],
      facts: { ...EMPTY_FACTS },
      needsFollowUp: false,
    }
  }

  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const declineReason = reconcileDeclineReason(
    normalizeEnum(
      src.declineReason ?? src.decline_reason ?? src.отказ ?? src.reason,
      DECLINE_VALUES,
    ),
    { outcome, transcript },
  )
  const intent = reconcileCallInsightsIntent(
    normalizeEnum(src.intent ?? src.тип ?? src.type, INTENT_VALUES),
    { outcome, nextStep, transcript },
  )
  return {
    intent,
    declineReason,
    topics: normalizeTopics(src.topics ?? src.темы ?? src.objections),
    facts: normalizeFacts(src.facts ?? src.факты ?? {}, transcript),
    needsFollowUp: deriveNeedsFollowUp(nextStep, src.needsFollowUp ?? src.needs_follow_up, {
      outcome,
      transcript,
      declineReason,
      intent,
    }),
  }
}

export function parseCallInsightsResponse(
  raw,
  { transcript = '', outcome = '', nextStep = '' } = {},
) {
  const extracted = extractJsonObject(raw)
  if (!extracted.ok) return extracted
  return {
    ok: true,
    insights: normalizeCallInsights(extracted.parsed, { transcript, outcome, nextStep }),
  }
}

/**
 * Третий проход: таксономия и факты для аналитики (без записи в amo).
 */
export async function extractCallInsightsFromTranscript(
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

  // Дешёвый путь: IVR/очередь без живого диалога — без вызова модели.
  if (isQueueHoldTranscript(text, outcome)) {
    return {
      ok: true,
      insights: normalizeCallInsights({}, { transcript: text, outcome, nextStep }),
      model: null,
      rawModelText: null,
      skippedLlm: true,
    }
  }

  const parseInsights = (raw) =>
    parseCallInsightsResponse(raw, { transcript: text, outcome, nextStep })

  let generated = await generateAssemblyText(buildCallInsightsPrompt(text, { outcome, nextStep }), {
    temperature: 0,
    maxTokens: 700,
    format: 'json',
    ...options,
  })
  if (!generated.ok) return generated

  let parsed = parseInsights(generated.text)
  if (!parsed.ok || containsCjkScript(generated.text)) {
    const retry = await generateAssemblyText(
      `${buildCallInsightsPrompt(text, { outcome, nextStep })}

## ИСПРАВЛЕНИЕ
Предыдущий ответ был битым JSON или не на русском. Верни только валидный JSON, поля текста — кириллица, без китайского.`,
      {
        temperature: 0.35,
        maxTokens: 700,
        format: 'json',
        ...options,
      },
    )
    if (retry.ok) {
      const retryParsed = parseInsights(retry.text)
      if (retryParsed.ok && !containsCjkScript(retry.text)) {
        generated = retry
        parsed = retryParsed
      }
    }
  }

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
    insights: parsed.insights,
    model: generated.model,
    rawModelText: generated.text,
  }
}

