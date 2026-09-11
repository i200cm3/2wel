import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  callDirectionFromTitle,
  callDisplayTitle,
  callDurationSecFromTitle,
  estimateTranscribeLabel,
  estimateTranscribeSec,
  isAmoCallHiddenFromMainList,
  isShortNonTargetCall,
  recordingAvailabilityFromMeta,
  recordingAvailabilityFromSources,
  availabilityFromProbeResult,
  sourceRecordingAvailability,
} from './linkRawSourceKinds.ts'

describe('callDirectionFromTitle', () => {
  it('распознаёт входящий и исходящий в title amo', () => {
    assert.equal(callDirectionFromTitle('Входящий · 2:05 · +79001234567'), 'in')
    assert.equal(callDirectionFromTitle('Исходящий · 1:00 · +7999'), 'out')
  })

  it('не путает направления без word boundary на кириллице', () => {
    assert.equal(callDirectionFromTitle('исходящий звонок'), 'out')
    assert.equal(callDirectionFromTitle('входящий'), 'in')
  })

  it('возвращает null без маркера направления', () => {
    assert.equal(callDirectionFromTitle('Звонок'), null)
    assert.equal(callDirectionFromTitle(''), null)
  })
})

describe('callDisplayTitle', () => {
  it('убирает префикс направления', () => {
    assert.equal(callDisplayTitle('Входящий · 2:05 · +7900'), '2:05 · +7900')
    assert.equal(callDisplayTitle('Исходящий · 1:00'), '1:00')
  })
})

describe('callDurationSecFromTitle', () => {
  it('парсит длительность из title amo', () => {
    assert.equal(callDurationSecFromTitle('Входящий · 2:05 · +7900'), 125)
    assert.equal(callDurationSecFromTitle('Исходящий · 12:30'), 750)
  })

  it('возвращает null без длительности', () => {
    assert.equal(callDurationSecFromTitle('Входящий · +7900'), null)
    assert.equal(callDurationSecFromTitle('Звонок'), null)
  })
})

describe('isShortNonTargetCall / isAmoCallHiddenFromMainList', () => {
  it('скрывает звонки короче 30 секунд', () => {
    assert.equal(isShortNonTargetCall({ title: 'Входящий · 0:29' }), true)
    assert.equal(isShortNonTargetCall({ title: 'Исходящий', meta: { durationSec: 12 } }), true)
    assert.equal(isShortNonTargetCall({ title: 'Входящий · 0:30' }), false)
    assert.equal(isShortNonTargetCall({ title: 'Входящий · +7900' }), false)
  })

  it('прячет короткие, вручную нецелевые и недоступные из основного списка', () => {
    const shortOk = {
      id: 'short',
      title: 'Входящий · 0:12',
      meta: { recordingAvailable: true, recordingProbedAt: '2026-01-01T00:00:00.000Z' },
    }
    const longOk = {
      id: 'long',
      title: 'Входящий · 1:05',
      meta: { recordingAvailable: true, recordingProbedAt: '2026-01-01T00:00:00.000Z' },
    }
    const longDown = {
      id: 'down',
      title: 'Входящий · 2:00',
      meta: { recordingAvailable: false, recordingProbedAt: '2026-01-01T00:00:00.000Z' },
    }
    const manualSkip = {
      id: 'skip',
      title: 'Входящий · 2:00',
      meta: {
        recordingAvailable: true,
        recordingProbedAt: '2026-01-01T00:00:00.000Z',
        nonTarget: true,
      },
    }
    const live = recordingAvailabilityFromSources([shortOk, longOk, longDown, manualSkip])
    assert.equal(isAmoCallHiddenFromMainList(shortOk, live), true)
    assert.equal(isAmoCallHiddenFromMainList(longOk, live), false)
    assert.equal(isAmoCallHiddenFromMainList(longDown, live), true)
    assert.equal(isAmoCallHiddenFromMainList(manualSkip, live), true)
  })
})

describe('estimateTranscribeSec', () => {
  it('оценивает время по длительности записи', () => {
    assert.equal(estimateTranscribeSec(125), 18)
    assert.equal(estimateTranscribeSec(40), 12)
    assert.equal(estimateTranscribeSec(null), null)
    assert.equal(estimateTranscribeLabel(125), '≈ 18 сек')
  })
})

describe('availabilityFromProbeResult', () => {
  it('скрывает недоступные записи, включая таймаут ссылки', () => {
    assert.equal(availabilityFromProbeResult({ ok: false, reason: 'not-a-recording' }), 'unavailable')
    assert.equal(availabilityFromProbeResult({ ok: false, reason: 'timeout' }), 'unavailable')
    assert.equal(availabilityFromProbeResult({ ok: false, reason: 'network-error' }), null)
    assert.equal(availabilityFromProbeResult({ ok: true }), 'available')
  })
})

describe('recordingAvailabilityFromMeta', () => {
  it('читает сохранённую доступность записи', () => {
    assert.equal(
      recordingAvailabilityFromMeta({
        meta: { recordingAvailable: true, recordingProbedAt: '2026-01-01T00:00:00.000Z' },
      }),
      'available',
    )
    assert.equal(
      recordingAvailabilityFromMeta({
        meta: { recordingAvailable: false, recordingProbedAt: '2026-01-01T00:00:00.000Z' },
      }),
      'unavailable',
    )
    assert.equal(
      recordingAvailabilityFromMeta({
        meta: { recordingProbedAt: '2026-01-01T00:00:00.000Z', recordingProbeReason: 'timeout' },
      }),
      'unavailable',
    )
    assert.equal(recordingAvailabilityFromMeta({ meta: null }), undefined)
  })
})

describe('sourceRecordingAvailability', () => {
  it('не показывает скрытый звонок из‑за pending перепроверки', () => {
    const source = {
      id: 'call-1',
      meta: { recordingAvailable: false, recordingProbedAt: '2026-01-01T00:00:00.000Z' },
    }
    assert.equal(sourceRecordingAvailability(source, { 'call-1': 'pending' }), 'unavailable')
    assert.equal(sourceRecordingAvailability(source, {}), 'unavailable')
  })

  it('скрывает и licensed-ошибки, и зависшие ссылки после probe', () => {
    const sources = [
      { id: 'ok', meta: { recordingAvailable: true, recordingProbedAt: '2026-01-01T00:00:00.000Z' } },
      { id: 'licensed', meta: { recordingAvailable: false, recordingProbedAt: '2026-01-01T00:00:00.000Z' } },
      { id: 'hang', meta: { recordingProbedAt: '2026-01-01T00:00:00.000Z', recordingProbeReason: 'timeout' } },
      { id: 'fresh', meta: null },
    ]
    const live = recordingAvailabilityFromSources(sources)
    const visible = sources.filter((source) => sourceRecordingAvailability(source, live) !== 'unavailable')
    assert.deepEqual(
      visible.map((source) => source.id),
      ['ok', 'fresh'],
    )
  })
})
