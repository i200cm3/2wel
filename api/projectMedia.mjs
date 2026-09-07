import fs from 'node:fs'
import path from 'node:path'
import { query } from './db.js'
import { publicDir } from './env.js'

const SHARED_MUSIC = 'media/music/ambient.mp3'
const STARTER_DIR = 'media/starter'
const STARTER_TTS_DIR = 'media/tts/starter'
const STARTER_PREFIX = '/media/starter/'
const STARTER_TTS_PREFIX = '/media/tts/starter/'
const LEGACY_LIBRARY_PREFIX = '/media/library/'
const LEGACY_GALLERY_FOLDERS = new Set(['intro', 'about', 'rooms', 'treatment', 'leisure', 'fun', 'park'])
const PUBLIC_FILE_MODE = 0o644

export function projectMusicSrc(code) {
  return `/media/projects/${code}/music/ambient.mp3`
}

export function projectTtsPrefix(code) {
  return `/media/projects/${code}/tts/`
}

async function copyFileIfMissing(from, to) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true })
  try {
    await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL)
  } catch (err) {
    if (err && err.code !== 'EEXIST') throw err
  }
}

/** Копирует дефолтную музыку в папку проекта, не перезаписывая уже лежащее. */
export async function ensureProjectMedia(code) {
  if (!code || /[^a-z0-9-]/.test(code)) return
  const root = publicDir()
  const musicFrom = path.resolve(root, SHARED_MUSIC)
  const musicTo = path.resolve(root, 'media/projects', code, 'music', 'ambient.mp3')
  if (fs.existsSync(musicFrom) && fs.statSync(musicFrom).isFile()) {
    await copyFileIfMissing(musicFrom, musicTo)
  }
}

function rewriteSrc(src, code) {
  if (typeof src !== 'string' || !src) return src
  if (src.startsWith(STARTER_PREFIX)) {
    return `/media/projects/${code}/library/gallery/${src.slice(STARTER_PREFIX.length)}`
  }
  if (src.startsWith(STARTER_TTS_PREFIX)) {
    return `${projectTtsPrefix(code)}${src.slice(STARTER_TTS_PREFIX.length)}`
  }
  if (src.startsWith(LEGACY_LIBRARY_PREFIX)) {
    return `/media/projects/${code}/library/${src.slice(LEGACY_LIBRARY_PREFIX.length)}`
  }
  const gallery = src.match(/^\/media\/([^/]+)\/(.+)$/)
  if (gallery && LEGACY_GALLERY_FOLDERS.has(gallery[1])) {
    return `/media/projects/${code}/library/gallery/${gallery[1]}/${gallery[2]}`
  }
  const tts = src.match(/^\/media\/tts\/(.+)$/)
  if (tts) return `${projectTtsPrefix(code)}${tts[1]}`
  if (src.startsWith('/media/music/')) return projectMusicSrc(code)
  return src
}

function rewriteSequence(seq, code) {
  if (!seq || typeof seq !== 'object') return seq
  const cues = Array.isArray(seq.cues)
    ? seq.cues.map((cue) => (cue?.ttsSrc ? { ...cue, ttsSrc: rewriteSrc(cue.ttsSrc, code) } : cue))
    : seq.cues
  const clips = Array.isArray(seq.clips)
    ? seq.clips.map((clip) => {
        if (!clip || typeof clip !== 'object') return clip
        const next = { ...clip }
        if (next.src) next.src = rewriteSrc(next.src, code)
        if (next.ttsSrc) next.ttsSrc = rewriteSrc(next.ttsSrc, code)
        return next
      })
    : seq.clips
  return { ...seq, cues, clips }
}

