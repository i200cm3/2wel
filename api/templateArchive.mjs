import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { templateRowForUser, isPropertyConfig } from './cabinet.mjs'
import { query } from './db.js'
import { publicDir } from './env.js'
import { optimizeImagesInDir } from './imageOptimize.mjs'
import { rewriteAllProjectMediaPaths, collectAnyProjectMediaSrcs } from './projectMedia.mjs'

const PUBLIC_FILE_MODE = 0o644
const MEDIA_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm', '.mov', '.m4v'])
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a'])
const SKIP_JSON = new Set(['library-manifest.json', 'tts-manifest.json', 'package.json'])

function isInside(root, target) {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function cleanZipPath(name) {
  return String(name ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
}

function projectRel(parts) {
  const idx = parts.findIndex((part) => part === 'library' || part === 'music' || part === 'tts')
  if (idx < 0) return null
  return parts.slice(idx)
}

function allowedProjectFile(rel) {
  const root = rel[0]
  const ext = path.extname(rel.at(-1) ?? '').toLowerCase()
  if (root === 'library') return MEDIA_EXTS.has(ext)
  if (root === 'music' || root === 'tts') return AUDIO_EXTS.has(ext)
  return false
}

function folderLabel(id) {
  const last = id.split('/').pop() ?? id
  if (last === 'uploads') return 'Загрузки'
  const labels = {
    intro: 'Интро',
    about: 'О санатории',
    rooms: 'Размещение',
    treatment: 'Лечение',
    food: 'Питание',
    leisure: 'Досуг',
    place: 'Локация',
  }
  return labels[last] || last.replace(/-/g, ' ')
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

export function rebuildLibraryManifest(code) {
  const root = path.resolve(publicDir(), 'media/projects', code, 'library')
  const manifestPath = path.resolve(publicDir(), 'media/projects', code, 'library-manifest.json')
  const items = walkFiles(root)
    .filter((file) => MEDIA_EXTS.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const rel = path.relative(root, file).replace(/\\/g, '/')
      const folder = path.dirname(rel).replace(/\\/g, '/')
      const st = fs.statSync(file)
      return {
        src: `/media/projects/${code}/library/${rel}`,
        folder,
        name: path.basename(file),
        rel,
        bytes: st.size,
        mtime: Math.floor(st.mtimeMs / 1000),
      }
    })
  const byFolder = new Map()
  for (const item of items) {
    const list = byFolder.get(item.folder) ?? []
    list.push(item.src)
    byFolder.set(item.folder, list)
  }
  const manifest = {
    total: items.length,
    folders: [...byFolder.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, srcs]) => ({ id, label: folderLabel(id), srcs })),
    items,
  }
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

function findConfig(entries) {
  const candidates = []
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const parts = cleanZipPath(entry.entryName)
    const name = parts.at(-1) ?? ''
    if (!name.toLowerCase().endsWith('.json')) continue
    if (SKIP_JSON.has(name.toLowerCase())) continue
    const depth = parts.length
    const score =
      /property|config|draft|template/i.test(name) ? 0 : name === 'default.json' ? 1 : 2
    candidates.push({ entry, score, depth })
  }
  candidates.sort((a, b) => a.score - b.score || a.depth - b.depth)
  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate.entry.getData().toString('utf8'))
      if (isPropertyConfig(data)) return data
    } catch {
      // try next json file
    }
  }
  return null
}

function writeProjectFiles(entries, code) {
  const projectRoot = path.resolve(publicDir(), 'media/projects', code)
  fs.mkdirSync(projectRoot, { recursive: true })
  let written = 0
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const rel = projectRel(cleanZipPath(entry.entryName))
    if (!rel || rel.length < 2 || !allowedProjectFile(rel)) continue
    const out = path.resolve(projectRoot, ...rel)
    if (!isInside(projectRoot, out)) continue
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, entry.getData(), { mode: PUBLIC_FILE_MODE })
    try {
      fs.chmodSync(out, PUBLIC_FILE_MODE)
    } catch {
      // The volume can ignore chmod; readable file is enough.
    }
    written += 1
  }
  return written
}

function collectProjectSrcs(value, code, out = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith(`/media/projects/${code}/`)) {
      out.add(value.split('?')[0])
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProjectSrcs(item, code, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectProjectSrcs(item, code, out)
  }
  return out
}

function missingProjectFiles(config, code) {
  const root = publicDir()
  const missing = []
  for (const src of collectProjectSrcs(config, code)) {
    const rel = src.replace(/^\/+/, '')
    const full = path.resolve(root, rel)
    if (!isInside(root, full) || !fs.existsSync(full)) missing.push(src)
  }
  return missing
}

