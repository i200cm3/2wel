/** Кэш предзагрузки: один Image на src, с decode() когда доступен. */
const cache = new Map<string, Promise<HTMLImageElement>>()

/** На мобильном сеть иногда «висит» без error/load — без таймаута плеер вечно на «Загружаем». */
const PRELOAD_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        window.clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export async function decodeImgElement(img: HTMLImageElement): Promise<void> {
  if (!img.src) return
  if (!img.complete) {
    await new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true })
      img.addEventListener('error', () => resolve(), { once: true })
    })
  }
  if (!img.naturalWidth) return
  if (typeof img.decode === 'function') {
    try {
      await img.decode()
    } catch {
      /* decode может отвергнуть уже снятый с DOM кадр */
    }
  }
}

export function preloadImage(src: string): Promise<HTMLImageElement> {
  if (!src) return Promise.reject(new Error('empty src'))
  const hit = cache.get(src)
  if (hit) return hit

  const task = withTimeout(
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => {
        const finish = () => resolve(img)
        if (typeof img.decode === 'function') {
          void img.decode().then(finish).catch(finish)
        } else {
          finish()
        }
      }
      img.onerror = () => {
        cache.delete(src)
        reject(new Error(`failed to load ${src}`))
      }
      img.src = src
    }),
    PRELOAD_TIMEOUT_MS,
    `image ${src}`,
  ).catch((err) => {
    cache.delete(src)
    throw err
  })

  cache.set(src, task)
  return task
}

export function preloadImages(srcs: readonly string[]): Promise<void> {
  const unique = [...new Set(srcs.filter(Boolean))]
  if (!unique.length) return Promise.resolve()
  return Promise.allSettled(unique.map(preloadImage)).then(() => undefined)
}

export function isImageCached(src: string): boolean {
  return cache.has(src)
}

const videoCache = new Map<string, Promise<{ video: HTMLVideoElement; aspect: number }>>()

export function preloadVideo(src: string): Promise<{ video: HTMLVideoElement; aspect: number }> {
  if (!src) return Promise.reject(new Error('empty src'))
  const hit = videoCache.get(src)
  if (hit) return hit

  const task = withTimeout(
    new Promise<{ video: HTMLVideoElement; aspect: number }>((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      video.onloadedmetadata = () => {
        const w = video.videoWidth
        const h = video.videoHeight
        resolve({ video, aspect: w && h ? w / h : 1.5 })
      }
      video.onerror = () => {
        videoCache.delete(src)
        reject(new Error(`failed to load video ${src}`))
      }
      video.src = src
    }),
    PRELOAD_TIMEOUT_MS,
    `video ${src}`,
  ).catch((err) => {
    videoCache.delete(src)
    throw err
  })

  videoCache.set(src, task)
  return task
}
