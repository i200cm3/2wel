import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-used-'))
process.env.PUBLIC_DIR = tmp

const { resolveUsedMediaFiles } = await import('./templateArchive.mjs')

function writeMedia(code, rel, body = 'x') {
  const full = path.join(tmp, 'media', 'projects', code, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
  return `/media/projects/${code}/${rel.replace(/\\/g, '/')}`
}

test('resolveUsedMediaFiles packs only referenced files', () => {
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
})

test('resolveUsedMediaFiles counts missing refs', () => {
  const code = 'exp-miss'
  const { counts } = resolveUsedMediaFiles(code, {
    sequences: {
      intro: { clips: [{ src: `/media/projects/${code}/library/nope.jpg` }] },
    },
  })
  assert.equal(counts.library, 0)
  assert.equal(counts.missing, 1)
})