function mergeLibraryManifest(manifestPath, incoming) {
  let prevItems = []
  let prevFolders = []
  if (fs.existsSync(manifestPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (Array.isArray(data.items)) prevItems = data.items
      if (Array.isArray(data.folders)) prevFolders = data.folders
    } catch {
      prevItems = []
    }
  }
  const labels = new Map(prevFolders.map((folder) => [folder.id, folder.label]))
  const bySrc = new Map(prevItems.map((item) => [item.src, item]))
  for (const item of incoming) bySrc.set(item.src, item)
  const items = [...bySrc.values()]
  const byFolder = new Map()
  for (const item of items) {
    const list = byFolder.get(item.folder) ?? []
    list.push(item.src)
    byFolder.set(item.folder, list)
  }
  const data = {
    total: items.length,
    folders: [...byFolder.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, srcs]) => ({
        id,
        label: labels.get(id) || (id === 'gallery' ? 'Пробный шаблон' : id),
        srcs,
      })),
    items,
  }
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/** Копирует общие кадры пробного шаблона в библиотеку проекта. */
export async function copyStarterLibrary(code) {
  if (!code || /[^a-z0-9-]/.test(code)) return []
  const root = publicDir()
  const fromDir = path.resolve(root, STARTER_DIR)
  if (!fs.existsSync(fromDir) || !fs.statSync(fromDir).isDirectory()) return []
  const toDir = path.resolve(root, 'media/projects', code, 'library', 'gallery')
  await fs.promises.mkdir(toDir, { recursive: true })
  const names = fs
    .readdirSync(fromDir)
    .filter((name) => /\.(jpe?g|png|webp)$/i.test(name) && !name.startsWith('.'))
    .sort()
  const items = []
  for (const name of names) {
    const from = path.join(fromDir, name)
    const to = path.join(toDir, name)
    try {
      if (!fs.statSync(from).isFile()) continue
    } catch {
      continue
    }
    await copyFileIfMissing(from, to)
    try {
      await fs.promises.chmod(to, PUBLIC_FILE_MODE)
    } catch {
      // том может не давать chmod — файл всё равно читается
    }
    const st = fs.statSync(to)
    items.push({
      src: `/media/projects/${code}/library/gallery/${name}`,
      folder: 'gallery',
      name,
      rel: `gallery/${name}`,
      bytes: st.size,
      mtime: Math.floor(st.mtimeMs / 1000),
    })
  }
  mergeLibraryManifest(path.resolve(root, 'media/projects', code, 'library-manifest.json'), items)
  return items
}

/** Копирует озвучку пробного шаблона в TTS-папку проекта. */
export async function copyStarterTts(code) {
  if (!code || /[^a-z0-9-]/.test(code)) return []
  const root = publicDir()
  const fromDir = path.resolve(root, STARTER_TTS_DIR)
  if (!fs.existsSync(fromDir) || !fs.statSync(fromDir).isDirectory()) return []
  const toDir = path.resolve(root, 'media/projects', code, 'tts')
  await fs.promises.mkdir(toDir, { recursive: true })
  const names = fs
    .readdirSync(fromDir)
    .filter((name) => /\.(mp3|wav|ogg|m4a)$/i.test(name) && !name.startsWith('.'))
    .sort()
  const copied = []
  for (const name of names) {
    const from = path.join(fromDir, name)
    const to = path.join(toDir, name)
    try {
      if (!fs.statSync(from).isFile()) continue
    } catch {
      continue
    }
    await copyFileIfMissing(from, to)
    try {
      await fs.promises.chmod(to, PUBLIC_FILE_MODE)
    } catch {
      // том может не давать chmod — файл всё равно читается
    }
    copied.push(`${projectTtsPrefix(code)}${name}`)
  }
  return copied
}

/** Переписывает общие /media/tts, /media/music и /media/starter на пути проекта. */
export function rewriteConfigMedia(config, code) {
  if (!config || typeof config !== 'object' || !code) return config
  const sequences = {}
  for (const [id, seq] of Object.entries(config.sequences ?? {})) {
    sequences[id] = rewriteSequence(seq, code)
  }
  const musicSrc =
    typeof config.musicSrc === 'string' && config.musicSrc.trim()
      ? rewriteSrc(config.musicSrc.trim(), code)
      : projectMusicSrc(code)
  const menuTtsSrc =
    typeof config.menuTtsSrc === 'string' && config.menuTtsSrc.trim()
      ? rewriteSrc(config.menuTtsSrc.trim(), code)
      : config.menuTtsSrc
  const menus = {}
  if (config.menus && typeof config.menus === 'object') {
    for (const [id, menu] of Object.entries(config.menus)) {
      if (!menu || typeof menu !== 'object') continue
      const rawTts = menu.menuTtsSrc
      const rawBg = menu.menuBgSrc
      menus[id] = {
        ...menu,
        menuTtsSrc:
          typeof rawTts === 'string' && rawTts.trim()
            ? rewriteSrc(rawTts.trim(), code)
            : rawTts,
        menuBgSrc:
          typeof rawBg === 'string' && rawBg.trim()
            ? rewriteSrc(rawBg.trim(), code)
            : rawBg,
      }
    }
  }
  return {
    ...config,
    sequences,
    musicSrc,
    menuTtsSrc,
    ...(Object.keys(menus).length ? { menus } : {}),
  }
}

