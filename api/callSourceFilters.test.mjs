import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  callDurationSecFromSource,
  isAlreadyTranscribed,
  isShortNonTargetCall,
  selectCallsForPresentationPipeline,
} from './callSourceFilters.mjs'

describe('call duration filters', () => {
  it('parses duration from title and meta', () => {
    assert.equal(callDurationSecFromSource({ title: 'Входящий · 0:25 · +7' }), 25)
    assert.equal(callDurationSecFromSource({ title: 'Входящий · 1:05' }), 65)
    assert.equal(
      callDurationSecFromSource({ title: 'Входящий', meta: { durationSec: 42 } }),
      42,
    )
  })

  it('marks calls under 30s as non-target', () => {
    assert.equal(isShortNonTargetCall({ title: 'Входящий · 0:29' }), true)
    assert.equal(isShortNonTargetCall({ title: 'Входящий · 0:30' }), false)
    assert.equal(isShortNonTargetCall({ title: 'Входящий · 1:00' }), false)
  })
})

describe('selectCallsForPresentationPipeline', () => {
  it('keeps available calls >= 30s and skips short / unavailable', () => {
    const { eligible, skipped } = selectCallsForPresentationPipeline([
      {
        id: 'short',
        title: 'Входящий · 0:20',
        body: 'https://rec.example/a.mp3',
        meta: { durationSec: 20 },
      },
      {
        id: 'ok',
        title: 'Исходящий · 1:10',
        body: 'https://rec.example/b.mp3',
        meta: { durationSec: 70, recordingAvailable: true },
      },
      {
        id: 'dead',
        title: 'Входящий · 2:00',
        body: 'https://rec.example/c.mp3',
        meta: { durationSec: 120, recordingAvailable: false },
      },
      {
        id: 'done',
        title: 'Входящий · 0:45',
        body: 'Клиент: хочу номер на двоих, с 19 сентября',
        meta: { durationSec: 45, transcribedAt: '2026-09-02T12:00:00Z', recordingUrl: 'https://rec.example/d.mp3' },
      },
      {
        id: 'manual-skip',
        title: 'Входящий · 2:00',
        body: 'https://rec.example/e.mp3',
        meta: { durationSec: 120, recordingAvailable: true, nonTarget: true },
      },
    ])

    assert.deepEqual(
      eligible.map((item) => item.source.id),
      ['ok', 'done'],
    )
    assert.equal(eligible.find((item) => item.source.id === 'ok')?.needsTranscribe, true)
    assert.equal(eligible.find((item) => item.source.id === 'done')?.needsTranscribe, false)
    assert.ok(skipped.some((item) => item.id === 'short' && item.reason === 'short_call'))
    assert.ok(skipped.some((item) => item.id === 'dead' && item.reason === 'recording_unavailable'))
    assert.ok(skipped.some((item) => item.id === 'manual-skip' && item.reason === 'non_target'))
  })

  it('detects already transcribed bodies', () => {
    assert.equal(
      isAlreadyTranscribed({
        body: 'Длинный текст транскрипта звонка про санаторий и даты заезда',
        meta: { transcribedAt: '2026-09-02T12:00:00Z' },
      }),
      true,
    )
    assert.equal(isAlreadyTranscribed({ body: 'https://rec.example/x.mp3' }), false)
  })
})
