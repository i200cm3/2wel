import {
  clipHoldSec,
  clipMediaKind,
  isVideoSrc,
  normalizeCue,
  type StoryClip,
  type StoryCue,
} from '../../types/story.ts'

export const PX_PER_SEC_DEFAULT = 52
export const PX_PER_SEC_MIN = 24
export const PX_PER_SEC_MAX = 140
export const PX_PER_SEC_STEP = 8
export const TIMELINE_LABEL_PX = 44
export const TRACK_ADD_PX = 48
export const TRACK_ADD_GAP = 8
/** Шаг кадра для стрелок (30 fps). */
export const FRAME_SEC = 1 / 30

/** Хвост шкалы под кнопку «+» и отступы. */
export function timelineAddTailPx() {
  return TRACK_ADD_GAP + TRACK_ADD_PX + 12
}

/**
 * Масштаб, чтобы блок (клипы + титры) уместился в видимую ширину reel.
 * В пределах PX_PER_SEC_MIN…MAX.
 */
export function fitTimelinePxPerSec(contentSec: number, viewportPx: number): number {
  const duration = Math.max(0.5, contentSec)
  const usable = Math.max(80, viewportPx - TIMELINE_LABEL_PX - timelineAddTailPx())
  const raw = usable / duration
  return Math.min(PX_PER_SEC_MAX, Math.max(PX_PER_SEC_MIN, Math.round(raw)))
}

export const LIB_SRC_MIME = 'application/x-djinal-lib-src'
export const BACKGROUND_MUSIC_SRC = '/media/music/ambient.mp3'

export function backgroundMusicSrc(projectCode?: string, musicSrc?: string) {
  const fromConfig = musicSrc?.trim()
  if (fromConfig) return fromConfig
  if (projectCode) return `/media/projects/${projectCode}/music/ambient.mp3`
  return BACKGROUND_MUSIC_SRC
}

export function clipLaneWidth(clip: StoryClip, pxPerSec: number) {
  return Math.max(1, clipHoldSec(clip) * pxPerSec)
}

export function cueSnippet(cue: StoryCue) {
  const text = cue.text?.trim()
  if (!text) return 'Новый титр'
  return text.length > 54 ? `${text.slice(0, 54)}…` : text
}

export function cueEndSec(cue: Pick<StoryCue, 'startSec' | 'durationSec'>) {
  return cue.startSec + cue.durationSec
}

export function snapThresholdSec(pxPerSec: number) {
  return 12 / pxPerSec
}

export function uniqueTimes(times: number[]): number[] {
  const out: number[] = []
  for (const t of times) {
    if (!Number.isFinite(t) || t < -0.0005) continue
    const rounded = Number(Math.max(0, t).toFixed(3))
    if (out.every((x) => Math.abs(x - rounded) > 0.0005)) out.push(rounded)
  }
  return out
}

export function cueSnapTimes(cues: StoryCue[], ttsDurations: Record<string, number>): number[] {
  const times: number[] = []
  for (const cue of cues) {
    times.push(cue.startSec)
    times.push(cueEndSec(cue))
    const tts = cue.ttsSrc ? ttsDurations[cue.ttsSrc] : undefined
    if (tts != null && tts > 0) times.push(cue.startSec + tts)
  }
  return uniqueTimes(times)
}

export function snapTime(sec: number, targets: number[], thresholdSec: number): number | null {
  let best: number | null = null
  let bestDist = thresholdSec
  for (const t of targets) {
    const d = Math.abs(sec - t)
    if (d <= bestDist + 1e-9) {
      bestDist = d
      best = t
    }
  }
  return best
}

export function minCueDurationSec(
  cue: Pick<StoryCue, 'ttsSrc' | 'durationSec'>,
  ttsDurations: Record<string, number>,
) {
  const tts = cue.ttsSrc ? ttsDurations[cue.ttsSrc] : undefined
  if (tts != null && tts > 0) return Math.max(0.3, tts)
  return 0.3
}

