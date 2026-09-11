import type { LinkRawSourceMeta } from '@/lib/api'

export const RAW_KIND_LABELS: Record<string, string> = {
  chat: 'Чат',
  call_transcript: 'Звонок',
  note: 'Заметка',
  manual: 'Вручную',
  amo_export: 'Amo export',
}

export const AMO_NOTE_REF_PREFIX = 'amo:note:'

export const RAW_KIND_OPTIONS = Object.entries(RAW_KIND_LABELS)

export function rawSourceTitle(kind: string) {
  return RAW_KIND_LABELS[kind] ?? kind
}

export function isAmoCallSourceRef(ref: string | null | undefined) {
  return String(ref ?? '').startsWith(AMO_NOTE_REF_PREFIX)
}

export function isRecordingUrl(text: string) {
  return /^https?:\/\//i.test(text.trim())
}


export function recordingUrlFromSource(source: { body: string; meta?: LinkRawSourceMeta | null }) {
  if (isRecordingUrl(source.body)) return source.body.trim()
  const fromMeta = String(source.meta?.recordingUrl ?? '').trim()
  if (isRecordingUrl(fromMeta)) return fromMeta
  return null
}

export function transcribeModelFromSource(source: { meta?: LinkRawSourceMeta | null }) {
  return String(source.meta?.transcribeModel ?? '').trim() || null
}

const DURATION_IN_TITLE_RE = /^\d+:\d{2}$/

export function callDurationSecFromTitle(title: string): number | null {
  for (const part of title.split('·').map((item) => item.trim())) {
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

export function callDurationSecFromSource(source: { title: string; meta?: LinkRawSourceMeta | null }) {
  const fromMeta = Number(source.meta?.durationSec)
  if (Number.isFinite(fromMeta) && fromMeta > 0) return Math.floor(fromMeta)
  return callDurationSecFromTitle(source.title)
}

/** Короче 30 секунд — нецелевой, в основном списке не показываем. */
export const NON_TARGET_CALL_MAX_SEC = 30

export function isShortNonTargetCall(source: { title: string; meta?: LinkRawSourceMeta | null }) {
  const sec = callDurationSecFromSource(source)
  return sec != null && sec < NON_TARGET_CALL_MAX_SEC
}

/** Вручную помечен как нецелевой — не в анализе и транскрибации. */
export function isManualNonTargetSource(source: { meta?: LinkRawSourceMeta | null }) {
  return source.meta?.nonTarget === true
}

export function isNonTargetCall(source: { title: string; meta?: LinkRawSourceMeta | null }) {
  return isManualNonTargetSource(source) || isShortNonTargetCall(source)
}

/** Грубая оценка: скачивание записи + GigaAM CPU (~8 с + 8% длительности). */
export function estimateTranscribeSec(audioDurationSec: number | null): number | null {
  if (audioDurationSec == null || audioDurationSec <= 0) return null
  return Math.max(12, Math.ceil(8 + audioDurationSec * 0.08))
}

export function formatApproxDuration(sec: number): string {
  if (sec < 60) return `≈ ${sec} сек`
  const mins = Math.floor(sec / 60)
  const rem = sec % 60
  if (rem === 0) return `≈ ${mins} мин`
  return `≈ ${mins} мин ${rem} сек`
}

export function estimateTranscribeLabel(audioDurationSec: number | null): string | null {
  const estimateSec = estimateTranscribeSec(audioDurationSec)
  return estimateSec == null ? null : formatApproxDuration(estimateSec)
}

export type RecordingAvailability = 'pending' | 'available' | 'unavailable'

export function recordingAvailabilityFromMeta(
  source: { meta?: LinkRawSourceMeta | null },
): RecordingAvailability | undefined {
  const probedAt = String(source.meta?.recordingProbedAt ?? '').trim()
  if (!probedAt) return undefined
  if (source.meta?.recordingAvailable === true) return 'available'
  return 'unavailable'
}

export function recordingAvailabilityFromSources(
  sources: { id: string; meta?: LinkRawSourceMeta | null }[],
) {
  const out: Record<string, RecordingAvailability> = {}
  for (const source of sources) {
    const availability = recordingAvailabilityFromMeta(source)
    if (availability) out[source.id] = availability
  }
  return out
}

export function sourceRecordingAvailability(
  source: { id: string; meta?: LinkRawSourceMeta | null },
  live: Record<string, RecordingAvailability>,
): RecordingAvailability | undefined {
  const fromLive = live[source.id]
  const fromMeta = recordingAvailabilityFromMeta(source)
  if (fromLive === 'available' || fromLive === 'unavailable') return fromLive
  if (fromMeta) return fromMeta
  return fromLive
}

export function isAmoCallHiddenFromMainList(
  source: { id: string; title: string; meta?: LinkRawSourceMeta | null },
  live: Record<string, RecordingAvailability>,
) {
  if (isManualNonTargetSource(source)) return true
  if (isShortNonTargetCall(source)) return true
  return sourceRecordingAvailability(source, live) === 'unavailable'
}

export function isDefinitiveRecordingUnavailable(reason: string | null | undefined) {
  return availabilityFromProbeResult({ ok: false, reason }) === 'unavailable'
}

const TRANSIENT_PROBE_REASONS = new Set(['network-error'])

export function availabilityFromProbeResult(probe: { ok: boolean; reason?: string | null; status?: number }) {
  if (probe.ok) return 'available' as const
  const reason = String(probe.reason ?? '').trim()
  if (TRANSIENT_PROBE_REASONS.has(reason)) return null
  if (!reason && probe.status === 0) return null
  return 'unavailable' as const
}

export type CallDirection = 'in' | 'out'

export function callDirectionFromTitle(title: string): CallDirection | null {
  const trimmed = title.trim()
  // \b в JS не работает с кириллицей — только латиница/цифры/_
  if (/Входящ/i.test(trimmed)) return 'in'
  if (/Исходящ/i.test(trimmed)) return 'out'
  return null
}

export function callDisplayTitle(title: string) {
  const trimmed = title.trim()
  const withoutDirection = trimmed
    .replace(/^Входящий(?:\s·\s|\s|$)/i, '')
    .replace(/^Исходящий(?:\s·\s|\s|$)/i, '')
    .trim()
  return withoutDirection || trimmed || 'Звонок'
}
