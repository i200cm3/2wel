import { probeProjectLinkCallRecordings, type CallRecordingProbeResult, type LinkRawSource } from '@/lib/api'
import {
  availabilityFromProbeResult,
  isAmoCallSourceRef,
  recordingAvailabilityFromMeta,
  recordingUrlFromSource,
  type RecordingAvailability,
} from '@/cabinet/linkRawSourceKinds'

export type { RecordingAvailability } from '@/cabinet/linkRawSourceKinds'
export {
  availabilityFromProbeResult,
  isDefinitiveRecordingUnavailable,
  recordingAvailabilityFromMeta,
  recordingAvailabilityFromSources,
  sourceRecordingAvailability,
} from '@/cabinet/linkRawSourceKinds'

export const RECORDING_PROBE_BATCH_SIZE = 8

export function amoCallRecordingProbeTargets(sources: LinkRawSource[]) {
  return sources.filter((source) => {
    if (!isAmoCallSourceRef(source.externalRef)) return false
    if (source.meta?.nonTarget === true) return false
    return Boolean(recordingUrlFromSource(source))
  })
}

export function callNeedsRecordingProbe(source: LinkRawSource) {
  if (!isAmoCallSourceRef(source.externalRef)) return false
  if (source.meta?.nonTarget === true) return false
  if (!recordingUrlFromSource(source)) return false
  return !source.meta?.recordingProbedAt
}

export type RecordingProbeResult = RecordingAvailability | null

type RunRecordingProbeOptions = {
  projectCode: string
  publicId: string
  targets: LinkRawSource[]
  onProgress: (checked: number, total: number) => void
  onResult: (sourceId: string, availability: RecordingProbeResult, probe?: CallRecordingProbeResult) => void
  shouldCancel: () => boolean
}

export async function runRecordingProbe({
  projectCode,
  publicId,
  targets,
  onProgress,
  onResult,
  shouldCancel,
}: RunRecordingProbeOptions) {
  const total = targets.length
  if (!total) return { checked: 0, cancelled: false, unavailable: 0 }

  onProgress(0, total)
  for (const source of targets) {
    if (recordingAvailabilityFromMeta(source) === 'unavailable') continue
    onResult(source.id, 'pending')
  }

  let checked = 0
  let unavailable = 0

  for (let i = 0; i < targets.length; i += RECORDING_PROBE_BATCH_SIZE) {
    if (shouldCancel()) break

    const batch = targets.slice(i, i + RECORDING_PROBE_BATCH_SIZE)
    const items = batch
      .map((source) => {
        const url = recordingUrlFromSource(source)
        return url ? { sourceId: source.id, url } : null
      })
      .filter(Boolean) as Array<{ sourceId: string; url: string }>
    const data = await probeProjectLinkCallRecordings(projectCode, publicId, { items })
    const byUrl = new Map(data.results.map((item) => [item.url, item]))

    for (const source of batch) {
      const url = recordingUrlFromSource(source)
      const probe = url ? byUrl.get(url) : undefined
      if (!probe) {
        onResult(source.id, null)
        continue
      }
      const availability = availabilityFromProbeResult(probe)
      onResult(source.id, availability, probe)
      if (availability === 'unavailable') unavailable += 1
    }

    checked += batch.length
    onProgress(checked, total)
  }

  return { checked, cancelled: shouldCancel(), unavailable }
}
