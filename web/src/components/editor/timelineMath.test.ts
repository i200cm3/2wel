import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clipResizeFromDelta,
  clipBoundaryTimes,
  cueDragFromDelta,
  cueVisualStartSec,
  fitTimelinePxPerSec,
  libraryDropAtX,
  PX_PER_SEC_DEFAULT,
  PX_PER_SEC_MAX,
  PX_PER_SEC_MIN,
  shiftCuesForClipInsert,
  shiftCuesFromTime,
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

describe('libraryDropAtX', () => {
  const clips = [img('a', 2), img('b', 2)]
  const pxPerSec = 10

  it('inserts between clips at the shared edge', () => {
    const drop = libraryDropAtX({
      x: 20,
      clips,
      pxPerSec,
      insertIndex: null,
      insertDurSec: 2.5,
    })
    assert.deepEqual(drop, { kind: 'insert', index: 1 })
  })

  it('replaces when hovering the middle of a clip', () => {
    const drop = libraryDropAtX({
      x: 10,
      clips,
      pxPerSec,
      insertIndex: null,
      insertDurSec: 2.5,
    })
    assert.deepEqual(drop, { kind: 'replace', clipId: 'a' })
  })

  it('keeps insert while the pointer is over the preview gap', () => {
    const drop = libraryDropAtX({
      x: 28,
      clips,
      pxPerSec,
      insertIndex: 1,
      insertDurSec: 2.5,
    })
    assert.deepEqual(drop, { kind: 'insert', index: 1 })
  })

  it('appends after the last clip', () => {
    const drop = libraryDropAtX({
      x: 80,
      clips,
      pxPerSec,
      insertIndex: null,
      insertDurSec: 2.5,
    })
    assert.deepEqual(drop, { kind: 'insert', index: 2 })
  })
})

describe('shiftCuesFromTime', () => {
  it('moves titles that start at or after the insert point', () => {
    const cues = [cue('c1', 0, 2), cue('c2', 2, 2), cue('c3', 4, 1)]
    const out = shiftCuesFromTime(cues, 2, 2.5)
    assert.equal(out[0]!.startSec, 0)
    assert.equal(out[1]!.startSec, 4.5)
    assert.equal(out[2]!.startSec, 6.5)
  })
})

describe('shiftCuesForClipInsert', () => {
  it('keeps a 1:1 title on its host clip when inserting a gap before it', () => {
    const clips = [img('a', 2.5), img('b', 2.5)]
    const cues = [cue('c1', 0, 2.5), cue('c2', 2.5, 2.5)]
    const out = shiftCuesForClipInsert(clips, cues, 1, 2.5)
    assert.equal(out[0]!.startSec, 0)
    assert.equal(out[1]!.startSec, 5)
  })

  it('snaps a 1:1 title back onto its host if startSec drifted onto the gap', () => {
    const clips = [img('a', 2.5), img('b', 2.5)]
    const cues = [cue('c1', 0, 2.5), cue('c2', 0, 2.5)]
    const out = shiftCuesForClipInsert(clips, cues, 1, 2.5)
    assert.equal(out[0]!.startSec, 0)
    assert.equal(out[1]!.startSec, 5)
  })

  it('moves an independent title that sits on the displaced clip', () => {
    const clips = [img('a', 3), img('b', 3)]
    const cues = [cue('only', 3.4, 1)]
    const out = shiftCuesForClipInsert(clips, cues, 1, 2.5)
    assert.equal(out[0]!.startSec, 5.9)
  })

  it('does not move a title that belongs to the clip before the gap', () => {
    const clips = [img('a', 3), img('b', 3)]
    const cues = [cue('only', 1, 1)]
    const out = shiftCuesForClipInsert(clips, cues, 1, 2.5)
    assert.equal(out[0]!.startSec, 1)
  })
})

describe('cueVisualStartSec', () => {
  it('previews the host title sliding with the clip, not staying on the gap', () => {
    const clips = [img('a', 2.5), img('b', 2.5)]
    const cues = [cue('c1', 0, 2.5), cue('c2', 2.5, 2.5)]
    assert.equal(cueVisualStartSec(clips, cues, cues[1]!, 1, 1, 2.5), 5)
    assert.equal(cueVisualStartSec(clips, cues, cues[0]!, 0, 1, 2.5), 0)
  })
})

describe('clipBoundaryTimes', () => {
  it('lists start and end of every clip', () => {
    assert.deepEqual(clipBoundaryTimes([img('a', 2.5), img('b', 2)]), [0, 2.5, 4.5])
  })
})

describe('cueDragFromDelta · snap to clips', () => {
  const origin = [cue('c1', 2.5, 2)]
  const targets = [0, 2.5, 5]

  it('sticks the end to the clip boundary above', () => {
    const out = cueDragFromDelta({
      originCues: origin,
      cueId: 'c1',
      mode: 'resize-end',
      deltaSec: 0.4,
      originStart: 2.5,
      originDuration: 2,
      minDur: 0.3,
      snapTargets: targets,
      threshold: 0.2,
    })
    assert.equal(out.cues[0]!.durationSec, 2.5)
    assert.equal(out.snapGuideSec, 5)
  })

  it('sticks the start to the clip boundary above', () => {
    const out = cueDragFromDelta({
      originCues: [cue('c1', 2.7, 2.3)],
      cueId: 'c1',
      mode: 'resize-start',
      deltaSec: -0.15,
      originStart: 2.7,
      originDuration: 2.3,
      minDur: 0.3,
      snapTargets: targets,
      threshold: 0.2,
    })
    assert.equal(out.cues[0]!.startSec, 2.5)
    assert.equal(out.cues[0]!.durationSec, 2.5)
    assert.equal(out.snapGuideSec, 2.5)
  })

  it('holds the snap until pulled further away', () => {
    const held = cueDragFromDelta({
      originCues: origin,
      cueId: 'c1',
      mode: 'resize-end',
      deltaSec: 0.4,
      originStart: 2.5,
      originDuration: 2,
      minDur: 0.3,
      snapTargets: targets,
      threshold: 0.2,
    })
    const still = cueDragFromDelta({
      originCues: origin,
      cueId: 'c1',
      mode: 'resize-end',
      deltaSec: 0.55,
      originStart: 2.5,
      originDuration: 2,
      minDur: 0.3,
      snapTargets: targets,
      threshold: 0.2,
      holdSnap: held.holdSnap,
    })
    assert.equal(still.cues[0]!.durationSec, 2.5)
    assert.equal(still.snapGuideSec, 5)
  })
})
