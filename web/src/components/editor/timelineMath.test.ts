import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clipResizeFromDelta,
  fitTimelinePxPerSec,
  PX_PER_SEC_DEFAULT,
  PX_PER_SEC_MAX,
  PX_PER_SEC_MIN,
  syncClipsToCues,
} from './timelineMath.ts'
import { normalizeClip, normalizeCue, type StoryClip, type StoryCue } from '../../types/story.ts'

function video(patch: Partial<StoryClip> = {}): StoryClip {
  return normalizeClip({
    id: 'v1',
    src: '/media/a.mp4',
    media: 'video',
    motion: 'none',
    durationSec: 10,
    sourceDurationSec: 20,
    trimStartSec: 2,
    from: { x: 0.5, y: 0.5, scale: 1 },
    to: { x: 0.5, y: 0.5, scale: 1 },
    easing: 'ease-in-out',
    ...patch,
  })
}

function img(id: string, durationSec: number): StoryClip {
  return normalizeClip({
    id,
    src: `/media/${id}.jpg`,
    media: 'image',
    motion: 'none',
    durationSec,
    from: { x: 0.5, y: 0.5, scale: 1 },
    to: { x: 0.5, y: 0.5, scale: 1 },
    easing: 'ease-in-out',
  })
}

function cue(id: string, startSec: number, durationSec: number): StoryCue {
  return normalizeCue({ id, startSec, durationSec, text: id })
}

describe('clipResizeFromDelta · trim видео', () => {
  it('левый край двигает in-point и укорачивает слайд', () => {
    const clip = video()
    const out = clipResizeFromDelta({
      clip,
      edge: 'start',
      deltaSec: 3,
      clipStartSec: 0,
      snapTargets: [],
      threshold: 0.2,
      holdSnap: null,
    })
    assert.equal(out.patch.trimStartSec, 5)
    assert.equal(out.patch.durationSec, 7)
    assert.equal(out.snapGuideSec, null)
  })

  it('левый край не уходит ниже 0', () => {
    const clip = video({ trimStartSec: 1, durationSec: 8 })
    const out = clipResizeFromDelta({
      clip,
      edge: 'start',
      deltaSec: -5,
      clipStartSec: 0,
      snapTargets: [],
      threshold: 0.2,
      holdSnap: null,
    })
    assert.equal(out.patch.trimStartSec, 0)
    assert.equal(out.patch.durationSec, 9)
  })

  it('правый край не длиннее исходника', () => {
    const clip = video({ trimStartSec: 15, durationSec: 3 })
    const out = clipResizeFromDelta({
      clip,
      edge: 'end',
      deltaSec: 10,
      clipStartSec: 0,
      snapTargets: [],
      threshold: 0.2,
      holdSnap: null,
    })
    assert.equal(out.patch.durationSec, 5)
  })
})

describe('syncClipsToCues', () => {
  it('1:1 — растягивает клипы под упакованные cue после TTS', () => {
    const clips = [img('a', 4.2), img('b', 4), img('c', 4.1)]
    const cues = [cue('c1', 0, 5.44), cue('c2', 5.44, 4), cue('c3', 9.44, 4.1)]
    const out = syncClipsToCues(clips, cues)
    assert.equal(out[0]!.durationSec, 5.44)
    assert.equal(out[1]!.durationSec, 4)
    assert.equal(out[2]!.durationSec, 4.1)
  })

  it('монтаж (больше клипов, чем cue) — не ломает уже закрытое окно', () => {
    const clips = [img('a', 3.08), img('b', 3.19), img('c', 3.81)]
    const cues = [cue('c1', 0, 3.08), cue('c2', 3.08, 7)]
    const out = syncClipsToCues(clips, cues)
    assert.equal(out[0]!.durationSec, 3.08)
    assert.equal(out[1]!.durationSec, 3.19)
    assert.equal(out[2]!.durationSec, 3.81)
  })
})

describe('fitTimelinePxPerSec', () => {
  it('zooms in for a short block within max', () => {
    const px = fitTimelinePxPerSec(4, 800)
    assert.ok(px > PX_PER_SEC_DEFAULT)
    assert.ok(px <= PX_PER_SEC_MAX)
  })

  it('zooms out for a long block within min', () => {
    const px = fitTimelinePxPerSec(120, 400)
    assert.equal(px, PX_PER_SEC_MIN)
  })

  it('clamps to max for tiny content', () => {
    const px = fitTimelinePxPerSec(0.5, 2000)
    assert.equal(px, PX_PER_SEC_MAX)
  })
})
