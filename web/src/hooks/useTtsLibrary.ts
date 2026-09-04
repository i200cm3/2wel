import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/auth'
import { ttsPlaybackUrl } from '@/lib/ttsUrl'

export type TtsManifestItem = {
  src: string
  name?: string
  durationSec?: number | null
}

export type TtsManifest = {
  files: string[]
  items?: TtsManifestItem[]
}

export type TtsLibrary = {
  files: string[]
  durations: Record<string, number>
  error: string | null
  refresh: () => void
  ensureFile: (src: string, knownSec?: number | null) => Promise<number | null>
}

/** Только metadata — без скачивания всего файла в arrayBuffer. */
function probeDurationMetadata(src: string): Promise<number | null> {
  const url = ttsPlaybackUrl(src)
  return new Promise((resolve) => {
    const audio = new Audio()
    audio.preload = 'metadata'
    let settled = false
    const finish = (sec: number | null) => {
      if (settled) return
      settled = true
      audio.onloadedmetadata = null
      audio.ondurationchange = null
      audio.onerror = null
      audio.removeAttribute('src')
      try {
        audio.load()
      } catch {
        /* ignore */
      }
      resolve(sec)
    }
    const read = () => {
      const d = audio.duration
      if (Number.isFinite(d) && d > 0) finish(d)
    }
    audio.onloadedmetadata = read
    audio.ondurationchange = read
    audio.onerror = () => finish(null)
    audio.src = url
    window.setTimeout(() => {
      const d = audio.duration
      if (Number.isFinite(d) && d > 0) finish(d)
      else finish(null)
    }, 2500)
  })
}

export function useTtsLibrary(projectCode: string): TtsLibrary {
  const [files, setFiles] = useState<string[]>([])
  const [durations, setDurations] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  /** Сразу добавить файл в список (после генерации), не дожидаясь полного refresh. */
  const ensureFile = useCallback(async (src: string, knownSec?: number | null): Promise<number | null> => {
    const clean = src.trim()
    if (!clean) return null
    setFiles((prev) => (prev.includes(clean) ? prev : [...prev, clean].sort()))
    if (knownSec != null && knownSec > 0) {
      setDurations((prev) => ({ ...prev, [clean]: knownSec }))
      return knownSec
    }
    const sec = await probeDurationMetadata(clean)
    if (sec != null) {
      setDurations((prev) => ({ ...prev, [clean]: sec }))
      return sec
    }
    return null
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!projectCode) {
      setFiles([])
      setDurations({})
      setError(null)
      return
    }
    ;(async () => {
      try {
        const res = await authFetch(
          `/api/projects/${encodeURIComponent(projectCode)}/tts?t=${Date.now()}`,
          { cache: 'no-store' },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as TtsManifest & { ok?: boolean }
        if (cancelled) return
        const fromItems = (data.items ?? []).filter((it) => it?.src)
        const list = (
          fromItems.length
            ? fromItems.map((it) => it.src)
            : Array.isArray(data.files)
              ? data.files
              : []
        ).filter(Boolean)
        setFiles(list)
        setError(null)

        const fromManifest: Record<string, number> = {}
        for (const it of fromItems) {
          const d = it.durationSec
          if (typeof d === 'number' && Number.isFinite(d) && d > 0) fromManifest[it.src] = d
        }
        if (Object.keys(fromManifest).length) {
          setDurations((prev) => ({ ...prev, ...fromManifest }))
        }

        // Длительности должны приходить с API. Fallback — только metadata, не полный файл.
        const missing = list.filter((src) => fromManifest[src] == null)
        if (!missing.length) return

        const next: Record<string, number> = { ...fromManifest }
        await Promise.all(
          missing.map(async (src) => {
            const sec = await probeDurationMetadata(src)
            if (sec != null) next[src] = sec
          }),
        )
        if (!cancelled) {
          setDurations((prev) => ({ ...prev, ...next }))
        }
      } catch (err) {
        if (cancelled) return
        setFiles([])
        setDurations({})
        setError(err instanceof Error ? err.message : 'Не удалось загрузить TTS')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tick, projectCode])

  return { files, durations, error, refresh, ensureFile }
}
