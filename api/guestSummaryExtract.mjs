import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeGuestSummary } from './assembly.mjs'
import { generateTextWithGemini, geminiTextConfigured } from './geminiTranscribe.mjs'

const API_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROMPT_NAME = 'guest-summary-extract.md'

const KIND_LABELS = {
  chat: 'Чат',
  call_transcript: 'Звонок',
  note: 'Заметка',
  manual: 'Вручную',
  amo_export: 'Amo export',
}

function isRecordingUrl(text) {
  return /^https?:\/\//i.test(String(text ?? '').trim())
}

function resolveGuestSummaryExtractPromptPath() {
  const candidates = [
    // Docker: /app/prompts (скопировано из корня репо)
    path.join(API_DIR, 'prompts', PROMPT_NAME),
    // Локально: ../prompts рядом с api/
    path.join(API_DIR, '..', 'prompts', PROMPT_NAME),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

export function loadGuestSummaryExtractPrompt() {
  const promptPath = resolveGuestSummaryExtractPromptPath()
  try {
    return fs.readFileSync(promptPath, 'utf8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Не найден промпт ${PROMPT_NAME} (${promptPath}): ${message}`)
  }
}

/** Текстовые записи диалогов: транскрипты, чаты, заметки — без URL записей и нецелевых. */
export function collectDialogBodies(rawSources = []) {
  const items = []
  for (const source of Array.isArray(rawSources) ? rawSources : []) {
    if (source?.meta?.nonTarget === true) continue
    const body = String(source?.body ?? '').trim()
    if (!body || isRecordingUrl(body)) continue
    items.push({
      id: source.id ?? null,
      kind: String(source.kind ?? 'manual'),
      title: String(source.title ?? '').trim(),
      body,
      capturedAt: source.capturedAt ?? source.captured_at ?? null,
    })
  }
  return items
}

export function buildRawTextFromSources(rawSources = []) {
  const items = collectDialogBodies(rawSources)
  if (!items.length) return { ok: false, error: 'Нет текстовых транскрипций/диалогов для извлечения', items: [] }

  const chunks = items.map((item, index) => {
    const kindLabel = KIND_LABELS[item.kind] ?? item.kind
    const title = item.title || kindLabel
    const when = item.capturedAt ? ` · ${item.capturedAt}` : ''
    return `### ${index + 1}. ${kindLabel}: ${title}${when}\n${item.body}`
  })

  return { ok: true, rawText: chunks.join('\n\n'), items }
}

function stripMarkdownFence(text) {
  const trimmed = String(text ?? '').trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```/i)
  return match ? match[1].trim() : trimmed
}

function csvFromUnknown(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .join(', ')
  }
  if (value == null) return ''
  return String(value).trim()
}

export function parseGuestSummaryExtractResponse(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: 'Пустой ответ модели' }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  let jsonText = ''
  let explanation = ''

  if (fenceMatch) {
    jsonText = fenceMatch[1].trim()
    explanation = `${text.slice(0, fenceMatch.index).trim()}\n${text.slice(fenceMatch.index + fenceMatch[0].length).trim()}`.trim()
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
    explanation = `${text.slice(0, start).trim()}\n${text.slice(end + 1).trim()}`.trim()
  }

  let parsed
  try {
    parsed = JSON.parse(stripMarkdownFence(jsonText))
  } catch {
    return { ok: false, error: 'Модель вернула невалидный JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Ожидался JSON-объект summary' }
  }

  const summary = normalizeGuestSummary({
    guestName: String(parsed.guestName ?? parsed.name ?? ''),
    dates: String(parsed.dates ?? ''),
    partyType: String(parsed.partyType ?? ''),
    room: String(parsed.room ?? ''),
    topics: csvFromUnknown(parsed.topics),
    objections: csvFromUnknown(parsed.objections),
    confidence: String(parsed.confidence ?? '0.8'),
    fillRemaining: parsed.fillRemaining,
  })

  const summaryJson = {
    guestName: summary.guestName,
    dates: summary.dates,
    partyType: summary.partyType,
    room: summary.room,
    topics: summary.topics,
    objections: summary.objections,
    confidence: summary.confidence,
    fillRemaining: summary.fillRemaining,
  }

  return {
    ok: true,
    summary,
    summaryJson,
    explanation,
  }
}

export function buildExtractPrompt(rawText) {
  const template = loadGuestSummaryExtractPrompt()
  if (!template.includes('{{RAW_TEXT}}')) {
    throw new Error('В промпте нет плейсхолдера {{RAW_TEXT}}')
  }
  return template.replaceAll('{{RAW_TEXT}}', String(rawText ?? ''))
}

export async function extractGuestSummaryFromRawText(rawText, options = {}) {
  if (!geminiTextConfigured()) {
    return { ok: false, status: 503, error: 'Извлечение не настроено (GEMINI_TRANSCRIBE_URL или GEMINI_API_KEY)' }
  }
  const text = String(rawText ?? '').trim()
  if (!text) {
    return { ok: false, status: 400, error: 'Пустой текст диалогов' }
  }

  const prompt = buildExtractPrompt(text)
  const generated = await generateTextWithGemini(prompt, options)
  if (!generated.ok) return generated

  const parsed = parseGuestSummaryExtractResponse(generated.text)
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
    summary: parsed.summary,
    summaryJson: parsed.summaryJson,
    explanation: parsed.explanation,
    model: generated.model,
    rawModelText: generated.text,
  }
}
