import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { publicDir } from './env.mjs'
import { formatGuestName } from './guestLink.mjs'
import { rewriteConfigMedia } from './projectMedia.mjs'

const execFileAsync = promisify(execFile)

export const PREVIEW_WIDTH = 720
export const PREVIEW_HEIGHT = 1280
const PORTRAIT_ASPECT = 9 / 16
const LANDSCAPE_ASPECT = 16 / 9
const IMAGE_RE = /\.(jpe?g|png|webp)$/i
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i
const PREVIEW_PATH_RE = /^\/(?:api\/public\/links\/)?([a-z0-9]{3,16})\/preview\.jpe?g$/i
const RESERVED_PREVIEW_IDS = new Set([
  'app',
  'api',
  'login',
  'logout',
  'register',
  'forgot',
  'reset',
  'editor',
  'media',
  'health',
])

export function parsePreviewPath(url) {
  const match = String(url ?? '').match(PREVIEW_PATH_RE)
  if (!match) return null
  const id = match[1]
  if (RESERVED_PREVIEW_IDS.has(id.toLowerCase())) return null
  return id
}

export function fillPreviewTitle(template, guestName) {
  const name = formatGuestName(guestName) || 'гость'
  const raw = String(template ?? '').trim() || 'Здравствуйте, {name}!'
  return raw.replaceAll('{name}', name).replaceAll('[name]', name)
}

function clipSrc(clip) {
  return typeof clip?.src === 'string' ? clip.src.trim() : ''
}

