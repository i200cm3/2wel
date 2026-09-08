import type { LibraryManifest } from '../hooks/useMediaLibrary'
import { authFetch, authHeaders, clearEditorToken } from './auth'

export const MEDIA_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp'])
export const MEDIA_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v'])
export const DEFAULT_UPLOAD_FOLDER = 'gallery/uploads'

export type LibraryImportProgress = {
  phase: 'scan' | 'upload' | 'resize'
  current: number
  total: number
  fileName?: string
  percent: number
}

type UploadOk = {
  ok: true
  src: string
  folder: string
  name: string
  manifest: LibraryManifest
}

type FileSystemEntryLike = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (ok: (file: File) => void, err?: (e: Error) => void) => void
  createReader?: () => {
    readEntries: (ok: (entries: FileSystemEntryLike[]) => void, err?: (e: Error) => void) => void
  }
}

export function isImageFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (MEDIA_IMAGE_EXTS.has(ext)) return true
  return (
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    file.type === 'image/webp' ||
    file.type === 'image/jpg'
  )
}

export function isVideoFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (MEDIA_VIDEO_EXTS.has(ext)) return true
  return (
    file.type === 'video/mp4' ||
    file.type === 'video/webm' ||
    file.type === 'video/quicktime' ||
    file.type === 'video/x-m4v'
  )
}

export function isMediaFile(file: File): boolean {
  return isImageFile(file) || isVideoFile(file)
}

export function dataTransferHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false
  if (dt.files?.length) return true
  const types = [...dt.types]
  return types.includes('Files') || types.includes('application/x-moz-file')
}

type DirReader = {
  readEntries: (
    ok: (entries: FileSystemEntryLike[]) => void,
    err?: (e: Error) => void,
  ) => void
}

function readAllEntries(reader: DirReader): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntryLike[] = []
    const next = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(all)
            return
          }
          all.push(...batch)
          next()
        },
        (err) => reject(err),
      )
    }
    next()
  })
}

function entryToFile(entry: FileSystemEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) {
      resolve(null)
      return
    }
    const timer = window.setTimeout(() => resolve(null), 8000)
    entry.file(
      (file) => {
        window.clearTimeout(timer)
        resolve(file)
      },
      () => {
        window.clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

function attachRelativePath(file: File, rel: string): File {
  if (!rel || file.webkitRelativePath) return file
  try {
    Object.defineProperty(file, 'webkitRelativePath', { value: rel, configurable: true })
  } catch {
    /* ignore */
  }
  return file
}

async function walkEntry(
  entry: FileSystemEntryLike,
  out: File[],
  parentPath: string,
  onFound?: (found: number) => void,
): Promise<void> {
  const rel = parentPath ? `${parentPath}/${entry.name}` : entry.name
  if (entry.isFile) {
    const file = await entryToFile(entry)
    if (file) {
      out.push(attachRelativePath(file, rel))
      onFound?.(out.length)
    }
    return
  }
  if (entry.isDirectory && entry.createReader) {
    const children = await readAllEntries(entry.createReader())
    for (const child of children) await walkEntry(child, out, rel, onFound)
  }
}

async function mediaFilesFromDataTransfer(
  dt: DataTransfer,
  accept: (file: File) => boolean,
  onScan?: (found: number) => void,
): Promise<File[]> {
  const fromList = [...dt.files].filter(accept)
  const items = [...dt.items]
  const directories: FileSystemEntryLike[] = []
  for (const item of items) {
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
    ).webkitGetAsEntry?.()
    if (entry?.isDirectory) directories.push(entry)
  }
  if (!directories.length) {
    onScan?.(fromList.length)
    return fromList
  }

  const extra: File[] = []
  for (const entry of directories) {
    await walkEntry(entry, extra, '', (found) => onScan?.(found))
  }
  const walked = extra.filter(accept)
  if (walked.length) return walked
  onScan?.(fromList.length)
  return fromList
}

export async function imageFilesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  return mediaFilesFromDataTransfer(dt, isImageFile)
}