export function resolveCueOverlaps(cues: StoryCue[], lockedId: string): StoryCue[] {
  const map = new Map(cues.map((c) => [c.id, normalizeCue({ ...c })]))
  const locked = map.get(lockedId)
  if (!locked) return cues.map((c) => map.get(c.id) ?? c)

  const left = [...map.values()]
    .filter((c) => c.id !== lockedId && c.startSec < locked.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
  const right = [...map.values()]
    .filter((c) => c.id !== lockedId && c.startSec >= locked.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))

  let boundary = locked.startSec
  for (let i = left.length - 1; i >= 0; i--) {
    const cur = left[i]!
    if (cueEndSec(cur) > boundary + 0.0005) {
      cur.startSec = Number((boundary - cur.durationSec).toFixed(3))
    }
    boundary = Math.min(boundary, cur.startSec)
  }

  const overflow = Math.max(0, ...left.map((c) => -c.startSec), -locked.startSec)
  if (overflow > 0.0005) {
    for (const cur of left) {
      cur.startSec = Number((cur.startSec + overflow).toFixed(3))
    }
    locked.startSec = Number((locked.startSec + overflow).toFixed(3))
  }

  for (const cur of left) map.set(cur.id, cur)
  map.set(lockedId, locked)

  let rightBoundary = cueEndSec(locked)
  for (const cur of right) {
    if (cur.startSec < rightBoundary - 0.0005) {
      cur.startSec = Number(rightBoundary.toFixed(3))
    }
    map.set(cur.id, cur)
    rightBoundary = cueEndSec(cur)
  }

  return cues.map((c) => map.get(c.id) ?? c)
}

export function packCuesLeftToRight(cues: StoryCue[]): StoryCue[] {
  const sorted = cues
    .map((c) => normalizeCue({ ...c }))
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const cur = sorted[i]!
    const prevEnd = cueEndSec(prev)
    if (prevEnd > cur.startSec + 0.0005) {
      cur.startSec = Number(prevEnd.toFixed(3))
    }
  }
  const byId = new Map(sorted.map((c) => [c.id, c]))
  return cues.map((c) => byId.get(c.id) ?? c)
}

/**
 * Подгоняет durationSec клипов под шкалу cue — иначе после растягивания TTS
 * картинки уезжают вперёд титров и озвучки.
 *
 * 1:1 (клипов столько же, сколько cue) — границы слайдов = границы cue.
 * Иначе — не короче окна cue: последний клип в окне дотягивается до cueEnd.
 */
export function syncClipsToCues(clips: StoryClip[], cues: StoryCue[]): StoryClip[] {
  if (!clips.length || !cues.length) return clips
  const sorted = cues
    .map((c) => normalizeCue({ ...c }))
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))

  if (clips.length === sorted.length) {
    return clips.map((clip, i) => {
      const cue = sorted[i]!
      const nextStart = sorted[i + 1]?.startSec
      const dur = Number(
        Math.max(0.8, nextStart != null ? nextStart - cue.startSec : cue.durationSec).toFixed(3),
      )
      if (Math.abs(clipHoldSec(clip) - dur) <= 0.05) return clip
      return { ...clip, durationSec: dur, animSec: dur }
    })
  }

  const next = clips.map((c) => ({ ...c }))
  for (const cue of sorted) {
    let t = 0
    let host = -1
    const starts: number[] = []
    for (let i = 0; i < next.length; i++) {
      starts.push(t)
      const hold = clipHoldSec(next[i]!)
      if (host < 0 && cue.startSec >= t - 0.05 && cue.startSec < t + hold + 0.05) host = i
      t += hold
    }
    if (host < 0) continue
    const cueEnd = cueEndSec(cue)
    let last = host
    for (let i = host; i < next.length; i++) {
      if ((starts[i] ?? 0) < cueEnd - 0.05) last = i
      else break
    }
    let coverEnd = starts[host] ?? 0
    for (let i = host; i <= last; i++) coverEnd += clipHoldSec(next[i]!)
    if (coverEnd >= cueEnd - 0.05) continue
    const add = cueEnd - coverEnd
    const hold = clipHoldSec(next[last]!)
    const dur = Number((hold + add).toFixed(3))
    next[last] = { ...next[last]!, durationSec: dur, animSec: dur }
  }
  return next
}

export function clipAtTime(clips: StoryClip[], timeSec: number): StoryClip | null {
  let cursor = 0
  for (const clip of clips) {
    const end = cursor + clipHoldSec(clip)
    if (timeSec >= cursor && timeSec < end) return clip
    cursor = end
  }
  return clips[clips.length - 1] ?? null
}

