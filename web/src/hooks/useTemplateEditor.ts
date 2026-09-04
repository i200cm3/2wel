import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createProjectLink,
  discardTemplateDraft,
  fetchLinks,
  fetchTemplateConfig,
  saveTemplateConfig,
  saveTemplateDraft,
} from '@/lib/api'
import { DJINAL_PROPERTY } from '@/data/djinalProperty'
import { isPropertyConfig } from '@/hooks/usePropertyConfig'
import { normalizeProperty, type PropertyConfig } from '@/types/story'

const DRAFT_DEBOUNCE_MS = 700
const DRAFT_RETRIES = 2

function parseConfig(value: unknown): PropertyConfig | null {
  if (!isPropertyConfig(value)) return null
  return normalizeProperty(value)
}

function backupKey(projectCode: string, templateCode: string) {
  return `template-draft-backup:${projectCode}:${templateCode}`
}

type LocalBackup = {
  config: PropertyConfig
  savedAt: number
  failed: boolean
}

function writeLocalBackup(
  projectCode: string,
  templateCode: string,
  config: PropertyConfig,
  failed: boolean,
) {
  try {
    const payload: LocalBackup = { config, savedAt: Date.now(), failed }
    localStorage.setItem(backupKey(projectCode, templateCode), JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

function readLocalBackup(projectCode: string, templateCode: string): LocalBackup | null {
  try {
    const raw = localStorage.getItem(backupKey(projectCode, templateCode))
    if (!raw) return null
    const parsed = JSON.parse(raw) as LocalBackup
    const config = parseConfig(parsed.config)
    if (!config) return null
    return { config, savedAt: Number(parsed.savedAt) || 0, failed: Boolean(parsed.failed) }
  } catch {
    return null
  }
}

function clearLocalBackup(projectCode: string, templateCode: string) {
  try {
    localStorage.removeItem(backupKey(projectCode, templateCode))
  } catch {
    /* ignore */
  }
}

export function useTemplateEditor(projectCode: string, templateCode: string) {
  const [config, setConfig] = useState<PropertyConfig>(() =>
    normalizeProperty(structuredClone(DJINAL_PROPERTY)),
  )
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasDraft, setHasDraft] = useState(false)
  const [published, setPublished] = useState(true)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [publishState, setPublishState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [lastShareUrl, setLastShareUrl] = useState<string | null>(null)

  const configRef = useRef(config)
  configRef.current = config
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipDraft = useRef(true)
  const savingDraft = useRef(false)
  const pendingValue = useRef<PropertyConfig | null>(null)

  const flushDraftTimer = () => {
    if (draftTimer.current) {
      clearTimeout(draftTimer.current)
      draftTimer.current = null
    }
  }

  const persistDraft = useCallback(
    async (value: PropertyConfig) => {
      writeLocalBackup(projectCode, templateCode, value, false)
      setDraftState('saving')
      setDraftError(null)
      let lastErr: unknown
      for (let attempt = 0; attempt <= DRAFT_RETRIES; attempt++) {
        try {
          await saveTemplateDraft(projectCode, templateCode, value)
          writeLocalBackup(projectCode, templateCode, value, false)
          setDraftState('saved')
          setDraftError(null)
          return true
        } catch (err) {
          lastErr = err
          if (attempt < DRAFT_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
          }
        }
      }
      writeLocalBackup(projectCode, templateCode, value, true)
      const message = lastErr instanceof Error ? lastErr.message : 'Не удалось сохранить черновик'
      setDraftState('error')
      setDraftError(message)
      return false
    },
    [projectCode, templateCode],
  )

  const runDraftQueue = useCallback(async () => {
    if (savingDraft.current) return
    savingDraft.current = true
    try {
      while (pendingValue.current) {
        const value = pendingValue.current
        pendingValue.current = null
        await persistDraft(value)
      }
    } finally {
      savingDraft.current = false
    }
  }, [persistDraft])

  const scheduleDraft = useCallback(
    (value: PropertyConfig) => {
      if (skipDraft.current) return
      writeLocalBackup(projectCode, templateCode, value, false)
      flushDraftTimer()
      draftTimer.current = setTimeout(() => {
        draftTimer.current = null
        pendingValue.current = value
        void runDraftQueue()
      }, DRAFT_DEBOUNCE_MS)
    },
    [projectCode, templateCode, runDraftQueue],
  )

  useEffect(() => {
    let cancelled = false
    skipDraft.current = true
    flushDraftTimer()
    setReady(false)
    setLoadError(null)
    setDraftError(null)
    setDraftState('idle')
    ;(async () => {
      try {
        const data = await fetchTemplateConfig(projectCode, templateCode)
        if (cancelled) return
        const published = parseConfig(data.config)
        const draft = parseConfig(data.draft)
        const local = readLocalBackup(projectCode, templateCode)
        let next = draft ?? published
        let usedLocalFail = false
        if (local?.failed && local.config) {
          next = local.config
          usedLocalFail = true
        }
        if (!next) {
          setLoadError('В шаблоне нет конфига презентации')
          setReady(true)
          return
        }
        setConfig(next)
        setHasDraft(Boolean(draft) || usedLocalFail)
        setPublished(data.template?.status === 'published' && !usedLocalFail)
        if (usedLocalFail) {
          setDraftState('error')
          setDraftError('Черновик не ушёл на сервер — восстановлен с этого устройства')
        } else {
          setSaveState('idle')
        }
        setPublishState('idle')
        setReady(true)
        skipDraft.current = false
        void fetchLinks(projectCode)
          .then((linksData) => {
            if (cancelled) return
            const latest = linksData.links.find((item) => item.templateCode === templateCode)
            if (latest) setLastShareUrl(latest.url)
          })
          .catch(() => undefined)
      } catch (err) {
        if (cancelled) return
        const local = readLocalBackup(projectCode, templateCode)
        if (local?.config) {
          setConfig(local.config)
          setHasDraft(true)
          setPublished(false)
          setDraftState('error')
          setDraftError('Сервер недоступен — открыт черновик с этого устройства')
          setReady(true)
          skipDraft.current = false
          return
        }
        setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить шаблон')
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
      flushDraftTimer()
    }
  }, [projectCode, templateCode])

  useEffect(() => {
    const flushNow = () => {
      if (skipDraft.current) return
      flushDraftTimer()
      pendingValue.current = configRef.current
      void runDraftQueue()
    }
    const onHide = () => flushNow()
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushNow()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [runDraftQueue])

  const updateConfig = useCallback(
    (next: PropertyConfig | ((prev: PropertyConfig) => PropertyConfig)) => {
      setConfig((prev) => {
        const value = typeof next === 'function' ? next(prev) : next
        scheduleDraft(value)
        return value
      })
      setHasDraft(true)
      setSaveState('idle')
      setPublishState('idle')
    },
    [scheduleDraft],
  )

  const retryDraft = useCallback(() => {
    pendingValue.current = configRef.current
    void runDraftQueue()
  }, [runDraftQueue])

  const save = useCallback(async () => {
    flushDraftTimer()
    pendingValue.current = null
    skipDraft.current = true
    setSaveState('saving')
    setSaveError(null)
    try {
      for (let i = 0; i < 40 && savingDraft.current; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const current = configRef.current
      await saveTemplateConfig(projectCode, templateCode, current)
      await discardTemplateDraft(projectCode, templateCode).catch(() => undefined)
      clearLocalBackup(projectCode, templateCode)
      setHasDraft(false)
      setPublished(true)
      setDraftState('idle')
      setDraftError(null)
      setSaveState('saved')
      setPublishState('idle')
      return { url: null as string | null }
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : 'Ошибка сохранения')
      return null
    } finally {
      skipDraft.current = false
    }
  }, [projectCode, templateCode])

  const publish = useCallback(async () => {
    flushDraftTimer()
    pendingValue.current = null
    skipDraft.current = true
    setPublishState('saving')
    setPublishError(null)
    try {
      // Дождаться in-flight draft PUT — иначе он после публикации вернёт старый draft_config.
      for (let i = 0; i < 40 && savingDraft.current; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const current = configRef.current
      await saveTemplateConfig(projectCode, templateCode, current)
      await discardTemplateDraft(projectCode, templateCode).catch(() => undefined)
      const created = await createProjectLink(projectCode, {
        name: current.defaultGuestName.trim() || 'Гость',
        category: templateCode,
      })
      clearLocalBackup(projectCode, templateCode)
      setHasDraft(false)
      setPublished(true)
      setDraftState('idle')
      setDraftError(null)
      setLastShareUrl(created.url)
      setPublishState('saved')
      setSaveState('idle')
      return { shareId: created.publicId, url: created.url }
    } catch (err) {
      setPublishState('error')
      setPublishError(err instanceof Error ? err.message : 'Ошибка публикации')
      return null
    } finally {
      skipDraft.current = false
    }
  }, [projectCode, templateCode])

  const resetConfig = useCallback(async () => {
    flushDraftTimer()
    skipDraft.current = true
    try {
      await discardTemplateDraft(projectCode, templateCode)
      clearLocalBackup(projectCode, templateCode)
      const data = await fetchTemplateConfig(projectCode, templateCode)
      const live = parseConfig(data.config)
      if (!live) {
        setLoadError('В шаблоне нет конфига презентации')
        return
      }
      setConfig(live)
      setHasDraft(false)
      setPublished(data.template?.status === 'published')
      setDraftState('idle')
      setDraftError(null)
      setSaveState('idle')
      setPublishState('idle')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Не удалось сбросить черновик')
    } finally {
      skipDraft.current = false
    }
  }, [projectCode, templateCode])

  return {
    config,
    ready,
    loadError,
    hasDraft,
    published,
    saveState,
    publishState,
    saveError,
    publishError,
    draftState,
    draftError,
    lastShareUrl,
    updateConfig,
    save,
    publish,
    resetConfig,
    retryDraft,
  }
}
