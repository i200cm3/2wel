/** Фильтры звонков для пайплайна презентации (зеркало web/src/cabinet/linkRawSourceKinds.ts). */

import { isRecordingUrl, recordingUrlFromSource } from './recordingUrl.mjs'

export const NON_TARGET_CALL_MAX_SEC = 30

const DURATION_IN_TITLE_RE = /^\d+:\d{2}$/

export function callDurationSecFromTitle(title) {
  for (const part of String(title ?? '')
    .split('·')
    .map((item) => item.trim())) {
    if (!DURATION_IN_TITLE_RE.test(part)) continue
    const [minsRaw, secsRaw] = part.split(':')
    const mins = Number(minsRaw)
    const secs = Number(secsRaw)
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs >= 60) continue
    const total = mins * 60 + secs
    return total > 0 ? total : null
  }
  return null
}

export function callDurationSecFromSource(source) {
  const fromMeta = Number(source?.meta?.durationSec)
  if (Number.isFinite(fromMeta) && fromMeta > 0) return Math.floor(fromMeta)
  return callDurationSecFromTitle(source?.title)
}

/** Короче 30 секунд — нецелевой. */
export function isShortNonTargetCall(source) {
  const sec = callDurationSecFromSource(source)
  return sec != null && sec < NON_TARGET_CALL_MAX_SEC
}

/** Вручную помечен как нецелевой (кабинет). */
export function isManualNonTargetSource(source) {
  return source?.meta?.nonTarget === true
}

/** Короткий или вручную исключённый — не в пайплайне. */
export function isNonTargetCall(source) {
  return isManualNonTargetSource(source) || isShortNonTargetCall(source)
}

export function isAlreadyTranscribed(source) {
  const body = String(source?.body ?? '').trim()
  if (!body || isRecordingUrl(body)) return false
  return Boolean(String(source?.meta?.transcribedAt ?? '').trim()) || body.length > 40
}

/**
 * Звонки для транскрибации / сводки:
 * — не короче 30 сек и не помечены нецелевыми вручную;
 * — есть URL записи;
 * — запись не помечена недоступной.
 */
export function selectCallsForPresentationPipeline(sources = []) {
  const list = Array.isArray(sources) ? sources : []
  const eligible = []
  const skipped = []

  for (const source of list) {
    if (isManualNonTargetSource(source)) {
      skipped.push({ id: source?.id, reason: 'non_target' })
      continue
    }
    const url = recordingUrlFromSource(source)
    if (!url) {
      if (isAlreadyTranscribed(source) && !isShortNonTargetCall(source)) {
        eligible.push({ source, url: null, needsTranscribe: false })
      } else {
        skipped.push({ id: source?.id, reason: 'no_recording_url' })
      }
      continue
    }
    if (isShortNonTargetCall(source)) {
      skipped.push({ id: source?.id, reason: 'short_call' })
      continue
    }
    if (source?.meta?.recordingAvailable === false) {
      skipped.push({ id: source?.id, reason: 'recording_unavailable' })
      continue
    }
    eligible.push({
      source,
      url,
      needsTranscribe: !isAlreadyTranscribed(source),
    })
  }

  return { eligible, skipped }
}
