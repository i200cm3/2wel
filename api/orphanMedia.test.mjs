import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-media-'))
process.env.PUBLIC_DIR = tmp

const {
  collectProjectMediaSrcs,
  listOrphanProjectMedia,
  mediaSrcsFromConfigs,
  purgeProjectMediaSrcs,
  removeProjectMedia,
} = await import('./projectMedia.mjs')

function writeMedia(code, rel, body = 'x') {
  const full = path.join(tmp, 'media', 'projects', code, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
  return `/media/projects/${code}/${rel.replace(/\\/g, '/')}`
}

test('collectProjectMediaSrcs walks nested config', () => {
  const code = 'c-collect'
  const src = `/media/projects/${code}/library/a.jpg`
  const tts = `/media/projects/${code}/tts/el.mp3`
  const out = collectProjectMediaSrcs(
    {
      musicSrc: `/media/projects/${code}/music/ambient.mp3`,
      sequences: { intro: { clips: [{ src }], cues: [{ ttsSrc: tts }] } },
    },
    code,
  )
  assert.equal(out.size, 3)
  assert.ok(out.has(src))
  assert.ok(out.has(tts))
})

test('listOrphanProjectMedia keeps shared files, lists only unused on disk', () => {
  const code = 'c-orphan'
  const shared = writeMedia(code, 'library/gallery/shared.jpg')
  const onlyA = writeMedia(code, 'library/gallery/only-a.jpg')
  const missing = `/media/projects/${code}/library/gallery/gone.jpg`
  const orphans = listOrphanProjectMedia(code, [shared, onlyA, missing], new Set([shared]))
  assert.deepEqual(orphans, [onlyA])
})

test('mediaSrcsFromConfigs unions draft and published', () => {
  const code = 'c-union'
  const a = `/media/projects/${code}/library/a.jpg`
  const b = `/media/projects/${code}/tts/b.mp3`
  const set = mediaSrcsFromConfigs([{ sequences: { x: { clips: [{ src: a }] } } }, { musicSrc: b }], code)
  assert.equal(set.size, 2)
  assert.ok(set.has(a))
  assert.ok(set.has(b))
})

test('purgeProjectMediaSrcs deletes orphans and rebuilds library manifest', () => {
  const code = 'c-purge'
  const keep = writeMedia(code, 'library/gallery/keep.jpg', 'keep')
  const drop = writeMedia(code, 'library/gallery/drop.jpg', 'drop')
  const tts = writeMedia(code, 'tts/drop.mp3', 'audio')
  const result = purgeProjectMediaSrcs(code, [drop, tts])
  assert.equal(result.deleted, 2)
  assert.ok(fs.existsSync(path.join(tmp, 'media', 'projects', code, 'library', 'gallery', 'keep.jpg')))
  assert.ok(!fs.existsSync(path.join(tmp, 'media', 'projects', code, 'library', 'gallery', 'drop.jpg')))
  assert.ok(!fs.existsSync(path.join(tmp, 'media', 'projects', code, 'tts', 'drop.mp3')))
  const manifest = JSON.parse(
    fs.readFileSync(path.join(tmp, 'media', 'projects', code, 'library-manifest.json'), 'utf8'),
  )
  assert.equal(manifest.total, 1)
  assert.equal(manifest.items[0].src, keep)
})

test('removeProjectMedia deletes library music and tts under the project', async () => {
  const code = 'c-remove'
  writeMedia(code, 'library/gallery/a.jpg', 'img')
  writeMedia(code, 'music/ambient.mp3', 'music')
  writeMedia(code, 'tts/voice.mp3', 'tts')
  const starter = path.join(tmp, 'media', 'tts', 'starter', 'keep.mp3')
  fs.mkdirSync(path.dirname(starter), { recursive: true })
  fs.writeFileSync(starter, 'shared')
  const result = await removeProjectMedia(code)
  assert.equal(result.ok, true)
  assert.equal(result.removed, true)
  assert.ok(!fs.existsSync(path.join(tmp, 'media', 'projects', code)))
  assert.ok(fs.existsSync(starter))
})
