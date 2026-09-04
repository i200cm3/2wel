import { formatGuestName } from './guestLink.mjs'
import { ensureProjectTts } from './tts.mjs'

const NAME_TOKEN_RE = /\{\s*name\s*\}|\[\s*name\s*\]/i

/** В поле TTS есть плейсхолдер имени — файл нельзя запечь в шаблоне. */
export function ttsTextNeedsGuestName(ttsText) {
  return typeof ttsText === 'string' && NAME_TOKEN_RE.test(ttsText)
}

/** Подставить имя гостя в шаблон озвучки (как в кабинете / плеере). */
export function fillTtsSpeakText(ttsText, guestName) {
  const name = formatGuestName(guestName) || 'гость'
  return String(ttsText ?? '')
    .replace(/\{\s*name\s*\}/gi, name)
    .replace(/\[\s*name\s*\]/gi, name)
}

/**
 * Cue и меню с `{name}` в тексте озвучки — пересобираются при выдаче ссылки.
 * @returns {{ kind: 'cue'|'menu', sequenceId?: string, cueIndex?: number, menuId?: string, cueId: string, template: string, speak: string }[]}
 */
export function collectPersonalizedTtsJobs(config, guestName) {
  const jobs = []
  const sequences = config?.sequences
  if (sequences && typeof sequences === 'object') {
    for (const [sequenceId, seq] of Object.entries(sequences)) {
      const cues = Array.isArray(seq?.cues) ? seq.cues : []
      cues.forEach((cue, cueIndex) => {
        const template = typeof cue?.ttsText === 'string' ? cue.ttsText.trim() : ''
        if (!template || !ttsTextNeedsGuestName(template)) return
        jobs.push({
          kind: 'cue',
          sequenceId,
          cueIndex,
          cueId: typeof cue.id === 'string' ? cue.id : `idx-${cueIndex}`,
          template,
          speak: fillTtsSpeakText(template, guestName),
        })
      })
    }
  }

  const menus = config?.menus
  if (menus && typeof menus === 'object') {
    for (const [menuId, menu] of Object.entries(menus)) {
      const template = typeof menu?.menuTtsText === 'string' ? menu.menuTtsText.trim() : ''
      if (!template || !ttsTextNeedsGuestName(template)) continue
      jobs.push({
        kind: 'menu',
        menuId,
        cueId: `menu:${menuId}`,
        template,
        speak: fillTtsSpeakText(template, guestName),
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
 * Подставляет персональные ttsSrc/ttsHash в копию конфига.
 * Старый файл шаблона сбрасывается — гость не услышит чужое имя.
 * @param {{ required?: boolean }} opts — required: при выдаче ссылки ошибка генерации валит весь запрос
 */
export async function personalizeConfigTts(project, config, guestName, opts = {}) {
  const required = Boolean(opts.required)
  const jobs = collectPersonalizedTtsJobs(config, guestName)
  if (jobs.length === 0) {
    return { ok: true, config, generated: 0, cached: 0 }
  }

  const next = structuredClone(config)
  let generated = 0
  let cached = 0

  for (const job of jobs) {
    if (job.kind === 'menu') {
      const menu = next.menus?.[job.menuId]
      if (!menu) {
        if (required) {
          return {
            ok: false,
            status: 500,
            error: `Не найдено меню для персональной озвучки (${job.cueId})`,
          }
        }
        continue
      }

      delete menu.menuTtsSrc
      delete menu.menuTtsHash

      const result = await ensureProjectTts(project, job.speak, { force: false })
      if (result.status !== 200 || !result.body?.ok || !result.body.src) {
        const error =
          result.body?.error ||
          result.body?.detail ||
          `Не удалось озвучить меню с {name} (${job.cueId})`
        if (required) {
          return { ok: false, status: result.status >= 400 ? result.status : 502, error }
        }
        console.error('tts personalize', project.code, job.cueId, error)
        continue
      }

      menu.menuTtsSrc = result.body.src
      if (result.body.hash) menu.menuTtsHash = result.body.hash
      if (result.body.cached) cached += 1
      else generated += 1
      continue
    }

    const seq = next.sequences?.[job.sequenceId]
    const cue = Array.isArray(seq?.cues) ? seq.cues[job.cueIndex] : null
    if (!cue) {
      if (required) {
        return {
          ok: false,
          status: 500,
          error: `Не найден титр для персональной озвучки (${job.cueId})`,
        }
      }
      continue
    }

    // Не оставляем файл шаблона («Гость» / превью редактора), если генерация сорвётся.
    delete cue.ttsSrc
    delete cue.ttsHash

    const result = await ensureProjectTts(project, job.speak, { force: false })
    if (result.status !== 200 || !result.body?.ok || !result.body.src) {
      const error =
        result.body?.error ||
        result.body?.detail ||
        `Не удалось озвучить текст с {name} (${job.cueId})`
      if (required) {
        return { ok: false, status: result.status >= 400 ? result.status : 502, error }
      }
      console.error('tts personalize', project.code, job.cueId, error)
      continue
    }

    cue.ttsSrc = result.body.src
    if (result.body.hash) cue.ttsHash = result.body.hash
    const dur = result.body.durationSec
    if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
      extendCueDuration(seq, job.cueIndex, dur)
    }
    if (result.body.cached) cached += 1
    else generated += 1
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

  return { ok: true, config: next, generated, cached }
}
