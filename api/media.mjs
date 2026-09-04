import fs from 'node:fs'
import path from 'node:path'
import { projectForUser } from './cabinet.mjs'
import { publicDir } from './env.js'
import { isOptimizableImageExt, optimizeImageBuffer } from './imageOptimize.mjs'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v'])
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS])
const ROOTS = new Set(['gallery', 'rooms', 'park'])
const DEFAULT_FOLDER = 'gallery/uploads'
const PUBLIC_FILE_MODE = 0o644

function isInside(root, target) {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function sniffImageExt(buf, fileName) {
  const fromName = path.extname(fileName).toLowerCase()
  let fromBytes = null
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) fromBytes = '.jpg'
  else if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    fromBytes = '.png'
  } else if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    fromBytes = '.webp'
  }
  if (!fromBytes) return null
  if (fromName === '.jpeg' && fromBytes === '.jpg') return '.jpg'
  if (fromName && fromName !== fromBytes && !(fromName === '.jpeg' && fromBytes === '.jpg')) {
    return fromBytes
  }
  return fromBytes
}

function sniffVideoExt(buf, fileName) {
  const fromName = path.extname(fileName).toLowerCase()
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return '.webm'
  }
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    if (fromName === '.mov' || fromName === '.m4v' || fromName === '.mp4') return fromName
    return '.mp4'
  }
  if (VIDEO_EXTS.has(fromName) && buf.length > 32) return fromName
  return null
}

function sniffMediaExt(buf, fileName) {
  return sniffImageExt(buf, fileName) || sniffVideoExt(buf, fileName)
}

function safeFolder(raw) {
  const cleaned = String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[^\w.-]/g, '-'))
    .join('/')
  if (!cleaned) return DEFAULT_FOLDER
  const root = cleaned.split('/')[0] ?? ''
  if (!ROOTS.has(root)) return DEFAULT_FOLDER
  return cleaned
}

function safeBaseName(raw, ext) {
  const base = path
    .basename(raw, path.extname(raw))
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return `${base || 'media'}${ext}`
}

function uniqueName(dirs, fileName) {
  const ext = path.extname(fileName)
  const stem = path.basename(fileName, ext)
  let next = fileName
  let n = 2
  while (dirs.some((dir) => fs.existsSync(path.join(dir, next)))) {
    next = `${stem}-${n}${ext}`
    n += 1
  }
  return next
}

function folderLabel(id) {
  const last = id.split('/').pop() ?? id
  if (last === 'uploads') return 'Загрузки'
  return last.replace(/-/g, ' ')
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return { total: 0, folders: [], items: [] }
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (!Array.isArray(data.items)) data.items = []
    if (!Array.isArray(data.folders)) data.folders = []
    return data
  } catch {
    return { total: 0, folders: [], items: [] }
  }
}

function saveManifest(manifestPath, items, prevFolders) {
  const labels = new Map(prevFolders.map((f) => [f.id, f.label]))
  const byFolder = new Map()
  for (const it of items) {
    const list = byFolder.get(it.folder) ?? []
    list.push(it.src)
    byFolder.set(it.folder, list)
  }
  const data = {
    total: items.length,
    folders: [...byFolder.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, srcs]) => ({
        id,
        label: labels.get(id) || folderLabel(id),
        srcs,
      })),
    items,
  }
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return data
}

function upsertItem(manifestPath, item) {
  const data = loadManifest(manifestPath)
  const items = data.items.filter((it) => it.src !== item.src)
  items.unshift(item)
  return saveManifest(manifestPath, items, data.folders)
}

function removeItem(manifestPath, src) {
  const data = loadManifest(manifestPath)
  return saveManifest(
    manifestPath,
    data.items.filter((it) => it.src !== src),
    data.folders,
  )
}

async function writePublicFile(filePath, buf) {
  await fs.promises.writeFile(filePath, buf, { mode: PUBLIC_FILE_MODE })
  await fs.promises.chmod(filePath, PUBLIC_FILE_MODE)
}

function projectPrefix(code) {
  return `/media/projects/${code}/library/`
}