/** Применяет функцию ко всем путям озвучки в конфиге: титры, слайды и меню. */
export function mapConfigTtsSrcs(config, mapSrc) {
  if (!config || typeof config !== 'object') return config
  const map = (value) => (typeof value === 'string' && value.trim() ? mapSrc(value) : value)

  const sequences = {}
  for (const [id, seq] of Object.entries(config.sequences ?? {})) {
    if (!seq || typeof seq !== 'object') {
      sequences[id] = seq
      continue
    }
    sequences[id] = {
      ...seq,
      cues: Array.isArray(seq.cues)
        ? seq.cues.map((cue) => (cue?.ttsSrc ? { ...cue, ttsSrc: map(cue.ttsSrc) } : cue))
        : seq.cues,
      clips: Array.isArray(seq.clips)
        ? seq.clips.map((clip) => (clip?.ttsSrc ? { ...clip, ttsSrc: map(clip.ttsSrc) } : clip))
        : seq.clips,
    }
  }

  const menus = {}
  for (const [id, menu] of Object.entries(config.menus ?? {})) {
    if (!menu || typeof menu !== 'object') continue
    menus[id] = menu.menuTtsSrc ? { ...menu, menuTtsSrc: map(menu.menuTtsSrc) } : menu
  }

  return {
    ...config,
    sequences,
    ...(config.menuTtsSrc ? { menuTtsSrc: map(config.menuTtsSrc) } : {}),
    ...(Object.keys(menus).length ? { menus } : {}),
  }
}

function rewriteProjectCodeInValue(value, fromCode, toCode) {
  if (typeof value === 'string') {
    const prefix = `/media/projects/${fromCode}/`
    const next = value.startsWith(prefix) ? `/media/projects/${toCode}/${value.slice(prefix.length)}` : value
    return next
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteProjectCodeInValue(item, fromCode, toCode))
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = rewriteProjectCodeInValue(item, fromCode, toCode)
    }
    return out
  }
  return value
}

export function rewriteConfigProjectCode(config, fromCode, toCode) {
  if (!config || typeof config !== 'object' || !fromCode || !toCode || fromCode === toCode) return config
  const next = rewriteProjectCodeInValue(config, fromCode, toCode)
  if (next.id === fromCode) next.id = toCode
  return next
}

export async function renameProjectMedia(fromCode, toCode) {
  if (!fromCode || !toCode || fromCode === toCode) return
  if (/[^a-z0-9-]/.test(fromCode) || /[^a-z0-9-]/.test(toCode)) return
  const root = publicDir()
  const from = path.resolve(root, 'media/projects', fromCode)
  const to = path.resolve(root, 'media/projects', toCode)
  if (fs.existsSync(to)) {
    const err = new Error('media destination exists')
    err.code = 'EEXIST'
    throw err
  }
  if (!fs.existsSync(from)) {
    await ensureProjectMedia(toCode)
    return
  }
  await fs.promises.mkdir(path.dirname(to), { recursive: true })
  await fs.promises.rename(from, to)
}

/** Удаляет весь каталог media проекта (library, music, tts). Shared starter не трогает. */
export async function removeProjectMedia(code) {
  if (!code || /[^a-z0-9-]/.test(code)) return { ok: false, removed: false }
  const root = publicDir()
  const projectsRoot = path.resolve(root, 'media/projects')
  const projectRoot = path.resolve(projectsRoot, code)
  const rel = path.relative(projectsRoot, projectRoot)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
    return { ok: false, removed: false }
  }
  if (!fs.existsSync(projectRoot)) return { ok: true, removed: false }
  await fs.promises.rm(projectRoot, { recursive: true, force: true })
  return { ok: true, removed: true }
}

export async function isolateProjectMedia(code) {
  await ensureProjectMedia(code)
  const { rows: projects } = await query('SELECT id FROM projects WHERE code = $1', [code])
  const projectId = projects[0]?.id
  if (!projectId) return
  const { rows } = await query(
    `SELECT id, config, draft_config FROM templates WHERE project_id = $1`,
    [projectId],
  )
  for (const row of rows) {
    const config = rewriteConfigMedia(row.config, code)
    const draft = row.draft_config ? rewriteConfigMedia(row.draft_config, code) : null
    await query(
      `UPDATE templates
       SET config = $2::jsonb,
           draft_config = $3::jsonb
       WHERE id = $1`,
      [row.id, JSON.stringify(config), draft ? JSON.stringify(draft) : null],
    )
  }
}

