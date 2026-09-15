import { fillGuestNameTemplate } from './guestLink.mjs'
import {
  applyHelloPlaceholderInConfig,
  configHasHelloPlaceholder,
  fillHelloPlaceholder,
  textHasHelloPlaceholder,
} from './helloGenerate.mjs'
import {
  elevenSettings,
  ensureProjectTts,
  ttsCacheKey,
  ttsCacheKeyParts,
} from './tts.mjs'
import { resolveGenerationVoice } from './ttsVoices.mjs'

const NAME_TOKEN_RE = /\{\s*name\s*\}|\[\s*name\s*\]/i
const DATES_TOKEN_RE = /\{\s*dates\s*\}/i
const ROOM_TOKEN_RE = /\{\s*room\s*\}/i

const ROOM_SPEAK = {
  standard: 'стандарт',
  superior: 'superior',
  deluxe: 'делюкс',
  luxury: 'люкс',
  single: 'одноместный',
  double: 'двухместный',
  family: 'семейный',
  quiet: 'тихий номер',
  view: 'номер с видом',
  'near-medical': 'номер ближе к лечебной базе',
  comfort: 'комфорт',
}

/** В поле TTS есть плейсхолдер имени — файл нельзя запечь в шаблоне. */
export function ttsTextNeedsGuestName(ttsText) {
  return typeof ttsText === 'string' && NAME_TOKEN_RE.test(ttsText)
}

export function ttsTextNeedsDatesOrRoom(ttsText) {
  return typeof ttsText === 'string' && (DATES_TOKEN_RE.test(ttsText) || ROOM_TOKEN_RE.test(ttsText))
}

export function ttsTextNeedsPersonalization(ttsText) {
  return (
    ttsTextNeedsGuestName(ttsText) ||
    textHasHelloPlaceholder(ttsText) ||
    ttsTextNeedsDatesOrRoom(ttsText)
  )
}

function omitBracePlaceholder(template, key) {
  const token = '\u0001'
  const re = new RegExp(`\\{\\s*${key}\\s*\\}`, 'gi')
  let s = String(template ?? '').replace(re, token)
  s = s.replace(new RegExp(`,\\s*${token}(?=[\\s.!?…,:;]|$)`, 'g'), '')
  s = s.replace(new RegExp(`\\s*—\\s*${token}(?=[\\s.!?…,:;]|$)`, 'g'), '')
  s = s.replace(new RegExp(`\\s*${token}`, 'g'), '')
  s = s.replaceAll(token, '')
  s = s.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/[ \t]+([.!?,:;])/g, '$1')
  return s.replace(/[ \t]+$/gm, '').replace(/[ \t]{2,}/g, ' ')
}

function fillBracePlaceholder(template, key, value) {
  const text = String(value ?? '').trim()
  if (!text) return omitBracePlaceholder(template, key)
  const re = new RegExp(`\\{\\s*${key}\\s*\\}`, 'gi')
  return String(template ?? '').replace(re, text)
}

export function speakRoomLabel(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return ROOM_SPEAK[raw.toLowerCase()] || raw
}

/** Подставить {hello}, имя, {dates} и {room}. */
export function fillTtsSpeakText(ttsText, guestName, hello = '', fields = {}) {
  let s = fillGuestNameTemplate(fillHelloPlaceholder(ttsText, hello), guestName)
  s = fillBracePlaceholder(s, 'dates', fields.dates)
  s = fillBracePlaceholder(s, 'room', speakRoomLabel(fields.room))
  return s
}

function fillStringField(value, guestName, hello, fields) {
  if (typeof value !== 'string' || !value) return value
  return fillTtsSpeakText(value, guestName, hello, fields)
}

