import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import sharp from 'sharp'
import {
  IMAGE_MAX_LONG_SIDE,
  IMAGE_TARGET_MAX_BYTES,
  optimizeImageBuffer,
} from './imageOptimize.mjs'

async function makeJpeg({ width, height, quality = 95 }) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 90, b: 140 },
    },
  })
    .jpeg({ quality })
    .toBuffer()
}

describe('optimizeImageBuffer', () => {
  it('ресайзит длинную сторону до IMAGE_MAX_LONG_SIDE и отдаёт webp', async () => {
    const src = await makeJpeg({ width: 4000, height: 2250 })
    const out = await optimizeImageBuffer(src, { format: 'webp', sourceExt: '.jpg' })
    assert.equal(out.skipped, false)
    assert.equal(out.ext, '.webp')
    assert.ok(Math.max(out.width, out.height) <= IMAGE_MAX_LONG_SIDE)
    assert.ok(out.buffer.length < src.length)
    assert.ok(out.buffer.length < IMAGE_TARGET_MAX_BYTES * 2)
  })

  it('in-place keep оставляет jpeg и ужимает длинную сторону', async () => {
    const src = await makeJpeg({ width: 3600, height: 2400, quality: 98 })
    const out = await optimizeImageBuffer(src, { format: 'keep', sourceExt: '.jpg' })
    assert.equal(out.ext, '.jpg')
    assert.equal(out.skipped, false)
    assert.ok(Math.max(out.width, out.height) <= IMAGE_MAX_LONG_SIDE)
    assert.equal(out.width, IMAGE_MAX_LONG_SIDE)
  })

  it('не трогает уже нормальный маленький jpeg', async () => {
    const src = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .jpeg({ quality: 70 })
      .toBuffer()
    assert.ok(src.length < IMAGE_TARGET_MAX_BYTES)
    const out = await optimizeImageBuffer(src, {
      format: 'keep',
      sourceExt: '.jpg',
      skipIfOk: true,
    })
    assert.equal(out.skipped, true)
    assert.equal(out.reason, 'already-ok')
  })
})