export async function libraryFilesFromDataTransfer(
  dt: DataTransfer,
  onScan?: (found: number) => void,
): Promise<File[]> {
  return mediaFilesFromDataTransfer(dt, isMediaFile, onScan)
}

export function libraryImportPercent(fileIndex: number, fileCount: number, fileShare: number): number {
  if (fileCount <= 0) return 0
  const share = Math.min(1, Math.max(0, fileShare))
  const raw = ((fileIndex + share) / fileCount) * 100
  if (fileIndex + share >= fileCount) return 100
  return Math.min(99, Math.round(raw))
}

export async function uploadMediaFile(
  projectCode: string,
  file: File,
  folder: string,
  onProgress?: (info: { phase: 'upload' | 'resize'; loaded: number; total: number }) => void,
): Promise<UploadOk> {
  const resizing = isImageFile(file)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/projects/${encodeURIComponent(projectCode)}/media/upload`)
    xhr.withCredentials = true
    const headers = authHeaders({
      'Content-Type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-folder': encodeURIComponent(folder),
    })
    for (const [key, value] of headers) xhr.setRequestHeader(key, value)
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : file.size
      onProgress?.({ phase: 'upload', loaded: event.loaded, total })
    }
    xhr.upload.onload = () => {
      onProgress?.({
        phase: resizing ? 'resize' : 'upload',
        loaded: file.size,
        total: file.size,
      })
    }
    xhr.onerror = () => reject(new Error('Сеть недоступна'))
    xhr.onload = () => {
      if (xhr.status === 401) clearEditorToken()
      let data: UploadOk | { error?: string } | null = null
      try {
        data = JSON.parse(xhr.responseText || 'null') as UploadOk | { error?: string } | null
      } catch {
        data = null
      }
      if (xhr.status < 200 || xhr.status >= 300 || !data || !('ok' in data) || !data.ok) {
        reject(
          new Error(
            (data && 'error' in data && data.error) || `Не удалось загрузить ${file.name}`,
          ),
        )
        return
      }
      resolve(data)
    }
    xhr.send(file)
  })
}

export async function uploadMediaFiles(
  projectCode: string,
  files: File[],
  folder: string,
  onProgress?: (progress: LibraryImportProgress) => void,
) {
  const srcs: string[] = []
  let manifest: LibraryManifest | null = null
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    const result = await uploadMediaFile(projectCode, file, folder, (part) => {
      const uploaded = part.total > 0 ? part.loaded / part.total : 0
      const share = part.phase === 'resize' ? 0.92 : uploaded * 0.7
      onProgress?.({
        phase: part.phase,
        current: i + 1,
        total: files.length,
        fileName: file.name,
        percent: libraryImportPercent(i, files.length, share),
      })
    })
    srcs.push(result.src)
    manifest = result.manifest
    onProgress?.({
      phase: isImageFile(file) ? 'resize' : 'upload',
      current: i + 1,
      total: files.length,
      fileName: file.name,
      percent: libraryImportPercent(i, files.length, 1),
    })
  }
  return { srcs, manifest }
}

export async function deleteMediaFile(projectCode: string, src: string) {
  const res = await authFetch(
    `/api/projects/${encodeURIComponent(projectCode)}/media/file?src=${encodeURIComponent(src)}`,
    {
      method: 'DELETE',
    },
  )
  const data = (await res.json().catch(() => null)) as
    | { ok: true; src: string; manifest: LibraryManifest }
    | { error?: string }
    | null
  if (!res.ok || !data || !('ok' in data) || !data.ok) {
    throw new Error((data && 'error' in data && data.error) || 'Не удалось удалить файл')
  }
  return data
}

/** Длительность видео по URL (сек) или null. */
export function probeVideoDuration(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const done = (value: number | null) => {
      video.removeAttribute('src')
      try {
        video.load()
      } catch {
        /* ignore */
      }
      resolve(value)
    }
    const timer = window.setTimeout(() => done(null), 8000)
    video.onloadedmetadata = () => {
      window.clearTimeout(timer)
      const d = video.duration
      done(Number.isFinite(d) && d > 0 ? d : null)
    }
    video.onerror = () => {
      window.clearTimeout(timer)
      done(null)
    }
    video.src = src
  })
}