/** Титры и заголовки в копии конфига — чтобы на экране были те же даты, что в озвучке. */
export function fillGuestFieldsInConfig(config, guestName, hello = '', fields = {}) {
  if (!config || typeof config !== 'object') return config
  const sequences = config.sequences
  if (sequences && typeof sequences === 'object') {
    for (const seq of Object.values(sequences)) {
      if (!seq || typeof seq !== 'object') continue
      if (typeof seq.title === 'string') {
        seq.title = fillStringField(seq.title, guestName, hello, fields)
      }
      if (Array.isArray(seq.cues)) {
        for (const cue of seq.cues) {
          if (!cue || typeof cue !== 'object') continue
          if (typeof cue.text === 'string') {
            cue.text = fillStringField(cue.text, guestName, hello, fields)
          }
          if (typeof cue.ttsText === 'string') {
            cue.ttsText = fillStringField(cue.ttsText, guestName, hello, fields)
          }
        }
      }
    }
  }
  const menus = config.menus
  if (menus && typeof menus === 'object') {
    for (const menu of Object.values(menus)) {
      if (!menu || typeof menu !== 'object') continue
      if (typeof menu.menuTtsText === 'string') {
        menu.menuTtsText = fillStringField(menu.menuTtsText, guestName, hello, fields)
      }
      const copy = menu.menuCopy
      if (copy && typeof copy === 'object') {
        for (const key of ['kicker', 'title', 'hint']) {
          if (typeof copy[key] === 'string') {
            copy[key] = fillStringField(copy[key], guestName, hello, fields)
          }
        }
      }
    }
  }
  return config
}

/**
 * Cue и меню с `{name}` / `{hello}` в тексте озвучки — пересобираются при выдаче ссылки.
 * @returns {{ kind: 'cue'|'menu', sequenceId?: string, cueIndex?: number, menuId?: string, cueId: string, template: string, speak: string }[]}
 */
export function collectPersonalizedTtsJobs(config, guestName, hello = '', fields = {}) {
  const jobs = []
  const sequences = config?.sequences
  if (sequences && typeof sequences === 'object') {
    for (const [sequenceId, seq] of Object.entries(sequences)) {
      const cues = Array.isArray(seq?.cues) ? seq.cues : []
      cues.forEach((cue, cueIndex) => {
        const template = typeof cue?.ttsText === 'string' ? cue.ttsText.trim() : ''
        if (!template || !ttsTextNeedsPersonalization(template)) return
        jobs.push({
          kind: 'cue',
          sequenceId,
          cueIndex,
          cueId: typeof cue.id === 'string' ? cue.id : `idx-${cueIndex}`,
          template,
          speak: fillTtsSpeakText(template, guestName, hello, fields),
        })
      })
    }
  }

  const menus = config?.menus
  if (menus && typeof menus === 'object') {
    for (const [menuId, menu] of Object.entries(menus)) {
      const template = typeof menu?.menuTtsText === 'string' ? menu.menuTtsText.trim() : ''
      if (!template || !ttsTextNeedsPersonalization(template)) continue
      jobs.push({
        kind: 'menu',
        menuId,
        cueId: `menu:${menuId}`,
        template,
        speak: fillTtsSpeakText(template, guestName, hello, fields),
      })
    }
  }

  return jobs
}

