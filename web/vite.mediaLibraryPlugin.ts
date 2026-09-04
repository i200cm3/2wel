import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}

/** Парсит один диапазон `bytes=start-end`. Возвращает null, если некорректно. */
function parseRange(header: string | undefined, size: number) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null
  let start: number
  let end: number
  if (rawStart === '') {
    // суффиксный запрос: последние N байт
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start < 0 || end >= size) return null
  return { start, end }
}

function sendImage(
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  filePath: string,
) {
  const ext = path.extname(filePath).toLowerCase()
  const type = MIME_BY_EXT[ext] ?? 'application/octet-stream'
  let size = 0
  try {
    size = fs.statSync(filePath).size
  } catch {
    res.statusCode = 404
    res.end()
    return
  }

  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Accept-Ranges', 'bytes')

  const rangeHeader = req.headers['range']
  const range =
    typeof rangeHeader === 'string' ? parseRange(rangeHeader, size) : null

  if (typeof rangeHeader === 'string' && !range) {
    // Диапазон есть, но некорректный
    res.statusCode = 416
    res.setHeader('Content-Range', `bytes */${size}`)
    res.end()
    return
  }

  if (range) {
    const chunkSize = range.end - range.start + 1
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    res.setHeader('Content-Length', String(chunkSize))
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    fs.createReadStream(filePath, { start: range.start, end: range.end })
      .on('error', () => {
        if (!res.headersSent) {
          res.statusCode = 404
          res.end()
        } else {
          res.destroy()
        }
      })
      .pipe(res)
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Length', String(size))
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(filePath)
    .on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 404
        res.end()
      } else {
        res.destroy()
      }
    })
    .pipe(res)
}

function isInside(root: string, target: string) {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function servePrefix(prefix: string, diskRoot: string) {
  return (
    req: import('http').IncomingMessage,
    res: import('http').ServerResponse,
    next: () => void,
  ) => {
    const url = (req.url ?? '').split('?')[0]
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    if (!url.startsWith(prefix) || url.endsWith('/')) {
      next()
      return
    }
    let rel: string
    try {
      rel = decodeURIComponent(url.slice(prefix.length))
    } catch {
      next()
      return
    }
    const filePath = path.resolve(diskRoot, rel)
    if (!isInside(diskRoot, filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      next()
      return
    }
    sendImage(req, res, filePath)
  }
}

/**
 * Vite не подхватывает файлы, появившиеся после старта.
 * Отдаём загрузки с диска: /media/starter и /media/projects/:code/.
 */
export function mediaLibraryPlugin(): Plugin {
  return {
    name: 'media-library-upload',
    configureServer(server) {
      const publicRoot = path.resolve(server.config.root, 'public')
      server.middlewares.use(
        servePrefix('/media/starter/', path.resolve(publicRoot, 'media/starter')),
      )
      server.middlewares.use(
        servePrefix('/media/projects/', path.resolve(publicRoot, 'media/projects')),
      )
    },
  }
}