export async function importTemplateArchiveForUser(userId, projectCode, templateCode, buffer) {
  const found = await templateRowForUser(userId, projectCode, templateCode)
  if (!found) return { status: 404, error: 'template not found' }

  let zip
  try {
    zip = new AdmZip(buffer)
  } catch {
    return { status: 400, error: 'Не удалось прочитать ZIP-архив' }
  }

  const entries = zip.getEntries()
  const rawConfig = findConfig(entries)
  if (!rawConfig) return { status: 400, error: 'В архиве не найден PropertyConfig JSON' }

  const filesWritten = writeProjectFiles(entries, found.project.code)
  const libraryRoot = path.resolve(publicDir(), 'media/projects', found.project.code, 'library')
  await optimizeImagesInDir(libraryRoot, { skipIfOk: true })
  const manifest = rebuildLibraryManifest(found.project.code)
  const config = {
    ...rewriteAllProjectMediaPaths(rawConfig, found.project.code),
    id: found.project.code,
  }
  const missing = missingProjectFiles(config, found.project.code)
  if (missing.length) {
    return {
      status: 400,
      error: `В архиве не найдены файлы для ${missing.length} media-путей: ${missing.slice(0, 5).join(', ')}`,
    }
  }

  await query(
    `UPDATE templates
     SET draft_config = $2::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [found.row.id, JSON.stringify(config)],
  )

  return {
    status: 200,
    project: { code: found.project.code, name: found.project.name },
    template: { code: found.row.code, name: found.row.name },
    config,
    filesWritten,
    manifestTotal: manifest.total,
  }
}

function addDirToZip(zip, root, archiveRoot) {
  zip.addFile(`${archiveRoot}/`, Buffer.alloc(0))
  if (!fs.existsSync(root)) return 0
  let count = 0
  for (const file of walkFiles(root).sort((a, b) => a.localeCompare(b))) {
    const rel = path.relative(root, file).replace(/\\/g, '/')
    zip.addLocalFile(file, path.posix.dirname(`${archiveRoot}/${rel}`))
    count += 1
  }
  return count
}

function resolveMediaFileOnDisk(root, code, srcCode, rel) {
  const candidates = [`${code}/${rel}`]
  if (srcCode && srcCode !== code) candidates.push(`${srcCode}/${rel}`)
  const projectsRoot = path.resolve(root, 'media/projects')
  for (const candidate of candidates) {
    const full = path.resolve(projectsRoot, candidate)
    if (!isInside(projectsRoot, full)) continue
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full
    } catch {
      // skip unreadable
    }
  }
  return null
}

/** Файлы, на которые ссылается конфиг и которые есть на диске (для used-only export). */
export function resolveUsedMediaFiles(code, config) {
  const root = publicDir()
  const counts = { library: 0, music: 0, tts: 0, missing: 0 }
  const files = []
  const seen = new Set()
  for (const src of collectAnyProjectMediaSrcs(config)) {
    const match = src.match(/^\/media\/projects\/([^/]+)\/(.+)$/)
    if (!match) continue
    const [, srcCode, rel] = match
    const bucket = rel.split('/')[0]
    if (bucket !== 'library' && bucket !== 'music' && bucket !== 'tts') continue
    const normalizedSrc = `/media/projects/${code}/${rel}`
    if (seen.has(normalizedSrc)) continue
    seen.add(normalizedSrc)
    const full = resolveMediaFileOnDisk(root, code, srcCode, rel)
    if (!full) {
      counts.missing += 1
      continue
    }
    files.push({ src: normalizedSrc, full, rel, bucket })
    counts[bucket] += 1
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel))
  return { files, counts }
}

function addUsedMediaToZip(zip, code, config) {
  const { files, counts } = resolveUsedMediaFiles(code, config)
  for (const bucket of ['library', 'music', 'tts']) {
    zip.addFile(`${bucket}/`, Buffer.alloc(0))
  }
  for (const file of files) {
    const zipDir = path.posix.dirname(file.rel)
    zip.addLocalFile(file.full, zipDir === '.' ? '' : zipDir)
  }
  return counts
}

export async function exportTemplateArchiveForUser(userId, projectCode, templateCode) {
  const found = await templateRowForUser(userId, projectCode, templateCode)
  if (!found) return { status: 404, error: 'template not found' }

  const raw = isPropertyConfig(found.row.draft_config)
    ? found.row.draft_config
    : isPropertyConfig(found.row.config)
      ? found.row.config
      : null
  if (!raw) return { status: 400, error: 'В шаблоне нет PropertyConfig' }

  const code = found.project.code
  // Нормализуем чужие /media/projects/{other}/… → текущий проект; файлы подтягиваем и с other.
  const config = { ...rewriteAllProjectMediaPaths(raw, code), id: code }
  const zip = new AdmZip()
  zip.addFile('property.json', Buffer.from(`${JSON.stringify(config, null, 2)}\n`, 'utf8'))
  // Резолв по исходному draft (с foreign codes), чтобы найти файлы на диске adm/plaza2/…
  const counts = addUsedMediaToZip(zip, code, raw)

  return {
    status: 200,
    fileName: `${code}-${templateCode}-template.zip`,
    buffer: zip.toBuffer(),
    counts: {
      library: counts.library,
      music: counts.music,
      tts: counts.tts,
      missing: counts.missing,
    },
  }
}