function projectLibraryRoot(code) {
  return path.resolve(publicDir(), 'media/projects', code, 'library')
}

function projectManifestPath(code) {
  return path.resolve(publicDir(), 'media/projects', code, 'library-manifest.json')
}

export function listProjectManifest(code) {
  return loadManifest(projectManifestPath(code))
}

export async function handleProjectMedia(req, res, extras) {
  const { userId, projectCode, action, json, readBuffer, headerStr, queryOf, maxBytes } = extras
  const project = await projectForUser(userId, projectCode)
  if (!project) {
    json(res, 404, { error: 'project not found' })
    return
  }
  const code = project.code
  const method = req.method ?? 'GET'

  if (!action) {
    if (method === 'GET' || method === 'HEAD') {
      json(res, 200, { ok: true, manifest: listProjectManifest(code) })
      return
    }
    json(res, 405, { error: 'method not allowed' })
    return
  }

  if (action === 'upload') {
    if (method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    const rawName = headerStr(req.headers['x-file-name'], 'media')
    const folder = safeFolder(headerStr(req.headers['x-folder'], DEFAULT_FOLDER))
    const buf = await readBuffer(req, maxBytes)
    if (!buf.length) {
      json(res, 400, { error: 'empty file' })
      return
    }
    const ext = sniffMediaExt(buf, rawName)
    if (!ext || !MEDIA_EXTS.has(ext)) {
      json(res, 400, { error: 'Нужен файл JPG, PNG, WebP, MP4 или WebM' })
      return
    }
    let outBuf = buf
    let outExt = ext === '.jpeg' ? '.jpg' : ext
    if (isOptimizableImageExt(ext)) {
      const optimized = await optimizeImageBuffer(buf, {
        format: 'webp',
        sourceExt: ext,
      })
      outBuf = optimized.buffer
      outExt = optimized.ext
    }
    const libraryRoot = projectLibraryRoot(code)
    const publicDirPath = path.resolve(libraryRoot, folder)
    await fs.promises.mkdir(publicDirPath, { recursive: true })
    const fileName = uniqueName([publicDirPath], safeBaseName(rawName, outExt))
    const publicPath = path.join(publicDirPath, fileName)
    if (!isInside(libraryRoot, publicPath)) {
      json(res, 400, { error: 'bad folder' })
      return
    }
    await writePublicFile(publicPath, outBuf)
    const rel = `${folder}/${fileName}`
    const src = `${projectPrefix(code)}${rel}`
    const st = await fs.promises.stat(publicPath)
    upsertItem(projectManifestPath(code), {
      src,
      folder,
      name: fileName,
      rel,
      bytes: st.size,
      mtime: Math.floor(st.mtimeMs / 1000),
    })
    json(res, 200, { ok: true, src, folder, name: fileName, manifest: listProjectManifest(code) })
    return
  }

  if (action === 'file') {
    if (method !== 'DELETE' && method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    let src = queryOf(req).get('src')
    if (!src && method === 'POST') {
      const raw = await readBuffer(req, 64 * 1024)
      try {
        const payload = JSON.parse(raw.toString('utf8'))
        src = typeof payload.src === 'string' ? payload.src : null
      } catch {
        src = null
      }
    }
    if (!src || src.includes('..')) {
      json(res, 400, { error: 'bad src' })
      return
    }
    const prefix = projectPrefix(code)
    if (src.startsWith(prefix)) {
      const rel = src.slice(prefix.length)
      const libraryRoot = projectLibraryRoot(code)
      const publicPath = path.resolve(libraryRoot, rel)
      if (!isInside(libraryRoot, publicPath)) {
        json(res, 400, { error: 'bad src' })
        return
      }
      await fs.promises.unlink(publicPath).catch(() => undefined)
      removeItem(projectManifestPath(code), src)
      json(res, 200, { ok: true, src, manifest: listProjectManifest(code) })
      return
    }
    json(res, 400, { error: 'bad src' })
    return
  }

  json(res, 404, { error: 'not found' })
}
