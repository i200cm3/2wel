import { useCallback, useEffect, useState } from 'react'
import { DJINAL_PROPERTY } from '../data/djinalProperty'
import { fetchPublicLink } from '../lib/api'
import { authFetch } from '../lib/auth'
import { normalizeProperty, type PropertyConfig } from '../types/story'

/** Черновик редактора (только на этом устройстве). Плеер его не читает. */
const storageKey = (id: string) => `property-config-draft:${id}`
const legacyStorageKey = (id: string) => `property-config:${id}`

const RESERVED_PATHS = new Set([
  '',
  'editor',
  'login',
  'app',
  'register',
  'dashboard',
  'api',
  'properties',
  's',
  'media',
  'assets',
  'src',
  'node_modules',
])

export function propertyIdFromUrl() {
  const q = new URLSearchParams(window.location.search).get('property')
  return q?.trim() || 'djinal'
}

/** Короткий id из пути: /a7k */
export function shareIdFromPath(pathname = window.location.pathname): string | null {
  const part = pathname.replace(/^\/+|\/+$/g, '').split('/')[0] ?? ''
  if (!part || RESERVED_PATHS.has(part.toLowerCase())) return null
  if (!/^[a-z0-9]{3,16}$/i.test(part)) return null
  return part.toLowerCase()
}

export function generateShareId(length = 3): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length]
  return out
}

export type SharePackage = {
  id: string
  createdAt: string
  /** Имя гостя, если ссылка персональная; иначе берётся defaultGuestName */
  guestName?: string
  property: PropertyConfig
}

export function loadDraftProperty(id: string): PropertyConfig | null {
  try {
    const raw =
      localStorage.getItem(storageKey(id)) ?? localStorage.getItem(legacyStorageKey(id))
    if (!raw) return null
    const parsed = normalizeProperty(JSON.parse(raw) as PropertyConfig)
    if (!localStorage.getItem(storageKey(id)) && localStorage.getItem(legacyStorageKey(id))) {
      localStorage.setItem(storageKey(id), raw)
      localStorage.removeItem(legacyStorageKey(id))
    }
    return parsed
  } catch {
    return null
  }
}

export function saveDraftProperty(config: PropertyConfig) {
  localStorage.setItem(storageKey(config.id), JSON.stringify(config))
}

export function clearDraftProperty(id: string) {
  localStorage.removeItem(storageKey(id))
  localStorage.removeItem(legacyStorageKey(id))
}

export function downloadPropertyJson(config: PropertyConfig, filename?: string) {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename?.trim() || `${config.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function isPropertyConfig(value: unknown): value is PropertyConfig {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.brand === 'object' &&
    v.brand !== null &&
    typeof v.sequences === 'object' &&
    v.sequences !== null &&
    Array.isArray(v.flow) &&
    Array.isArray(v.branches)
  )
}

export function parsePropertyJson(raw: string): PropertyConfig {
  const data: unknown = JSON.parse(raw)
  if (!isPropertyConfig(data)) {
    throw new Error('Файл не похож на конфиг объекта')
  }
  return normalizeProperty(data)
}

export async function readPropertyJsonFile(file: File): Promise<PropertyConfig> {
  const text = await file.text()
  return parsePropertyJson(text)
}

export async function fetchPublishedProperty(id: string): Promise<PropertyConfig | null> {
  try {
    const res = await fetch(`/properties/${id}.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data: unknown = await res.json()
    if (!isPropertyConfig(data)) return null
    return normalizeProperty(data)
  } catch {
    return null
  }
}

export async function fetchSharePackage(shareId: string): Promise<SharePackage | null> {
  try {
    const res = await fetch(`/s/${encodeURIComponent(shareId)}.json?t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as SharePackage
    if (!data?.id || !isPropertyConfig(data.property)) return null
    return {
      id: data.id,
      createdAt: data.createdAt ?? '',
      guestName: typeof data.guestName === 'string' ? data.guestName : undefined,
      property: normalizeProperty(data.property),
    }
  } catch {
    return null
  }
}

export type PublishResult = {
  shareId: string
  url: string
}

async function putPropertyJson(property: PropertyConfig) {
  const normalized = normalizeProperty(property)
  if (!isPropertyConfig(normalized)) {
    throw new Error('Конфиг объекта повреждён — сохранение отменено')
  }
  const propRes = await authFetch(`/api/properties/${encodeURIComponent(normalized.id)}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized),
  })
  if (!propRes.ok) {
    const msg = await propRes.text().catch(() => propRes.statusText)
    throw new Error(msg || 'Не удалось сохранить объект')
  }
  return normalized
}

