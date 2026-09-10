import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROMPT_NAME = 'cue-copy-generate.md'

const AUDIENCE_LABELS = {
  solo: 'Один',
  couple: 'Пара',
  family: 'Семья',
  senior: 'Старшие гости',
}

const TOPIC_LABELS = {
  intro: 'Вступление',
  about: 'Об объекте',
  room: 'Номера',
  treatment: 'Лечение',
  food: 'Питание',
  territory: 'Территория',
  wellness: 'Wellness',
  leisure: 'Досуг',
  family: 'Семья',
  couple: 'Пара',
  senior: 'Старшие гости',
  location: 'Локация / дорога',
  price: 'Цена и ценность',
  trust: 'Доверие',
  purpose: 'Цель поездки',
  'next-step': 'Следующий шаг',
  cta: 'Призыв к действию',
}

const OBJECTION_LABELS = {
  price: 'Цена',
  expensive: 'Дорого',
  distance: 'Дорога / удалённость',
  'treatment-fit': 'Подойдёт ли лечение',
  'room-fit': 'Подойдёт ли номер',
  'food-fit': 'Подойдёт ли питание',
  'family-fit': 'Удобно ли с семьёй',
  uncertainty: 'Неопределённость',
  'compare-competitor': 'Сравнение с конкурентом',
  'dates-not-fixed': 'Даты не определены',
}

