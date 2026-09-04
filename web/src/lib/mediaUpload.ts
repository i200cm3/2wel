import type { LibraryManifest } from '../hooks/useMediaLibrary'
import { authFetch } from './auth'

export const MEDIA_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp'])
export const MEDIA_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v'])
export const DEFAULT_UPLOAD_FOLDER = 'gallery/uploads'

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
    const timer = window.setTimeout(() => resolve(null), 1500)
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

async function walkEntry(entry: FileSystemEntryLike, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await entryToFile(entry)
    if (file) out.push(file)
    return
  }
  if (entry.isDirectory && entry.createReader) {
    const children = await Promise.race([
      readAllEntries(entry.createReader()),
      new Promise<FileSystemEntryLike[]>((resolve) => {
        window.setTimeout(() => resolve([]), 1500)
      }),
    ])
    for (const child of children) await walkEntry(child, out)
  }
}

async function mediaFilesFromDataTransfer(
  dt: DataTransfer,
  accept: (file: File) => boolean,
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
  if (fromList.length && !directories.length) return fromList

  const extra: File[] = []
  await Promise.race([
    Promise.all(directories.map((entry) => walkEntry(entry, extra))),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 2000)
    }),
  ])
  const seen = new Set(fromList.map((file) => `${file.name}:${file.size}`))
  for (const file of extra.filter(accept)) {
    const key = `${file.name}:${file.size}`
    if (seen.has(key)) continue
    seen.add(key)
    fromList.push(file)
  }
  return fromList
}

export async function imageFilesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  return mediaFilesFromDataTransfer(dt, isImageFile)
}

export async function libraryFilesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  return mediaFilesFromDataTransfer(dt, isMediaFile)
}

export async function uploadMediaFile(
  projectCode: string,
  file: File,
  folder: string,
): Promise<UploadOk> {
  const res = await authFetch(`/api/projects/${encodeURIComponent(projectCode)}/media/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-folder': encodeURIComponent(folder),
    },
    body: file,
  })
  const data = (await res.json().catch(() => null)) as UploadOk | { error?: string } | null
  if (!res.ok || !data || !('ok' in data) || !data.ok) {
    throw new Error(
      (data && 'error' in data && data.error) || `Не удалось загрузить ${file.name}`,
    )
  }
  return data
}

export async function uploadMediaFiles(projectCode: string, files: File[], folder: string) {
  const srcs: string[] = []
  let manifest: LibraryManifest | null = null
  for (const file of files) {
    const result = await uploadMediaFile(projectCode, file, folder)
    srcs.push(result.src)
    manifest = result.manifest
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