function isInsideProject(root, target) {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Собирает пути `/media/projects/{code}/…` из произвольного JSON (config/draft). */
export function collectProjectMediaSrcs(value, code, out = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith(`/media/projects/${code}/`)) out.add(value.split('?')[0])
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProjectMediaSrcs(item, code, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectProjectMediaSrcs(item, code, out)
  }
  return out
}

export function mediaSrcsFromConfigs(configs, code) {
  const out = new Set()
  for (const config of configs) {
    if (config && typeof config === 'object') collectProjectMediaSrcs(config, code, out)
  }
  return out
}

/**
 * Файлы из candidateSrcs, которые есть на диске, лежат в media проекта
 * и не входят в keepSrcs (ссылки остальных шаблонов).
 */
export function listOrphanProjectMedia(code, candidateSrcs, keepSrcs) {
  if (!code || /[^a-z0-9-]/.test(code)) return []
  const root = publicDir()
  const projectRoot = path.resolve(root, 'media/projects', code)
  const keep = keepSrcs instanceof Set ? keepSrcs : new Set(keepSrcs ?? [])
  const orphans = []
  for (const src of candidateSrcs) {
    if (typeof src !== 'string' || !src.startsWith(`/media/projects/${code}/`)) continue
    const clean = src.split('?')[0]
    if (keep.has(clean)) continue
    const full = path.resolve(root, clean.replace(/^\/+/, ''))
    if (!isInsideProject(projectRoot, full)) continue
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) orphans.push(clean)
    } catch {
      // skip unreadable
    }
  }
  return orphans.sort((a, b) => a.localeCompare(b))
}

const PROJECT_MEDIA_BUCKETS = ['library', 'music', 'tts']

/** Все файлы library/music/tts проекта как `/media/projects/{code}/…`. */
export function listProjectMediaOnDisk(code) {
  if (!code || /[^a-z0-9-]/.test(code)) return []
  const root = publicDir()
  const projectRoot = path.resolve(root, 'media/projects', code)
  if (!fs.existsSync(projectRoot)) return []
  const out = []
  for (const bucket of PROJECT_MEDIA_BUCKETS) {
    const dir = path.join(projectRoot, bucket)
    for (const file of walkMediaFiles(dir)) {
      const rel = path.relative(projectRoot, file).replace(/\\/g, '/')
      out.push(`/media/projects/${code}/${rel}`)
    }
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/**
 * Файлы на диске, на которые не ссылается ни один из keepSrcs
 * (обычно — config+draft оставшихся шаблонов).
 */
export function listUnusedProjectMedia(code, keepSrcs) {
  return listOrphanProjectMedia(code, listProjectMediaOnDisk(code), keepSrcs)
}

function walkMediaFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) out.push(...walkMediaFiles(full))
    else if (st.isFile()) out.push(full)
  }
  return out
}

function folderLabelForManifest(id) {
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
    gallery: 'Пробный шаблон',
  }
  return labels[last] || last.replace(/-/g, ' ')
}

function rebuildLibraryManifest(code) {
  const libraryRoot = path.resolve(publicDir(), 'media/projects', code, 'library')
  const manifestPath = path.resolve(publicDir(), 'media/projects', code, 'library-manifest.json')
  const mediaExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm', '.mov', '.m4v'])
  const items = walkMediaFiles(libraryRoot)
    .filter((file) => mediaExts.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const rel = path.relative(libraryRoot, file).replace(/\\/g, '/')
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
      .map(([id, srcs]) => ({ id, label: folderLabelForManifest(id), srcs })),
    items,
  }
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

/** Удаляет только переданные пути внутри media проекта. Возвращает число удалённых. */
export function purgeProjectMediaSrcs(code, srcs) {
  if (!code || /[^a-z0-9-]/.test(code)) return { deleted: 0, srcs: [] }
  const root = publicDir()
  const projectRoot = path.resolve(root, 'media/projects', code)
  const deleted = []
  let touchedLibrary = false
  for (const src of srcs ?? []) {
    if (typeof src !== 'string' || !src.startsWith(`/media/projects/${code}/`)) continue
    const clean = src.split('?')[0]
    const full = path.resolve(root, clean.replace(/^\/+/, ''))
    if (!isInsideProject(projectRoot, full)) continue
    try {
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue
      fs.unlinkSync(full)
      deleted.push(clean)
      if (clean.includes(`/media/projects/${code}/library/`)) touchedLibrary = true
    } catch {
      // best-effort
    }
  }
  if (touchedLibrary) rebuildLibraryManifest(code)
  return { deleted: deleted.length, srcs: deleted }
}
