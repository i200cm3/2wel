import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { publicDir } from './env.js'
import { rewriteConfigMedia } from './projectMedia.mjs'
import { trialPresentationConfig } from './starter.mjs'

const STARTER_DIR = path.join(publicDir(), 'media/starter')

describe('trialPresentationConfig', () => {
  const config = trialPresentationConfig({ id: 'demo1' })

  it('даёт две дорожки автопоказа и четыре меню', () => {
    assert.deepEqual(config.flow, ['intro', 'greeting'])
    assert.equal(config.branches.length, 4)
    assert.deepEqual(
      config.branches.map((b) => b.id),
      ['rooms', 'restaurant', 'spa', 'lake'],
    )
  })

  it('у каждой последовательности есть кадры и титры', () => {
    for (const id of [...config.flow, ...config.branches.map((b) => b.sequenceId)]) {
      const seq = config.sequences[id]
      assert.ok(seq, `нет последовательности ${id}`)
      assert.ok(seq.clips.length >= 1, `${id}: мало кадров`)
      if (id !== 'intro') {
        assert.ok(seq.cues?.length >= 1, `${id}: нет титров`)
        assert.ok(seq.endButtons?.length >= 1, `${id}: нет кнопок в конце`)
      }
    }
  })

  it('все кадры ссылаются на существующие вертикальные файлы', () => {
    const srcs = Object.values(config.sequences).flatMap((seq) => seq.clips.map((clip) => clip.src))
    assert.ok(srcs.length >= 16)
    for (const src of srcs) {
      assert.match(src, /^\/media\/starter\/[\w.-]+\.jpg$/)
      const file = path.join(STARTER_DIR, path.basename(src))
      assert.ok(fs.existsSync(file), `нет файла ${file}`)
    }
  })

  it('титры с озвучкой ссылаются на файлы starter TTS', () => {
    const withTts = Object.values(config.sequences).flatMap((seq) =>
      (seq.cues ?? []).filter((cue) => cue.ttsSrc),
    )
    assert.ok(withTts.length >= 10)
    for (const cue of withTts) {
      assert.match(cue.ttsSrc, /^\/media\/tts\/starter\/el_[a-f0-9]+\.mp3$/)
      const file = path.join(publicDir(), cue.ttsSrc.replace(/^\//, ''))
      assert.ok(fs.existsSync(file), `нет файла ${file}`)
      assert.ok(cue.ttsText, `${cue.id}: нет ttsText`)
      assert.ok(cue.ttsHash, `${cue.id}: нет ttsHash`)
    }
  })

  it('rewrite переносит кадры и озвучку в проект', () => {
    const next = rewriteConfigMedia(config, 'abc12xyz')
    const src = next.sequences.intro.clips[0].src
    assert.equal(src, '/media/projects/abc12xyz/library/gallery/intro-01.jpg')
    assert.equal(next.musicSrc, '/media/projects/abc12xyz/music/ambient.mp3')
    const tts = next.sequences.greeting.cues[0].ttsSrc
    assert.equal(tts, '/media/projects/abc12xyz/tts/el_790e15111f82.mp3')
  })

  it('rewrite переносит legacy-медиа Джинала в папку проекта', () => {
    const next = rewriteConfigMedia(
      {
        ...config,
        musicSrc: '/media/music/ambient.mp3',
        sequences: {
          intro: {
            id: 'intro',
            label: 'Intro',
            clips: [
              { id: 'legacy-library', src: '/media/library/gallery/cover.jpg' },
              { id: 'legacy-folder', src: '/media/about/04.jpg' },
            ],
            cues: [{ id: 'cue', ttsSrc: '/media/tts/menu.mp3' }],
          },
        },
      },
      'djinal',
    )

    assert.equal(next.sequences.intro.clips[0].src, '/media/projects/djinal/library/gallery/cover.jpg')
    assert.equal(next.sequences.intro.clips[1].src, '/media/projects/djinal/library/gallery/about/04.jpg')
    assert.equal(next.sequences.intro.cues[0].ttsSrc, '/media/projects/djinal/tts/menu.mp3')
    assert.equal(next.musicSrc, '/media/projects/djinal/music/ambient.mp3')
  })
})
