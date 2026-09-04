import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

/**
 * Норма слайдов презентации (телефон + десктоп, Ken Burns):
 * длинная сторона ≤ 1920px, целевой вес ~150–400 КБ.
 * Новые загрузки → WebP; существующие файлы жмём in-place (тот же путь/расширение).
 */
export const IMAGE_MAX_LONG_SIDE = 1920
export const IMAGE_WEBP_QUALITY = 78
export const IMAGE_JPEG_QUALITY = 80
export const IMAGE_TARGET_MAX_BYTES = 400 * 1024

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export function isOptimizableImageExt(ext) {
  return IMAGE_EXTS.has(String(ext ?? '').toLowerCase())
}

function formatFromExt(ext) {
  const e = String(ext ?? '').toLowerCase()
  if (e === '.webp') return 'webp'
  if (e === '.png') return 'png'
  return 'jpeg'
}

function extForFormat(format) {
  if (format === 'webp') return '.webp'
  if (format === 'png') return '.png'
  return '.jpg'
}

/**
 * @param {Buffer} buf
 * @param {{
 *   format?: 'webp' | 'jpeg' | 'png' | 'keep'
 *   sourceExt?: string
 *   skipIfOk?: boolean
 * }} [opts]
 */
export async function optimizeImageBuffer(buf, opts = {}) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { buffer: buf, ext: opts.sourceExt || '.jpg', skipped: true, reason: 'empty' }
  }

  let image
  try {
    image = sharp(buf, { failOn: 'none', animated: false }).rotate()
  } catch {
    return { buffer: buf, ext: opts.sourceExt || '.jpg', skipped: true, reason: 'unreadable' }
  }

  const meta = await image.metadata()
  if ((meta.pages ?? 1) > 1) {
    return {
      buffer: buf,
      ext: opts.sourceExt || extForFormat(formatFromExt(opts.sourceExt)),
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      skipped: true,
      reason: 'animated',
    }
  }

  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const longSide = Math.max(width, height)
  const needsResize = longSide > IMAGE_MAX_LONG_SIDE
  const compressCeiling = opts.skipIfOk
    ? Math.round(IMAGE_TARGET_MAX_BYTES * 1.25)
    : IMAGE_TARGET_MAX_BYTES
  const needsCompress = buf.length > compressCeiling

  const wantRaw =
    opts.format === 'keep' || !opts.format
      ? formatFromExt(opts.sourceExt || `.${meta.format || 'jpeg'}`)
      : opts.format

  // Фото в PNG без альфы → jpeg (png почти не сжимается).
  let want = wantRaw
  let outExtOverride = null
  if (wantRaw === 'png' && opts.format === 'keep' && !meta.hasAlpha) {
    want = 'jpeg'
    outExtOverride = '.jpg'
  }

  if (opts.skipIfOk && !needsResize && !needsCompress && opts.format !== 'webp') {
    const alreadyWebpOk = want === 'webp' && meta.format === 'webp'
    const alreadyJpegOk = want === 'jpeg' && (meta.format === 'jpeg' || meta.format === 'jpg')
    const alreadyPngOk = want === 'png' && meta.format === 'png'
    if (alreadyWebpOk || alreadyJpegOk || alreadyPngOk) {
      return {
        buffer: buf,
        ext: extForFormat(want),
        width,
        height,
        skipped: true,
        reason: 'already-ok',
      }
    }
  }

  let pipeline = image
  if (needsResize) {
    pipeline = pipeline.resize({
      width: IMAGE_MAX_LONG_SIDE,
      height: IMAGE_MAX_LONG_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  let encoded
  if (want === 'webp') {
    encoded = await pipeline.webp({ quality: IMAGE_WEBP_QUALITY, effort: 4 }).toBuffer({
      resolveWithObject: true,
    })
  } else if (want === 'png') {
    encoded = await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
  } else {
    encoded = await pipeline
      .jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
  }

  const out = encoded.data
  const outMeta = encoded.info
  const outExt = outExtOverride || extForFormat(want)
  const formatChanged = Boolean(outExtOverride) || (opts.format === 'webp' && meta.format !== 'webp')
  const resized = needsResize
  const smaller = out.length < buf.length
  // Не раздуваем уже нормальный файл без ресайза / смены формата.
  if (!resized && !smaller && !formatChanged && opts.format !== 'webp') {
    return {
      buffer: buf,
      ext: opts.sourceExt || outExt,
      width,
      height,
      skipped: true,
      reason: 'no-gain',
    }
  }

  return {
    buffer: out,
    ext: outExt,
    width: outMeta.width ?? width,
    height: outMeta.height ?? height,
    skipped: false,
    bytesBefore: buf.length,
    bytesAfter: out.length,
  }
}

/**
 * Сжимает файл на диске. Для PNG без альфы может переименовать в .jpg.
 * @returns {Promise<{ changed: boolean, bytesBefore: number, bytesAfter: number, reason?: string, fromSrc?: string, toSrc?: string }>}
 */
export async function optimizeImageFile(filePath, { skipIfOk = true } = {}) {
  const ext = path.extname(filePath).toLowerCase()
  if (!isOptimizableImageExt(ext)) {
    return { changed: false, bytesBefore: 0, bytesAfter: 0, reason: 'not-image' }
  }
  const before = await fs.promises.readFile(filePath)
  const result = await optimizeImageBuffer(before, {
    format: 'keep',
    sourceExt: ext,
    skipIfOk,
  })
  if (result.skipped) {
    return {
      changed: false,
      bytesBefore: before.length,
      bytesAfter: before.length,
      reason: result.reason,
    }
  }

  const targetPath =
    result.ext && result.ext !== ext
      ? path.join(path.dirname(filePath), `${path.basename(filePath, ext)}${result.ext}`)
      : filePath
  const tmp = `${targetPath}.opt-tmp`
  await fs.promises.writeFile(tmp, result.buffer, { mode: 0o644 })
  await fs.promises.rename(tmp, targetPath)
  try {
    await fs.promises.chmod(targetPath, 0o644)
  } catch {
    /* volume may ignore chmod */
  }
  if (targetPath !== filePath) {
    await fs.promises.unlink(filePath).catch(() => undefined)
  }
  return {
    changed: true,
    bytesBefore: before.length,
    bytesAfter: result.buffer.length,
    fromPath: filePath,
    toPath: targetPath,
  }
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) out.push(...walkFiles(full))
    else if (st.isFile()) out.push(full)
  }
  return out
}

/**
 * Прогон картинок в directory (обычно …/library).
 */
export async function optimizeImagesInDir(dir, { skipIfOk = true, onFile } = {}) {
  const files = walkFiles(dir).filter((f) => isOptimizableImageExt(path.extname(f)))
  const summary = {
    total: files.length,
    changed: 0,
    skipped: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    errors: [],
  }
  for (const file of files) {
    try {
      const st = await fs.promises.stat(file)
      const result = await optimizeImageFile(file, { skipIfOk })
      summary.bytesBefore += result.bytesBefore || st.size
      summary.bytesAfter += result.bytesAfter || st.size
      if (result.changed) summary.changed += 1
      else summary.skipped += 1
      onFile?.(file, result)
    } catch (err) {
      summary.errors.push({ file, error: String(err?.message || err) })
    }
  }
  return summary
}
