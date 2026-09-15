import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveUsedMediaFiles } from './templateArchive.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-used-'))
const prevPublicDir = process.env.PUBLIC_DIR

function writeMedia(code, rel, body = 'x') {
  const full = path.join(tmp, 'media', 'projects', code, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
  return `/media/projects/${code}/${rel.replace(/\\/g, '/')}`
}

function withPublicDir(fn) {
  return async () => {
    process.env.PUBLIC_DIR = tmp
    try {
      await fn()
    } finally {
      if (prevPublicDir === undefined) delete process.env.PUBLIC_DIR
      else process.env.PUBLIC_DIR = prevPublicDir
    }
  }
}

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

test(
  'resolveUsedMediaFiles packs only referenced files',
  withPublicDir(() => {
    const code = 'exp-used'
    const keep = writeMedia(code, 'library/gallery/keep.jpg')
    writeMedia(code, 'library/gallery/junk.jpg')
    const tts = writeMedia(code, 'tts/voice.mp3')
    writeMedia(code, 'tts/orphan.mp3')
    const music = writeMedia(code, 'music/ambient.mp3')

    const { files, counts } = resolveUsedMediaFiles(code, {
      musicSrc: music,
      sequences: {
        intro: {
          clips: [{ src: keep }],
          cues: [{ ttsSrc: tts }],
        },
      },
    })

    assert.equal(counts.library, 1)
    assert.equal(counts.music, 1)
    assert.equal(counts.tts, 1)
    assert.equal(counts.missing, 0)
    assert.deepEqual(
      files.map((f) => f.src).sort(),
      [keep, music, tts].sort(),
    )
  }),
)

test(
  'resolveUsedMediaFiles counts missing refs',
  withPublicDir(() => {
    const code = 'exp-miss'
    const { counts } = resolveUsedMediaFiles(code, {
      sequences: {
        intro: { clips: [{ src: `/media/projects/${code}/library/nope.jpg` }] },
      },
    })
    assert.equal(counts.library, 0)
    assert.equal(counts.missing, 1)
  }),
)

test(
  'resolveUsedMediaFiles pulls foreign project refs from disk',
  withPublicDir(() => {
    const code = 'plaza2'
    const foreign = 'adm'
    const local = writeMedia(code, 'library/gallery/uploads/local.webp')
    const fromAdm = writeMedia(foreign, 'library/gallery/food/03.jpg', 'adm-food')
    writeMedia(foreign, 'music/ambient.mp3', 'adm-music')

    const { files, counts } = resolveUsedMediaFiles(code, {
      musicSrc: `/media/projects/${foreign}/music/ambient.mp3`,
      sequences: {
        food: {
          clips: [
            { src: local },
            { src: fromAdm },
          ],
        },
      },
    })

    assert.equal(counts.library, 2)
    assert.equal(counts.music, 1)
    assert.equal(counts.missing, 0)
    assert.deepEqual(
      files.map((f) => f.src).sort(),
      [
        `/media/projects/${code}/library/gallery/food/03.jpg`,
        `/media/projects/${code}/library/gallery/uploads/local.webp`,
        `/media/projects/${code}/music/ambient.mp3`,
      ].sort(),
    )
    const packedFood = files.find((f) => f.rel === 'library/gallery/food/03.jpg')
    assert.equal(fs.readFileSync(packedFood.full, 'utf8'), 'adm-food')
  }),
)

test(
  'resolveUsedMediaFiles prefers current project file over foreign',
  withPublicDir(() => {
    const code = 'plaza2'
    const foreign = 'adm'
    writeMedia(code, 'library/gallery/about/02.webp', 'local')
    writeMedia(foreign, 'library/gallery/about/02.webp', 'foreign')

    const { files, counts } = resolveUsedMediaFiles(code, {
      sequences: {
        x: { clips: [{ src: `/media/projects/${foreign}/library/gallery/about/02.webp` }] },
      },
    })

    assert.equal(counts.library, 1)
    assert.equal(counts.missing, 0)
    assert.equal(files[0].src, `/media/projects/${code}/library/gallery/about/02.webp`)
    assert.equal(fs.readFileSync(files[0].full, 'utf8'), 'local')
  }),
)