function hasTtsSrc(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Cue/меню с готовым ttsText, но без файла — не были сгенерированы вручную в конструкторе.
 * Без `{name}`: один файл на весь шаблон.
 */
export function collectMissingStaticTtsJobs(config) {
  const jobs = []
  const sequences = config?.sequences
  if (sequences && typeof sequences === 'object') {
    for (const [sequenceId, seq] of Object.entries(sequences)) {
      const cues = Array.isArray(seq?.cues) ? seq.cues : []
      cues.forEach((cue, cueIndex) => {
        const template = typeof cue?.ttsText === 'string' ? cue.ttsText.trim() : ''
        if (!template || ttsTextNeedsPersonalization(template) || hasTtsSrc(cue?.ttsSrc)) return
        jobs.push({
          kind: 'cue',
          sequenceId,
          cueIndex,
          cueId: typeof cue.id === 'string' ? cue.id : `idx-${cueIndex}`,
          template,
          speak: template,
        })
      })
    }
  }

  const menus = config?.menus
  if (menus && typeof menus === 'object') {
    for (const [menuId, menu] of Object.entries(menus)) {
      const template = typeof menu?.menuTtsText === 'string' ? menu.menuTtsText.trim() : ''
      if (!template || ttsTextNeedsPersonalization(template) || hasTtsSrc(menu?.menuTtsSrc)) continue
      jobs.push({
        kind: 'menu',
        menuId,
        cueId: `menu:${menuId}`,
        template,
        speak: template,
      })
    }
  }

  return jobs
}

/**
 * Статическая озвучка с файлом, но текст/голос уже не совпадают с ttsHash.
 * `expectedHashForSpeak(speak)` — хеш текущего голоса проекта для текста.
 */
export function collectStaleStaticTtsJobs(config, expectedHashForSpeak) {
  const jobs = []
  if (typeof expectedHashForSpeak !== 'function') return jobs

  const sequences = config?.sequences
  if (sequences && typeof sequences === 'object') {
    for (const [sequenceId, seq] of Object.entries(sequences)) {
      const cues = Array.isArray(seq?.cues) ? seq.cues : []
      cues.forEach((cue, cueIndex) => {
        const template = typeof cue?.ttsText === 'string' ? cue.ttsText.trim() : ''
        if (!template || ttsTextNeedsPersonalization(template) || !hasTtsSrc(cue?.ttsSrc)) return
        const expected = String(expectedHashForSpeak(template) ?? '')
        const current = typeof cue?.ttsHash === 'string' ? cue.ttsHash.trim() : ''
        if (expected && current && current === expected) return
        jobs.push({
          kind: 'cue',
          sequenceId,
          cueIndex,
          cueId: typeof cue.id === 'string' ? cue.id : `idx-${cueIndex}`,
          template,
          speak: template,
        })
      })
    }
  }

  const menus = config?.menus
  if (menus && typeof menus === 'object') {
    for (const [menuId, menu] of Object.entries(menus)) {
      const template = typeof menu?.menuTtsText === 'string' ? menu.menuTtsText.trim() : ''
      if (!template || ttsTextNeedsPersonalization(template) || !hasTtsSrc(menu?.menuTtsSrc)) continue
      const expected = String(expectedHashForSpeak(template) ?? '')
      const current = typeof menu?.menuTtsHash === 'string' ? menu.menuTtsHash.trim() : ''
      if (expected && current && current === expected) continue
      jobs.push({
        kind: 'menu',
        menuId,
        cueId: `menu:${menuId}`,
        template,
        speak: template,
      })
    }
  }

  return jobs
}

function clipHoldSec(clip) {
  const sec = Number(clip?.durationSec)
  return Number.isFinite(sec) && sec > 0 ? sec : 2
}

/**
 * Длиннее имя → длиннее mp3: двигаем следующие cue и удлиняем кадр,
 * иначе плеер «замораживает» слайд, потом скачет к следующему файлу.
 */
export function extendCueDuration(seq, cueIndex, nextDurationSec) {
  if (!seq || !Array.isArray(seq.cues)) return
  const cue = seq.cues[cueIndex]
  if (!cue) return
  const nextDur = Math.max(0.3, Number(nextDurationSec) || 0)
  if (!(nextDur > 0)) return
  const prevDur = Math.max(0.3, Number(cue.durationSec) || 2)
  const delta = nextDur - prevDur
  cue.durationSec = Number(Math.max(prevDur, nextDur).toFixed(3))
  if (delta <= 0.05) return

  const cueStart = Math.max(0, Number(cue.startSec) || 0)
  const oldEnd = cueStart + prevDur
  for (let i = 0; i < seq.cues.length; i += 1) {
    if (i === cueIndex) continue
    const other = seq.cues[i]
    const otherStart = Math.max(0, Number(other.startSec) || 0)
    if (otherStart >= oldEnd - 0.05) {
      other.startSec = Number((otherStart + delta).toFixed(3))
    }
  }

  if (!Array.isArray(seq.clips) || seq.clips.length === 0) return
  let t = 0
  for (const clip of seq.clips) {
    const hold = clipHoldSec(clip)
    const clipEnd = t + hold
    if (cueStart >= t - 0.05 && cueStart < clipEnd + 0.05) {
      const newHold = Number((hold + delta).toFixed(3))
      clip.durationSec = newHold
      if (typeof clip.animSec === 'number' && clip.animSec > 0) {
        clip.animSec = newHold
      }
      break
    }
    t = clipEnd
  }
}

/**
 * В титрах гостя показывает текст озвучки (ttsText) вместо короткого caption.
 * Не мутирует исходный конфиг. Пустой ttsText не трогает.
 */
export function applyCaptionsFromTts(config) {
  if (!config || typeof config !== 'object') return config
  const sequences = config.sequences
  if (!sequences || typeof sequences !== 'object') return config

  let changed = false
  const nextSequences = { ...sequences }
  for (const [sequenceId, seq] of Object.entries(sequences)) {
    if (!seq || !Array.isArray(seq.cues) || seq.cues.length === 0) continue
    let seqChanged = false
    const cues = seq.cues.map((cue) => {
      const speak = typeof cue?.ttsText === 'string' ? cue.ttsText.trim() : ''
      if (!speak) return cue
      seqChanged = true
      return { ...cue, text: cue.ttsText, showText: true }
    })
    if (!seqChanged) continue
    changed = true
    nextSequences[sequenceId] = { ...seq, cues }
  }
  if (!changed) return config
  return { ...config, sequences: nextSequences }
}

/**
 * Подставляет персональные ttsSrc/ttsHash в копию конфига
 * и догенерирует отсутствующие статические озвучки (есть ttsText, нет ttsSrc).
 * Старый файл шаблона с `{name}` сбрасывается — гость не услышит чужое имя.
 * @param {{ required?: boolean, fillMissingStatic?: boolean }} opts
 *   required: при выдаче ссылки ошибка генерации валит весь запрос
 *   fillMissingStatic: догенерировать статические без ttsSrc (по умолчанию true)
 */
export async function personalizeConfigTts(project, config, guestName, opts = {}) {
  const required = Boolean(opts.required)
  const fillMissingStatic = opts.fillMissingStatic !== false
  const hello = String(opts.hello ?? '')
  const fields = {
    dates: String(opts.dates ?? '').trim(),
    room: String(opts.room ?? '').trim(),
  }
  const personalJobs = collectPersonalizedTtsJobs(config, guestName, hello, fields)
  const staticJobs = fillMissingStatic ? collectMissingStaticTtsJobs(config) : []
  const needsHello = configHasHelloPlaceholder(config)
  const needsFieldFill = Boolean(fields.dates || fields.room)
  if (personalJobs.length === 0 && staticJobs.length === 0 && !needsHello && !needsFieldFill) {
    return { ok: true, config, generated: 0, cached: 0, staticGenerated: 0, staticCached: 0 }
  }

  const next = structuredClone(config)
  applyHelloPlaceholderInConfig(next, hello)
  let generated = 0
  let cached = 0
  let staticGenerated = 0
  let staticCached = 0

  for (const job of staticJobs) {
    const applied = await applyTtsJob(project, next, job, {
      required,
      clearExisting: false,
      label: 'статическую озвучку',
    })
    if (!applied.ok) return applied
    if (applied.cached) staticCached += 1
    else if (applied.generated) staticGenerated += 1
  }

  for (const job of personalJobs) {
    const applied = await applyTtsJob(project, next, job, {
      required,
      clearExisting: true,
      label: 'персональную озвучку',
    })
    if (!applied.ok) return applied
    if (applied.cached) cached += 1
    else if (applied.generated) generated += 1
  }

  // Зеркало плоских полей главного меню после персонализации.
  const defaultMenuId =
    typeof next.defaultMenuId === 'string' && next.menus?.[next.defaultMenuId]
      ? next.defaultMenuId
      : next.menus?.main
        ? 'main'
        : Object.keys(next.menus ?? {})[0]
  const main = defaultMenuId ? next.menus?.[defaultMenuId] : null
  if (main) {
    next.menuTtsSrc = main.menuTtsSrc
  }

  fillGuestFieldsInConfig(next, guestName, hello, fields)

  return {
    ok: true,
    config: next,
    generated,
    cached,
    staticGenerated,
    staticCached,
    changed: staticGenerated + staticCached + generated + cached > 0,
  }
}

/**
 * Только отсутствующие статические TTS (без `{name}`) — для записи обратно в шаблон.
 */
export async function ensureMissingStaticTts(project, config, opts = {}) {
  const required = Boolean(opts.required)
  const jobs = collectMissingStaticTtsJobs(config)
  if (jobs.length === 0) {
    return { ok: true, config, changed: false, staticGenerated: 0, staticCached: 0 }
  }

  const next = structuredClone(config)
  let staticGenerated = 0
  let staticCached = 0

  for (const job of jobs) {
    const applied = await applyTtsJob(project, next, job, {
      required,
      clearExisting: false,
      label: 'статическую озвучку',
    })
    if (!applied.ok) return applied
    if (applied.cached) staticCached += 1
    else if (applied.generated) staticGenerated += 1
  }

  const defaultMenuId =
    typeof next.defaultMenuId === 'string' && next.menus?.[next.defaultMenuId]
      ? next.defaultMenuId
      : next.menus?.main
        ? 'main'
        : Object.keys(next.menus ?? {})[0]
  const main = defaultMenuId ? next.menus?.[defaultMenuId] : null
  if (main) {
    next.menuTtsSrc = main.menuTtsSrc
  }

  return {
    ok: true,
    config: next,
    changed: true,
    staticGenerated,
    staticCached,
  }
}

/**
 * Пересобрать статическую озвучку, если ttsText/голос уже не совпадают с ttsHash.
 * Пишет обновлённые src/hash обратно в копию конфига (для templates.config).
 */
export async function resyncStaleStaticTts(project, config, opts = {}) {
  const required = Boolean(opts.required)
  const selection = await resolveGenerationVoice(project.id)
  const eleven = selection.provider === 'elevenlabs' ? elevenSettings() : null
  const expectedHashForSpeak = (speak) =>
    ttsCacheKey(ttsCacheKeyParts(speak, selection, eleven))

  const jobs = collectStaleStaticTtsJobs(config, expectedHashForSpeak)
  if (jobs.length === 0) {
    return { ok: true, config, changed: false, staticGenerated: 0, staticCached: 0 }
  }

  const next = structuredClone(config)
  let staticGenerated = 0
  let staticCached = 0

  for (const job of jobs) {
    const applied = await applyTtsJob(project, next, job, {
      required,
      clearExisting: true,
      label: 'устаревшую озвучку',
    })
    if (!applied.ok) return applied
    if (applied.cached) staticCached += 1
    else if (applied.generated) staticGenerated += 1
  }

  const defaultMenuId =
    typeof next.defaultMenuId === 'string' && next.menus?.[next.defaultMenuId]
      ? next.defaultMenuId
      : next.menus?.main
        ? 'main'
        : Object.keys(next.menus ?? {})[0]
  const main = defaultMenuId ? next.menus?.[defaultMenuId] : null
  if (main) {
    next.menuTtsSrc = main.menuTtsSrc
  }

  return {
    ok: true,
    config: next,
    changed: true,
    staticGenerated,
    staticCached,
  }
}

async function applyTtsJob(project, next, job, { required, clearExisting, label }) {
  const speak = String(job.speak ?? '').trim()
  if (job.kind === 'menu') {
    const menu = next.menus?.[job.menuId]
    if (!menu) {
      if (required) {
        return {
          ok: false,
          status: 500,
          error: `Не найдено меню для ${label} (${job.cueId})`,
        }
      }
      return { ok: true, generated: false, cached: false }
    }

    if (clearExisting || !speak) {
      delete menu.menuTtsSrc
      delete menu.menuTtsHash
    }
    if (!speak) return { ok: true, generated: false, cached: false }

    const result = await ensureProjectTts(project, speak, { force: false })
    if (result.status !== 200 || !result.body?.ok || !result.body.src) {
      const error =
        result.body?.error ||
        result.body?.detail ||
        `Не удалось озвучить ${label} (${job.cueId})`
      if (required) {
        return { ok: false, status: result.status >= 400 ? result.status : 502, error }
      }
      console.error('tts personalize', project.code, job.cueId, error)
      return { ok: true, generated: false, cached: false }
    }

    menu.menuTtsSrc = result.body.src
    if (result.body.hash) menu.menuTtsHash = result.body.hash
    return {
      ok: true,
      generated: !result.body.cached,
      cached: Boolean(result.body.cached),
    }
  }

  const seq = next.sequences?.[job.sequenceId]
  const cue = Array.isArray(seq?.cues) ? seq.cues[job.cueIndex] : null
  if (!cue) {
    if (required) {
      return {
        ok: false,
        status: 500,
        error: `Не найден титр для ${label} (${job.cueId})`,
      }
    }
    return { ok: true, generated: false, cached: false }
  }

  if (clearExisting || !speak) {
    // Не оставляем файл шаблона («Гость» / превью редактора), если генерация сорвётся.
    delete cue.ttsSrc
    delete cue.ttsHash
  }
  if (!speak) return { ok: true, generated: false, cached: false }

  const result = await ensureProjectTts(project, speak, { force: false })
  if (result.status !== 200 || !result.body?.ok || !result.body.src) {
    const error =
      result.body?.error ||
      result.body?.detail ||
      `Не удалось озвучить ${label} (${job.cueId})`
    if (required) {
      return { ok: false, status: result.status >= 400 ? result.status : 502, error }
    }
    console.error('tts personalize', project.code, job.cueId, error)
    return { ok: true, generated: false, cached: false }
  }

  cue.ttsSrc = result.body.src
  if (result.body.hash) cue.ttsHash = result.body.hash
  const dur = result.body.durationSec
  if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
    extendCueDuration(seq, job.cueIndex, dur)
  }
  return {
    ok: true,
    generated: !result.body.cached,
    cached: Boolean(result.body.cached),
  }
}