export function sliderNumber(value: number | readonly number[]) {
  return Array.isArray(value) ? (value[0] ?? 0) : value
}

export function isTypingTarget(target: EventTarget | null) {
  const t = target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

export function isModKey(e: KeyboardEvent) {
  return e.metaKey || e.ctrlKey
}

/** Physical key with Cmd/Ctrl — works on Russian (and other) layouts where e.key is not latin. */
export function isModCode(e: KeyboardEvent, code: string) {
  return isModKey(e) && e.code === code
}

export function ttsFileLabel(src: string) {
  return src
    .replace(/^\/media\/projects\/[^/]+\/tts\//, '')
    .replace(/^\/media\/tts\//, '')
}

export function isLibraryDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types).includes(LIB_SRC_MIME)
}

export function readLibrarySrc(dt: DataTransfer): string | null {
  const fromMime = dt.getData(LIB_SRC_MIME)
  if (fromMime) return fromMime
  const plain = dt.getData('text/plain')
  if (plain.startsWith('lib:')) return plain.slice(4)
  return null
}

export function mediaFileName(src: string) {
  const name = src.split('/').pop() ?? src
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback below */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.width = '1px'
    ta.style.height = '1px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export type ClipResizeEdge = 'start' | 'end'

export function clipResizeFromDelta(input: {
  clip: StoryClip
  edge: ClipResizeEdge
  deltaSec: number
  clipStartSec: number
  snapTargets: number[]
  threshold: number
  holdSnap: number | null
}): {
  patch: Partial<StoryClip>
  snapGuideSec: number | null
  holdSnap: number | null
} {
  const originDuration = input.clip.durationSec
  const originTrimStart = Math.max(0, input.clip.trimStartSec ?? 0)
  const isVideoClip = clipMediaKind(input.clip) === 'video' || isVideoSrc(input.clip.src)
  const sourceDuration =
    isVideoClip && input.clip.sourceDurationSec
      ? input.clip.sourceDurationSec
      : Number.POSITIVE_INFINITY

  if (input.edge === 'start' && isVideoClip) {
    const sourceEnd = originTrimStart + originDuration
    const trimStartSec = Math.min(
      sourceEnd - 0.8,
      Math.max(0, originTrimStart + input.deltaSec),
    )
    const durationSec = Math.max(0.8, Number((sourceEnd - trimStartSec).toFixed(3)))
    return {
      patch: {
        trimStartSec: Number(trimStartSec.toFixed(3)),
        durationSec,
        animSec: durationSec,
      },
      snapGuideSec: null,
      holdSnap: null,
    }
  }

  const rawDuration = Math.max(0.8, originDuration + input.deltaSec)
  const rawEnd = input.clipStartSec + rawDuration
  const stay =
    input.holdSnap != null && Math.abs(rawEnd - input.holdSnap) <= input.threshold * 1.65
  const snappedEnd = stay ? input.holdSnap : snapTime(rawEnd, input.snapTargets, input.threshold)
  const durationSec = Math.min(
    Math.max(0.8, sourceDuration - originTrimStart),
    Math.max(0.8, Number(((snappedEnd ?? rawEnd) - input.clipStartSec).toFixed(3))),
  )
  return {
    patch: { durationSec, animSec: durationSec },
    snapGuideSec: snappedEnd,
    holdSnap: snappedEnd,
  }
}

export function cueDragFromDelta(input: {
  originCues: StoryCue[]
  cueId: string
  mode: 'move' | 'resize'
  deltaSec: number
  originStart: number
  originDuration: number
  minDur: number
}): StoryCue[] {
  if (input.mode === 'move') {
    const startSec = Math.max(0, Number((input.originStart + input.deltaSec).toFixed(3)))
    return resolveCueOverlaps(
      input.originCues.map((c) =>
        c.id === input.cueId
          ? normalizeCue({ ...c, startSec, durationSec: input.originDuration })
          : c,
      ),
      input.cueId,
    )
  }
  const durationSec = Math.max(input.minDur, Number((input.originDuration + input.deltaSec).toFixed(3)))
  return resolveCueOverlaps(
    input.originCues.map((c) =>
      c.id === input.cueId
        ? normalizeCue({ ...c, startSec: input.originStart, durationSec })
        : c,
    ),
    input.cueId,
  )
}