function resolvePromptPath() {
  const candidates = [
    path.join(API_DIR, 'prompts', PROMPT_NAME),
    path.join(API_DIR, '..', 'prompts', PROMPT_NAME),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

export function loadCueCopyGeneratePrompt() {
  const promptPath = resolvePromptPath()
  try {
    return fs.readFileSync(promptPath, 'utf8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Не найден промпт ${PROMPT_NAME} (${promptPath}): ${message}`)
  }
}

function asString(value, max = 2000) {
  return String(value ?? '')
    .trim()
    .slice(0, max)
}

function asStringList(value, maxItems = 24) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asString(item, 64))
    .filter(Boolean)
    .slice(0, maxItems)
}

function formatTags(values, labels) {
  const list = asStringList(values)
  if (!list.length) return '—'
  return list.map((value) => labels[value] ?? value).join(', ')
}

function formatCueList(cues, emptyLabel) {
  if (!Array.isArray(cues) || !cues.length) return emptyLabel
  return cues
    .map((cue, index) => {
      const text = asString(cue?.text, 500)
      const ttsText = asString(cue?.ttsText, 800)
      return `${index + 1}. text: ${text || '—'}\n   ttsText: ${ttsText || '—'}`
    })
    .join('\n')
}

function formatCurrentCue(cue) {
  if (!cue || typeof cue !== 'object') {
    return 'text: —\nttsText: —'
  }
  return `text: ${asString(cue.text, 500) || '—'}\nttsText: ${asString(cue.ttsText, 800) || '—'}`
}

function stripMarkdownFence(text) {
  const trimmed = String(text ?? '').trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```/i)
  return match ? match[1].trim() : trimmed
}

/**
 * @param {object} input
 * @param {object} [input.brand]
 * @param {string} [input.copyFacts]
 * @param {object} [input.block]
 * @param {number} input.cueIndex zero-based
 * @param {boolean} [input.updateTitle]
 */
export function buildCueCopyPrompt(input = {}) {
  const brand = input.brand && typeof input.brand === 'object' ? input.brand : {}
  const block = input.block && typeof input.block === 'object' ? input.block : {}
  const cues = Array.isArray(block.cues) ? block.cues : []
  const cueIndex = Number(input.cueIndex)
  if (!Number.isInteger(cueIndex) || cueIndex < 0 || cueIndex >= cues.length) {
    return { ok: false, error: 'Некорректный cueIndex' }
  }

  const updateTitle = input.updateTitle !== false
  const previous = cues.slice(0, cueIndex)
  const current = cues[cueIndex]
  const later = cues.slice(cueIndex + 1)

  const template = loadCueCopyGeneratePrompt()
  const prompt = template
    .replaceAll('{{brand_name}}', asString(brand.name, 120) || '—')
    .replaceAll('{{brand_full_name}}', asString(brand.fullName, 200) || '—')
    .replaceAll('{{brand_city}}', asString(brand.city, 120) || '—')
    .replaceAll('{{brand_site}}', asString(brand.site, 300) || '—')
    .replaceAll(
      '{{copy_facts}}',
      asString(input.copyFacts, 12000) || '(факты не заполнены — не выдумывай конкретику)',
    )
    .replaceAll('{{label}}', asString(block.label, 200) || '—')
    .replaceAll('{{group}}', asString(block.group, 64) || '—')
    .replaceAll('{{subgroup}}', asString(block.subgroup, 64) || '—')
    .replaceAll('{{audience_tags}}', formatTags(block.audienceTags, AUDIENCE_LABELS))
    .replaceAll('{{topic_tags}}', formatTags(block.topicTags, TOPIC_LABELS))
    .replaceAll('{{objection_tags}}', formatTags(block.objectionTags, OBJECTION_LABELS))
    .replaceAll(
      '{{slot_fields}}',
      asStringList(block.slotFields).join(', ') || '—',
    )
    .replaceAll('{{title}}', asString(block.title, 300) || '—')
    .replaceAll('{{cue_count}}', String(cues.length))
    .replaceAll('{{cue_index}}', String(cueIndex + 1))
    .replaceAll('{{update_title}}', updateTitle ? 'да' : 'нет')
    .replaceAll('{{previous_cues}}', formatCueList(previous, '(это первый титр)'))
    .replaceAll('{{current_cue}}', formatCurrentCue(current))
    .replaceAll('{{later_cues}}', formatCueList(later, '(это последний титр)'))

  return { ok: true, prompt, updateTitle, cueIndex }
}

export function parseCueCopyResponse(raw, { updateTitle = true, fallbackTitle = '' } = {}) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: 'Пустой ответ модели' }

  let jsonText = stripMarkdownFence(text)
  if (!jsonText.startsWith('{')) {
    const start = jsonText.indexOf('{')
    const end = jsonText.lastIndexOf('}')
    if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1)
  }

  let parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, error: 'Ответ модели не JSON' }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Ответ модели не объект' }
  }

  const cueRaw = parsed.cue && typeof parsed.cue === 'object' ? parsed.cue : parsed
  const cueText = asString(cueRaw.text ?? cueRaw.caption, 500)
  const cueTts = asString(cueRaw.ttsText ?? cueRaw.tts, 800)
  if (!cueText && !cueTts) {
    return { ok: false, error: 'В ответе нет текста титра/озвучки' }
  }

  const titleFromModel = asString(parsed.title, 300)
  const title = updateTitle
    ? titleFromModel || asString(fallbackTitle, 300)
    : asString(fallbackTitle, 300) || titleFromModel

  return {
    ok: true,
    title,
    cue: {
      text: cueText,
      ttsText: cueTts || cueText,
    },
  }
}

export async function generateCueCopy(input = {}, options = {}) {
  const { generateTextWithGemini, geminiTextConfigured } = await import('./geminiTranscribe.mjs')
  if (!(await geminiTextConfigured())) {
    return { ok: false, status: 503, error: 'Gemini text generate не настроен' }
  }

  const built = buildCueCopyPrompt(input)
  if (!built.ok) return { ok: false, status: 400, error: built.error }

  const temperature =
    Number.isFinite(options.temperature) ? options.temperature : 0.85
  const generated = await generateTextWithGemini(built.prompt, {
    ...options,
    temperature,
  })
  if (!generated.ok) {
    return {
      ok: false,
      status: generated.status || 502,
      error: generated.error || 'Не удалось сгенерировать текст',
      detail: generated.detail,
    }
  }

  const parsed = parseCueCopyResponse(generated.text, {
    updateTitle: built.updateTitle,
    fallbackTitle: input?.block?.title,
  })
  if (!parsed.ok) {
    return { ok: false, status: 502, error: parsed.error, raw: generated.text }
  }

  return {
    ok: true,
    title: parsed.title,
    cue: parsed.cue,
    model: generated.model,
  }
}