async function putSharePackage(pack: SharePackage) {
  const property = normalizeProperty(pack.property)
  if (!isPropertyConfig(property)) {
    throw new Error('Конфиг объекта повреждён — сохранение ссылки отменено')
  }
  const shareRes = await authFetch(`/api/shares/${encodeURIComponent(pack.id)}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...pack, property }),
  })
  if (!shareRes.ok) {
    const msg = await shareRes.text().catch(() => shareRes.statusText)
    throw new Error(msg || 'Не удалось сохранить ссылку')
  }
}

/**
 * Сохранение: канонический JSON + обновление текущей короткой ссылки (если есть).
 * Новую ссылку не создаёт.
 */
export async function saveProperty(config: PropertyConfig): Promise<{ url: string | null }> {
  const normalized = await putPropertyJson(config)

  if (normalized.shareId) {
    const existing = await fetchSharePackage(normalized.shareId)
    await putSharePackage({
      id: normalized.shareId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      guestName: existing?.guestName,
      property: normalized,
    })
    return { url: `/${normalized.shareId}` }
  }

  return { url: null }
}

/** Публикация: канонический JSON + новая короткая ссылка /{shareId} */
export async function publishProperty(config: PropertyConfig): Promise<PublishResult> {
  const shareId = generateShareId(3)
  const property: PropertyConfig = { ...normalizeProperty(config), shareId }

  await putPropertyJson(property)
  await putSharePackage({
    id: shareId,
    createdAt: new Date().toISOString(),
    property,
  })

  return { shareId, url: `/${shareId}` }
}

export type PropertyLoadMode = 'player' | 'editor'

export function usePropertyConfig(mode: PropertyLoadMode = 'player') {
  const [propertyId] = useState(propertyIdFromUrl)
  const [shareId] = useState(() => (mode === 'player' ? shareIdFromPath() : null))
  const [config, setConfig] = useState<PropertyConfig>(() =>
    normalizeProperty(structuredClone(DJINAL_PROPERTY)),
  )
  const [guestNameFromShare, setGuestNameFromShare] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasDraft, setHasDraft] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [publishState, setPublishState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [lastShareUrl, setLastShareUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadError(null)

      if (mode === 'player') {
        if (shareId) {
          const live = await fetchPublicLink(shareId)
          if (cancelled) return
          if (live && isPropertyConfig(live.property)) {
            setConfig(normalizeProperty(live.property))
            setGuestNameFromShare(live.guestName.trim() || null)
            setReady(true)
            return
          }
          const pack = await fetchSharePackage(shareId)
          if (cancelled) return
          if (!pack) {
            setLoadError('Ссылка не найдена или устарела')
            setReady(true)
            return
          }
          setConfig(pack.property)
          setGuestNameFromShare(pack.guestName?.trim() || null)
          setReady(true)
          return
        }
        // Без короткой ссылки — только явный ?property= (для отладки)
        const published = await fetchPublishedProperty(propertyId)
        if (cancelled) return
        if (published) {
          setConfig(published)
          setReady(true)
          return
        }
        setConfig(normalizeProperty(structuredClone(DJINAL_PROPERTY)))
        setReady(true)
        return
      }

      // editor
      const published = await fetchPublishedProperty(propertyId)
      const draft = loadDraftProperty(propertyId)
      if (cancelled) return

      if (draft) {
        setConfig(draft)
        setHasDraft(true)
        if (draft.shareId) setLastShareUrl(`/${draft.shareId}`)
        setReady(true)
        return
      }

      if (published) {
        setConfig(published)
        setHasDraft(false)
        if (published.shareId) setLastShareUrl(`/${published.shareId}`)
        setReady(true)
        return
      }

      setConfig(normalizeProperty(structuredClone(DJINAL_PROPERTY)))
      setHasDraft(false)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [propertyId, mode, shareId])

  const updateConfig = useCallback(
    (next: PropertyConfig | ((prev: PropertyConfig) => PropertyConfig)) => {
      setConfig((prev) => {
        const value = typeof next === 'function' ? next(prev) : next
        if (mode === 'editor') {
          saveDraftProperty(value)
          setHasDraft(true)
          setSaveState('idle')
          setPublishState('idle')
        }
        return value
      })
    },
    [mode],
  )

  const save = useCallback(async () => {
    setSaveState('saving')
    setSaveError(null)
    try {
      const result = await saveProperty(config)
      clearDraftProperty(config.id)
      setHasDraft(false)
      if (result.url) setLastShareUrl(result.url)
      setSaveState('saved')
      setPublishState('idle')
      return result
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : 'Ошибка сохранения')
      return null
    }
  }, [config])

  const publish = useCallback(async () => {
    setPublishState('saving')
    setPublishError(null)
    try {
      const result = await publishProperty(config)
      const next = { ...config, shareId: result.shareId }
      setConfig(next)
      clearDraftProperty(config.id)
      setHasDraft(false)
      setLastShareUrl(result.url)
      setPublishState('saved')
      setSaveState('idle')
      return result
    } catch (err) {
      setPublishState('error')
      setPublishError(err instanceof Error ? err.message : 'Ошибка публикации')
      return null
    }
  }, [config])

  const resetConfig = useCallback(async () => {
    clearDraftProperty(propertyId)
    setHasDraft(false)
    const published = await fetchPublishedProperty(propertyId)
    const next = published ?? normalizeProperty(structuredClone(DJINAL_PROPERTY))
    setConfig(next)
    setLastShareUrl(next.shareId ? `/${next.shareId}` : null)
    setSaveState('idle')
    setPublishState('idle')
  }, [propertyId])

  return {
    propertyId,
    shareId,
    config,
    guestNameFromShare,
    ready,
    loadError,
    hasDraft,
    saveState,
    publishState,
    saveError,
    publishError,
    lastShareUrl,
    updateConfig,
    save,
    publish,
    resetConfig,
  }
}
