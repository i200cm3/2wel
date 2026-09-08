import {
  clipHoldSec,
  clipMediaKind,
  clipStartTimes,
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

export function clipBoundaryTimes(clips: StoryClip[]): number[] {
  const times: number[] = [0]
  let t = 0
  for (const clip of clips) {
    t += clipHoldSec(clip)
    times.push(Number(t.toFixed(3)))
  }
  return uniqueTimes(times)
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

export const DEFAULT_LIBRARY_IMAGE_SEC = 2.5
export const DEFAULT_LIBRARY_VIDEO_SEC = 5

export function defaultLibraryClipDuration(src: string) {
  return isVideoSrc(src) ? DEFAULT_LIBRARY_VIDEO_SEC : DEFAULT_LIBRARY_IMAGE_SEC
}

export function clipIndexAtTime(clips: StoryClip[], timeSec: number): number {
  let cursor = 0
  for (let i = 0; i < clips.length; i++) {
    const end = cursor + clipHoldSec(clips[i]!)
    if (timeSec + 1e-9 < end) return i
    cursor = end
  }
  return clips.length
}

/**
 * Куда поставить титр при вставке клипа в зазор: остаётся на своём хозяине
 * и уезжает вместе с ним. Если startSec уже не на хозяине — возвращаем к началу клипа.
 */
export function cueVisualStartSec(
  clips: StoryClip[],
  cues: StoryCue[],
  cue: StoryCue,
  cueIndex: number,
  insertIndex: number | null,
  insertDurSec: number,
): number {
  const shift = insertIndex != null && insertDurSec > 0 ? insertDurSec : 0
  if (insertIndex == null || !shift) return cue.startSec

  const starts = clipStartTimes(clips)
  if (cues.length === clips.length && clips[cueIndex]) {
    const start = starts[cueIndex] ?? 0
    const hold = clipHoldSec(clips[cueIndex]!)
    const within = cue.startSec + 1e-9 >= start && cue.startSec < start + hold + 1e-9
    const base = within ? cue.startSec : start
    return cueIndex >= insertIndex ? base + shift : cue.startSec
  }

  const owner = clipIndexAtTime(clips, cue.startSec)
  return owner >= insertIndex ? cue.startSec + shift : cue.startSec
}

export function shiftCuesForClipInsert(
  clips: StoryClip[],
  cues: StoryCue[],
  insertIndex: number,
  deltaSec: number,
): StoryCue[] {
  if (!cues.length || !deltaSec) return cues
  return cues.map((cue, i) => {
    const next = cueVisualStartSec(clips, cues, cue, i, insertIndex, deltaSec)
    if (Math.abs(next - cue.startSec) < 1e-9) return cue
    return { ...cue, startSec: Number(next.toFixed(3)) }
  })
}

export function shiftCuesFromTime(cues: StoryCue[], fromSec: number, deltaSec: number): StoryCue[] {
  if (!cues.length || !deltaSec) return cues
  const from = fromSec - 1e-9
  return cues.map((cue) =>
    cue.startSec >= from
      ? { ...cue, startSec: Number(Math.max(0, cue.startSec + deltaSec).toFixed(3)) }
      : cue,
  )
}

export type LibraryTimelineDrop =
  | { kind: 'insert'; index: number }
  | { kind: 'replace'; clipId: string }

/** Куда вставить кадр из медиатеки: края клипа — щель, середина — замена. */
export function libraryDropAtX(input: {
  x: number
  clips: StoryClip[]
  pxPerSec: number
  insertIndex: number | null
  insertDurSec: number
}): LibraryTimelineDrop {
  const { clips, pxPerSec, insertIndex } = input
  const gapPx =
    insertIndex != null && input.insertDurSec > 0
      ? Math.max(1, input.insertDurSec * pxPerSec)
      : 0
  let t = 0
  for (let i = 0; i < clips.length; i++) {
    if (insertIndex === i && gapPx) {
      if (input.x < t + gapPx) return { kind: 'insert', index: i }
      t += gapPx
    }
    const clip = clips[i]!
    const w = Math.max(1, clipHoldSec(clip) * pxPerSec)
    const edge = Math.min(Math.max(16, w * 0.22), w * 0.42)
    if (input.x < t + edge) return { kind: 'insert', index: i }
    if (input.x < t + w - edge) return { kind: 'replace', clipId: clip.id }
    if (input.x < t + w) return { kind: 'insert', index: i + 1 }
    t += w
  }
  return { kind: 'insert', index: clips.length }
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

export type CueDragMode = 'move' | 'resize-start' | 'resize-end'

export type CueDragHoldSnap = { time: number; edge: 'start' | 'end' } | null

const SNAP_HOLD = 1.65

function stickySnap(
  raw: number,
  targets: number[],
  threshold: number,
  hold: CueDragHoldSnap,
  edge: 'start' | 'end',
): { time: number | null; hold: CueDragHoldSnap } {
  const stay =
    hold != null &&
    hold.edge === edge &&
    Math.abs(raw - hold.time) <= threshold * SNAP_HOLD
  const snapped = stay ? hold.time : snapTime(raw, targets, threshold)
  return { time: snapped, hold: snapped != null ? { time: snapped, edge } : null }
}

export function cueDragFromDelta(input: {
  originCues: StoryCue[]
  cueId: string
  mode: CueDragMode
  deltaSec: number
  originStart: number
  originDuration: number
  minDur: number
  snapTargets?: number[]
  threshold?: number
  holdSnap?: CueDragHoldSnap
}): {
  cues: StoryCue[]
  snapGuideSec: number | null
  holdSnap: CueDragHoldSnap
} {
  const targets = input.snapTargets ?? []
  const threshold = input.threshold ?? 0
  const originEnd = input.originStart + input.originDuration
  let startSec = input.originStart
  let durationSec = input.originDuration
  let snapGuideSec: number | null = null
  let holdSnap: CueDragHoldSnap = null

  if (input.mode === 'move') {
    const rawStart = Math.max(0, input.originStart + input.deltaSec)
    const rawEnd = rawStart + input.originDuration
    const startHit = stickySnap(rawStart, targets, threshold, input.holdSnap ?? null, 'start')
    const endHit = stickySnap(rawEnd, targets, threshold, input.holdSnap ?? null, 'end')
    const startDist =
      startHit.time != null ? Math.abs(rawStart - startHit.time) : Number.POSITIVE_INFINITY
    const endDist = endHit.time != null ? Math.abs(rawEnd - endHit.time) : Number.POSITIVE_INFINITY
    if (startHit.time != null && startDist <= endDist) {
      startSec = Math.max(0, startHit.time)
      snapGuideSec = startHit.time
      holdSnap = startHit.hold
    } else if (endHit.time != null) {
      startSec = Math.max(0, endHit.time - input.originDuration)
      snapGuideSec = endHit.time
      holdSnap = endHit.hold
    } else {
      startSec = rawStart
    }
    durationSec = input.originDuration
  } else if (input.mode === 'resize-start') {
    const rawStart = Math.max(0, input.originStart + input.deltaSec)
    const hit = stickySnap(rawStart, targets, threshold, input.holdSnap ?? null, 'start')
    const nextStart = hit.time ?? rawStart
    const maxStart = originEnd - input.minDur
    if (nextStart <= maxStart + 1e-9) {
      startSec = Math.max(0, Number(nextStart.toFixed(3)))
      durationSec = Number((originEnd - startSec).toFixed(3))
      snapGuideSec = hit.time != null && nextStart <= maxStart + 1e-9 ? hit.time : null
      holdSnap = snapGuideSec != null ? hit.hold : null
    } else {
      startSec = Math.max(0, maxStart)
      durationSec = input.minDur
    }
  } else {
    const rawEnd = originEnd + input.deltaSec
    const hit = stickySnap(rawEnd, targets, threshold, input.holdSnap ?? null, 'end')
    const nextEnd = hit.time ?? rawEnd
    const minEnd = input.originStart + input.minDur
    if (nextEnd >= minEnd - 1e-9) {
      durationSec = Math.max(input.minDur, Number((nextEnd - input.originStart).toFixed(3)))
      snapGuideSec = hit.time != null && nextEnd >= minEnd - 1e-9 ? hit.time : null
      holdSnap = snapGuideSec != null ? hit.hold : null
    } else {
      durationSec = input.minDur
    }
    startSec = input.originStart
  }

  startSec = Math.max(0, Number(startSec.toFixed(3)))
  durationSec = Math.max(input.minDur, Number(durationSec.toFixed(3)))
  const cues = resolveCueOverlaps(
    input.originCues.map((c) =>
      c.id === input.cueId ? normalizeCue({ ...c, startSec, durationSec }) : c,
    ),
    input.cueId,
  )
  return { cues, snapGuideSec, holdSnap }
}
