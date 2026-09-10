import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { looksLikePersonName } from './guestLink.mjs'
import { assemblyTextConfigured, generateAssemblyText } from './yandexGpt.mjs'

const API_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROMPT_NAME = 'hello-generate.md'

export const DEFAULT_HELLO_TEMPLATE = 'Здравствуйте, {name}!'
export const HELLO_TOKEN_RE = /\{\s*hello\s*\}/gi

const MAX_HELLO_CHARS = 420

function resolveHelloPromptPath() {
  const candidates = [
    path.join(API_DIR, 'prompts', PROMPT_NAME),
    path.join(API_DIR, '..', 'prompts', PROMPT_NAME),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

export function loadHelloGeneratePrompt() {
  const promptPath = resolveHelloPromptPath()
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

function extractJsonObject(text) {
  const trimmed = String(text ?? '').trim()
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed
  const start = jsonText.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < jsonText.length; i += 1) {
    const ch = jsonText[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return jsonText.slice(start, i + 1)
    }
  }
  return null
}

export function textHasHelloPlaceholder(value) {
  return typeof value === 'string' && /\{\s*hello\s*\}/i.test(value)
}

export function fillHelloPlaceholder(template, hello) {
  return String(template ?? '').replace(HELLO_TOKEN_RE, String(hello ?? ''))
}

export function sanitizeHelloPhrase(value) {
  let text = String(value ?? '').replace(/\{\s*hello\s*\}/gi, '')
  text = text.replace(/\s+/g, ' ').trim()
  if (text.length > MAX_HELLO_CHARS) text = text.slice(0, MAX_HELLO_CHARS).trim()
  return text
}

export function parseHelloGenerateResponse(raw) {
  const jsonText = extractJsonObject(stripMarkdownFence(raw))
  if (!jsonText) return { ok: false, error: 'В ответе нет JSON-объекта' }
  let parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, error: 'Модель вернула невалидный JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Ожидался JSON-объект hello' }
  }
  const mode = String(parsed.mode ?? '').trim().toLowerCase() === 'personal' ? 'personal' : 'default'
  const hello = sanitizeHelloPhrase(parsed.hello)
  return { ok: true, mode, hello }
}

export function buildHelloPrompt({ rawText, guestName, brandName }) {
  const template = loadHelloGeneratePrompt()
  return template
    .replaceAll('{{GUEST_NAME}}', String(guestName ?? '').trim() || '—')
    .replaceAll('{{BRAND_NAME}}', String(brandName ?? '').trim() || '—')
    .replaceAll('{{RAW_TEXT}}', String(rawText ?? ''))
}

export function defaultHelloResult() {
  return { ok: true, mode: 'default', hello: DEFAULT_HELLO_TEMPLATE }
}

export function offHelloResult() {
  return { ok: true, mode: 'off', hello: '' }
}

/**
 * Если настройка выключена — пустой {hello}.
 * Если включена — отдельный промпт по диалогу, иначе дефолт «Здравствуйте, {name}!».
 */
export async function generateHelloFromDialog({
  enabled = false,
  rawText = '',
  guestName = '',
  brandName = '',
} = {}) {
  if (!enabled) return offHelloResult()
  if (!looksLikePersonName(guestName) || !String(rawText ?? '').trim()) {
    return defaultHelloResult()
  }
  if (!(await assemblyTextConfigured())) return defaultHelloResult()

  const prompt = buildHelloPrompt({ rawText, guestName, brandName })
  const generated = await generateAssemblyText(prompt, { temperature: 0.35, maxTokens: 800 })
  if (!generated.ok) {
    console.warn('hello.generate.fail', generated.error || generated.status)
    return defaultHelloResult()
  }

  const parsed = parseHelloGenerateResponse(generated.text)
  if (!parsed.ok) {
    console.warn('hello.parse.fail', parsed.error)
    return defaultHelloResult()
  }
  if (parsed.mode !== 'personal' || !parsed.hello) return defaultHelloResult()

  return {
    ok: true,
    mode: 'personal',
    hello: parsed.hello,
    model: generated.model,
  }
}

/**
 * @param {{ reuseExisting?: boolean }} [options]
 */
export async function resolveSummaryHello(summary, { enabled, rawText, brandName, reuseExisting = false } = {}) {
  const next = { ...summary }
  if (!enabled) {
    next.hello = ''
    return { summary: next, helloMode: 'off' }
  }
  const existing = String(summary?.hello ?? '').trim()
  if (reuseExisting && existing) {
    next.hello = existing
    return { summary: next, helloMode: 'reuse' }
  }
  const generated = await generateHelloFromDialog({
    enabled: true,
    rawText,
    guestName: summary?.guestName,
    brandName,
  })
  next.hello = generated.hello
  return { summary: next, helloMode: generated.mode, helloModel: generated.model }
}

function replaceHelloInString(value, hello) {
  if (typeof value !== 'string' || !textHasHelloPlaceholder(value)) return value
  return fillHelloPlaceholder(value, hello)
}

export function configHasHelloPlaceholder(config) {
  if (!config || typeof config !== 'object') return false
  for (const seq of Object.values(config.sequences ?? {})) {
    if (textHasHelloPlaceholder(seq?.title)) return true
    for (const cue of Array.isArray(seq?.cues) ? seq.cues : []) {
      if (textHasHelloPlaceholder(cue?.text) || textHasHelloPlaceholder(cue?.ttsText)) return true
    }
  }
  for (const menu of Object.values(config.menus ?? {})) {
    if (textHasHelloPlaceholder(menu?.menuTtsText)) return true
  }
  return false
}

/** Подставить {hello} в копию конфига (титры / TTS-текст). Мутирует переданный объект. */
export function applyHelloPlaceholderInConfig(config, hello) {
  if (!config || typeof config !== 'object') return config
  const value = String(hello ?? '')
  const sequences = config.sequences
  if (sequences && typeof sequences === 'object') {
    for (const seq of Object.values(sequences)) {
      if (!seq || typeof seq !== 'object') continue
      if (typeof seq.title === 'string') seq.title = replaceHelloInString(seq.title, value)
      if (!Array.isArray(seq.cues)) continue
      for (const cue of seq.cues) {
        if (!cue || typeof cue !== 'object') continue
        if (typeof cue.text === 'string') cue.text = replaceHelloInString(cue.text, value)
        if (typeof cue.ttsText === 'string') cue.ttsText = replaceHelloInString(cue.ttsText, value)
      }
    }
  }
  const menus = config.menus
  if (menus && typeof menus === 'object') {
    for (const menu of Object.values(menus)) {
      if (!menu || typeof menu !== 'object') continue
      if (typeof menu.menuTtsText === 'string') {
        menu.menuTtsText = replaceHelloInString(menu.menuTtsText, value)
      }
    }
  }
  return config
}