function extOf(src) {
  const base = src.split(/[?#]/)[0] ?? ''
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot) : ''
}

function sequenceList(config) {
  const sequences = config?.sequences && typeof config.sequences === 'object' ? config.sequences : {}
  const flow = Array.isArray(config?.flow) ? config.flow : []
  const seen = new Set()
  const ids = []
  for (const id of [...flow, ...Object.keys(sequences)]) {
    if (!id || seen.has(id) || !sequences[id]) continue
    seen.add(id)
    ids.push(id)
  }
  return ids.map((id) => sequences[id])
}

export function emailPreviewOptions(config) {
  const raw = config?.emailPreview && typeof config.emailPreview === 'object' ? config.emailPreview : {}
  const src = typeof raw.src === 'string' && raw.src.trim() ? raw.src.trim() : ''
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : ''
  return {
    enabled: raw.enabled === true,
    src,
    showPlay: raw.showPlay !== false,
    showTitle: raw.showTitle !== false,
    title,
  }
}

/** Своё фото из конструктора или первый кадр приветствия / автопоказа. */
export function pickPreviewClip(config) {
  const customSrc = emailPreviewOptions(config).src
  if (customSrc) return { src: customSrc, from: { x: 0.5, y: 0.5, scale: 1.02 } }
  const sequences = sequenceList(config)
  const greeting = sequences.find((seq) => seq?.id === 'greeting') ?? sequences[0] ?? null
  const allClips = sequences.flatMap((seq) => (Array.isArray(seq?.clips) ? seq.clips : []))
  const prefer = Array.isArray(greeting?.clips) ? greeting.clips : []
  const image =
    prefer.find((clip) => IMAGE_RE.test(extOf(clipSrc(clip)))) ||
    allClips.find((clip) => IMAGE_RE.test(extOf(clipSrc(clip))))
  if (image) return image
  return (
    prefer.find((clip) => VIDEO_RE.test(extOf(clipSrc(clip)))) ||
    allClips.find((clip) => VIDEO_RE.test(extOf(clipSrc(clip)))) ||
    null
  )
}

export function pickPreviewTitleTemplate(config) {
  const custom = emailPreviewOptions(config).title
  if (custom) return custom
  const sequences = sequenceList(config)
  const greeting = sequences.find((seq) => seq?.id === 'greeting')
  const fromGreeting = typeof greeting?.title === 'string' ? greeting.title.trim() : ''
  if (fromGreeting) return fromGreeting
  const first = sequences[0]
  const fromFirst = typeof first?.title === 'string' ? first.title.trim() : ''
  return fromFirst || 'Здравствуйте, {name}!'
}

export function coverWindow(imgAspect, scale, viewAspect = PORTRAIT_ASPECT) {
  const s = Math.max(1, Number(scale) || 1)
  if (imgAspect >= viewAspect) return { w: viewAspect / imgAspect / s, h: 1 / s }
  return { w: 1 / s, h: imgAspect / viewAspect / s }
}

export function focusToCropRect(point, imgAspect, viewAspect = PORTRAIT_ASPECT) {
  const scale = Math.min(1.45, Math.max(1, Number(point?.scale) || 1))
  const { w, h } = coverWindow(imgAspect, scale, viewAspect)
  const x = Math.min(1 - w / 2, Math.max(w / 2, Number(point?.x) || 0.5))
  const y = Math.min(1 - h / 2, Math.max(h / 2, Number(point?.y) || 0.5))
  return { left: x - w / 2, top: y - h / 2, width: w, height: h }
}

export function cropPixels(imgW, imgH, point, viewAspect = PORTRAIT_ASPECT) {
  const w = Math.max(1, imgW)
  const h = Math.max(1, imgH)
  const rect = focusToCropRect(point, w / h, viewAspect)
  let left = Math.round(rect.left * w)
  let top = Math.round(rect.top * h)
  let width = Math.round(rect.width * w)
  let height = Math.round(rect.height * h)
  left = Math.min(Math.max(0, left), w - 1)
  top = Math.min(Math.max(0, top), h - 1)
  width = Math.min(Math.max(1, width), w - left)
  height = Math.min(Math.max(1, height), h - top)
  return { left, top, width, height }
}

function isInside(root, target) {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function resolveMediaFile(src) {
  if (typeof src !== 'string' || !src.startsWith('/media/')) return null
  const rel = src.split(/[?#]/)[0].replace(/^\/+/, '')
  const root = publicDir()
  const abs = path.resolve(root, rel)
  const mediaRoot = path.resolve(root, 'media')
  if (!isInside(mediaRoot, abs) && abs !== mediaRoot) return null
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null
  } catch {
    return null
  }
  return abs
}

function previewSize(config) {
  const orientation = config?.theme?.orientation === 'landscape' ? 'landscape' : 'portrait'
  if (orientation === 'landscape') return { width: 1280, height: 720, aspect: LANDSCAPE_ASPECT }
  return { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, aspect: PORTRAIT_ASPECT }
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function wrapTitleLines(text, maxChars = 22) {
  const words = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return []
  const lines = []
  let cur = ''
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word
    if (next.length > maxChars && cur) {
      lines.push(cur)
      cur = word
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 3)
}

function overlaySvg({ width, height, title, showPlay = true, showTitle = true }) {
  if (!showPlay && !showTitle) return null
  const cx = Math.round(width / 2)
  const cy = Math.round(height * 0.42)
  const r = Math.round(Math.min(width, height) * 0.09)
  const triW = Math.round(r * 0.85)
  const triH = Math.round(r * 1.05)
  const triX = cx - Math.round(triW * 0.28)
  const lines = showTitle ? wrapTitleLines(title, width >= 1000 ? 28 : 20) : []
  const fontSize = width >= 1000 ? 40 : 36
  const lineH = Math.round(fontSize * 1.18)
  const baseY = height - 56 - (lines.length - 1) * lineH
  const text = lines
    .map(
      (line, i) =>
        `<text x="${cx}" y="${baseY + i * lineH}" text-anchor="middle" fill="${TITLE_COLOR}" font-size="${fontSize}" font-family="Noto Serif, Georgia, 'Times New Roman', serif" font-weight="600">${escapeXml(line)}</text>`,
    )
    .join('')
  const gradY = Math.round(height * 0.52)
  const play = showPlay
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" fill-opacity="0.22" stroke="#ffffff" stroke-width="3"/>
      <polygon points="${triX},${cy - triH / 2} ${triX},${cy + triH / 2} ${triX + triW},${cy}" fill="#ffffff"/>`
    : ''
  const fade = showTitle
    ? `<defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${BAR_COLOR}" stop-opacity="0"/>
          <stop offset="100%" stop-color="${BAR_COLOR}" stop-opacity="0.88"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${gradY}" width="${width}" height="${height - gradY}" fill="url(#g)"/>`
    : ''
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${fade}
      ${play}
      ${text}
    </svg>`,
  )
}

async function stillFromVideo(videoPath, destPath) {
  await execFileAsync(
    'ffmpeg',
    ['-y', '-ss', '0.4', '-i', videoPath, '-frames:v', '1', '-q:v', '3', destPath],
    { timeout: 15000 },
  )
  if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 32) {
    throw new Error('ffmpeg produced no frame')
  }
}

function cacheDir() {
  return path.join(os.tmpdir(), 'pclip-previews')
}

export function previewCacheKey({ publicId, guestName, src, point, title, size, showPlay, showTitle }) {
  const raw = JSON.stringify({
    publicId,
    guestName,
    src,
    x: point?.x,
    y: point?.y,
    scale: point?.scale,
    title,
    showPlay: showPlay !== false,
    showTitle: showTitle !== false,
    w: size.width,
    h: size.height,
  })
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)
}

async function loadSourceBuffer(clip) {
  const file = resolveMediaFile(clipSrc(clip))
  if (!file) return null
  if (IMAGE_RE.test(extOf(file))) return fs.promises.readFile(file)
  if (!VIDEO_RE.test(extOf(file))) return null
  const tmp = path.join(os.tmpdir(), `pclip-frame-${crypto.randomBytes(8).toString('hex')}.jpg`)
  try {
    await stillFromVideo(file, tmp)
    return await fs.promises.readFile(tmp)
  } catch {
    return null
  } finally {
    fs.promises.unlink(tmp).catch(() => undefined)
  }
}

export async function renderLinkPreview({ config, guestName, publicId }) {
  const property = config
  const size = previewSize(property)
  const overlay = emailPreviewOptions(property)
  const clip = pickPreviewClip(property)
  const title = overlay.showTitle
    ? fillPreviewTitle(pickPreviewTitleTemplate(property), guestName)
    : ''
  const point = clip?.from && typeof clip.from === 'object' ? clip.from : { x: 0.5, y: 0.5, scale: 1.02 }
  const src = clipSrc(clip)
  const key = previewCacheKey({
    publicId,
    guestName,
    src,
    point,
    title,
    size,
    showPlay: overlay.showPlay,
    showTitle: overlay.showTitle,
  })
  const cachePath = path.join(cacheDir(), `${publicId}-${key}.jpg`)
  try {
    if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 64) {
      return { jpeg: await fs.promises.readFile(cachePath), cacheKey: key }
    }
  } catch {
    /* generate */
  }

  const source = clip ? await loadSourceBuffer(clip) : null
  let photo
  if (source) {
    const oriented = sharp(source).rotate()
    const meta = await oriented.clone().metadata()
    const imgW = meta.width || PREVIEW_WIDTH
    const imgH = meta.height || PREVIEW_HEIGHT
    const crop = cropPixels(imgW, imgH, point, size.aspect)
    photo = oriented.extract(crop).resize(size.width, size.height, { fit: 'fill' })
  } else {
    photo = sharp({
      create: {
        width: size.width,
        height: size.height,
        channels: 3,
        background: BAR_COLOR,
      },
    })
  }

  const svg = overlaySvg({
    ...size,
    title,
    showPlay: overlay.showPlay,
    showTitle: overlay.showTitle,
  })
  const jpeg = await (svg ? photo.composite([{ input: svg, blend: 'over' }]) : photo)
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()

  try {
    await fs.promises.mkdir(cacheDir(), { recursive: true })
    await fs.promises.writeFile(cachePath, jpeg)
  } catch {
    /* cache is optional */
  }
  return { jpeg, cacheKey: key }
}

export async function previewJpegForRow(row) {
  const config = rewriteConfigMedia(row.config, row.project_code)
  if (!emailPreviewOptions(config).enabled) {
    return { disabled: true }
  }
  return renderLinkPreview({
    config,
    guestName: row.guest_name,
    publicId: row.public_id,
  })
}
