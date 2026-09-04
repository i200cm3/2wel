import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { VIEW_ASPECT, focusToViewportLayout } from '../lib/cropMath'
import { decodeImgElement, preloadImage, preloadVideo } from '../lib/preloadImages'
import { ttsPlaybackUrl } from '../lib/ttsUrl'
import { syncClipsToCues } from './editor/timelineMath'
import {
  DISSOLVE_SEC,
  EASING_CSS,
  activeCueAt,
  clipAnimSec,
  clipHoldSec,
  clipMediaKind,
  clipStartTimes,
  normalizeClip,
  type StoryClip,
  type StoryCue,
} from '../types/story'

type Props = {
  clips: StoryClip[]
  /** Титры + TTS на шкале времени блока */
  cues?: StoryCue[]
  title?: string
  /** @deprecated для превью в редакторе; в плеере используются cues */
  lines?: string[]
  onEnded: () => void
  loop?: boolean
  /** Заморозить кадр (конец блока / статичный превью в редакторе) */
  paused?: boolean
  /** Скрыть титры (когда поверх показаны кнопки) */
  hideCaptions?: boolean
  activeClipId?: string | null
  onClipChange?: (clipId: string, index: number) => void
  /** CSS background / стиль плашки под текстом */
  captionBarStyle?: CSSProperties | Record<string, string>
  /** Клик по текстам на превью → редактирование */
  editable?: boolean
  /** Сырые значения (с {name}) для редактирования */
  editTitle?: string
  editLine?: string
  editShowLine?: boolean
  onTitleChange?: (value: string) => void
  onLineChange?: (value: string) => void
  /** TTS старт/стоп — чтобы фон не замирал */
  onTtsPlayingChange?: (playing: boolean) => void
  /** Громкость озвучки 0..1 */
  ttsVolume?: number
  /** Гость выключил звук — глушим и звук клипов */
  userMuted?: boolean
  /**
   * Последний TTS перед onEnded (например menu.mp3).
   * Играет на том же audio, что cues; при cleanup не глушится.
   */
  outroTtsSrc?: string
  /** Внешний audio (живёт в Presentation, не размонтируется с слайдом) */
  ttsAudioRef?: { current: HTMLAudioElement | null }
  /** Первые кадры: done/total, чтобы гость видел ход загрузки */
  onMediaProgress?: (done: number, total: number) => void
}

function InlineEdit({
  as,
  className,
  display,
  value,
  placeholder,
  multiline,
  onChange,
}: {
  as: 'h1' | 'p'
  className: string
  display: string
  value: string
  placeholder: string
  multiline?: boolean
  onChange: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [editing])

  const empty = !display.trim()
  const Tag = as

  if (editing) {
    const shared = {
      ref: ref as never,
      className: `${className} is-editing`,
      value,
      placeholder,
      onChange: (
        e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => onChange(e.target.value),
      onBlur: () => setEditing(false),
      onClick: (e: MouseEvent) => e.stopPropagation(),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          setEditing(false)
        }
        if (!multiline && e.key === 'Enter') {
          e.preventDefault()
          setEditing(false)
        }
      },
    }
    return multiline ? (
      <textarea {...shared} rows={3} />
    ) : (
      <input type="text" {...shared} />
    )
  }

  return (
    <Tag
      className={`${className}${empty ? ' is-placeholder' : ''}`}
      role="button"
      tabIndex={0}
      title="Нажмите, чтобы изменить"
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setEditing(true)
        }
      }}
    >
      {empty ? placeholder : display}
    </Tag>
  )
}

export function StoryPlayer({
  clips,
  cues = [],
  title,
  lines,
  onEnded,
  loop = false,
  paused = false,
  hideCaptions = false,
  activeClipId = null,
  onClipChange,
  captionBarStyle,
  editable = false,
  editTitle = '',
  editLine = '',
  editShowLine = true,
  onTitleChange,
  onLineChange,
  onTtsPlayingChange,
  ttsVolume = 1,
  userMuted = false,
  outroTtsSrc,
  ttsAudioRef,
  onMediaProgress,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const internalTtsRef = useRef<HTMLAudioElement | null>(null)
  const ttsRef = ttsAudioRef ?? internalTtsRef
  const ownsTtsAudio = !ttsAudioRef
  const outroTtsSrcRef = useRef(outroTtsSrc)
  outroTtsSrcRef.current = outroTtsSrc
  const [viewAspect, setViewAspect] = useState(VIEW_ASPECT)

  const safeClips = useMemo(() => {
    const list = clips.length
      ? clips
      : [
          {
            id: 'empty',
            src: '',
            motion: 'none' as const,
            durationSec: 2,
            from: { x: 0.5, y: 0.5, scale: 1.02 },
            to: { x: 0.5, y: 0.5, scale: 1.02 },
            easing: 'ease-in-out' as const,
            transition: 'cut' as const,
          },
        ]
    const normalized = list.map(normalizeClip)
    // Cue/TTS часто длиннее клипа (после генерации) — иначе картинки уезжают вперёд титров.
    return cues.length ? syncClipsToCues(normalized, cues) : normalized
  }, [clips, cues])

  const clipsKey = safeClips
    .map(
      (c) =>
        `${c.id}:${c.src}:${c.from.x}:${c.from.y}:${c.from.scale}:${c.to.x}:${c.to.y}:${c.to.scale}:${c.durationSec}:${c.trimStartSec ?? 0}:${c.sourceDurationSec ?? ''}:${c.animSec ?? ''}:${c.easing}:${c.transition ?? 'cut'}`,
    )
    .join('|')
  const cuesKey = cues
    .map((c) => `${c.id}:${c.startSec}:${c.durationSec}:${c.text ?? ''}:${c.ttsSrc ?? ''}`)
    .join('|')

  const [index, setIndex] = useState(0)
  const [exitingIndex, setExitingIndex] = useState<number | null>(null)
  const [entering, setEntering] = useState(false)
  /** dissolve = кроссфейд; hold = предыдущий кадр под новым (без чёрного мига на cut) */
  const [exitMode, setExitMode] = useState<'dissolve' | 'hold' | null>(null)
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const [animToken, setAnimToken] = useState(0)
  /** Первый кадр (и по возможности весь блок) уже в кэше — можно стартовать таймер */
  const [mediaReady, setMediaReady] = useState(false)
  const [timelineSec, setTimelineSec] = useState(0)
  const endedRef = useRef(false)
  const onEndedRef = useRef(onEnded)
  const onClipChangeRef = useRef(onClipChange)
  const onTtsPlayingChangeRef = useRef(onTtsPlayingChange)
  const onMediaProgressRef = useRef(onMediaProgress)
  const ttsVolumeRef = useRef(ttsVolume)
  const pausedRef = useRef(paused)
  const imgElsRef = useRef(new Map<string, HTMLImageElement>())
  const videoElsRef = useRef(new Map<string, HTMLVideoElement>())
  const decodedIdsRef = useRef(new Set<string>())
  onEndedRef.current = onEnded
  onClipChangeRef.current = onClipChange
  onTtsPlayingChangeRef.current = onTtsPlayingChange
  onMediaProgressRef.current = onMediaProgress
  ttsVolumeRef.current = ttsVolume
  pausedRef.current = paused

  const notifyDecoded = (clipId: string) => {
    decodedIdsRef.current.add(clipId)
  }

  const bindClipImg = (clipId: string, el: HTMLImageElement | null) => {
    if (!el) {
      imgElsRef.current.delete(clipId)
      return
    }
    imgElsRef.current.set(clipId, el)
  }

  const bindClipVideo = (clipId: string, el: HTMLVideoElement | null) => {
    if (!el) {
      videoElsRef.current.delete(clipId)
      return
    }
    videoElsRef.current.set(clipId, el)
  }

  useLayoutEffect(() => {
    for (const clip of safeClips) {
      if (clipMediaKind(clip) === 'video') {
        const video = videoElsRef.current.get(clip.id)
        if (!video?.videoWidth) continue
        const next = video.videoWidth / video.videoHeight
        setAspects((prev) => (prev[clip.id] === next ? prev : { ...prev, [clip.id]: next }))
        notifyDecoded(clip.id)
        continue
      }
      const img = imgElsRef.current.get(clip.id)
      if (!img?.complete || !img.naturalWidth) continue
      const next = img.naturalWidth / img.naturalHeight
      setAspects((prev) => (prev[clip.id] === next ? prev : { ...prev, [clip.id]: next }))
      void decodeImgElement(img).then(() => notifyDecoded(clip.id))
    }
  }, [clipsKey, safeClips])

  useEffect(() => {
    const audio = ttsRef.current
    if (audio) audio.volume = Math.min(1, Math.max(0, ttsVolume))
  }, [ttsVolume])

  const copyRef = useRef<HTMLDivElement>(null)
  const [barHeight, setBarHeight] = useState<number | null>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0) {
        const next = w / h
        setViewAspect((prev) => (Math.abs(prev - next) < 0.0005 ? prev : next))
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Предзагрузка + decode: старт после первых кадров, остальные — в фоне
  useEffect(() => {
    let cancelled = false
    setMediaReady(false)
    decodedIdsRef.current = new Set()
    const clips = safeClips.filter((c) => c.src)
    const applyImageAspect = (clipId: string, img: HTMLImageElement) => {
      if (!img.naturalWidth) return
      const next = img.naturalWidth / img.naturalHeight
      setAspects((prev) => (prev[clipId] === next ? prev : { ...prev, [clipId]: next }))
    }
    const applyVideoAspect = (clipId: string, aspect: number) => {
      setAspects((prev) => (prev[clipId] === aspect ? prev : { ...prev, [clipId]: aspect }))
    }

    const warmClip = async (clip: StoryClip) => {
      if (clipMediaKind(clip) === 'video') {
        const { aspect } = await preloadVideo(clip.src)
        if (!cancelled) applyVideoAspect(clip.id, aspect)
        notifyDecoded(clip.id)
        return
      }
      const img = await preloadImage(clip.src)
      if (!cancelled) applyImageAspect(clip.id, img)
    }

    ;(async () => {
      const ahead = clips.slice(0, 3)
      const total = ahead.length
      if (!total) {
        onMediaProgressRef.current?.(1, 1)
        setMediaReady(true)
        return
      }
      onMediaProgressRef.current?.(0, total)
      let done = 0
      await Promise.allSettled(
        ahead.map(async (clip) => {
          try {
            await warmClip(clip)
          } catch {
            /* показываем даже если не загрузилось */
          }
          if (cancelled) return
          done += 1
          onMediaProgressRef.current?.(done, total)
        }),
      )
      if (cancelled) return
      setMediaReady(true)

      await Promise.allSettled(
        clips.slice(3).map(async (clip) => {
          try {
            await warmClip(clip)
          } catch {
            /* ignore */
          }
        }),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [clipsKey, safeClips])

  // Синхронизация playback видео с активным слайдом
  useEffect(() => {
    const activeId = safeClips[index]?.id
    for (const clip of safeClips) {
      if (clipMediaKind(clip) !== 'video') continue
      const el = videoElsRef.current.get(clip.id)
      if (!el) continue
      const isActive = clip.id === activeId
      if (!isActive || paused || activeClipId) {
        if (!el.paused) el.pause()
        continue
      }
      try {
        const trimStart = Math.max(0, clip.trimStartSec ?? 0)
        const trimEnd = trimStart + clip.durationSec
        if (el.currentTime < trimStart - 0.05 || el.currentTime >= trimEnd - 0.03 || el.ended) {
          el.currentTime = trimStart
        }
        void el.play().catch(() => {})
      } catch {
        /* ignore */
      }
    }
  }, [index, paused, activeClipId, clipsKey, safeClips, animToken])

  useEffect(() => {
    endedRef.current = false
    if (!activeClipId) {
      setIndex(0)
      setExitingIndex(null)
      setExitMode(null)
      setEntering(false)
      setAnimToken((t) => t + 1)
    }
  }, [clipsKey, activeClipId])

  useEffect(() => {
    if (!activeClipId) return
    const i = safeClips.findIndex((c) => c.id === activeClipId)
    if (i >= 0) {
      setIndex(i)
      setExitingIndex(null)
      setExitMode(null)
      setEntering(false)
      setAnimToken((t) => t + 1)
    }
  }, [activeClipId, clipsKey, safeClips])

  useEffect(() => {
    onClipChangeRef.current?.(safeClips[index]?.id ?? '', index)
  }, [index, safeClips])

  // Слайды, титры и TTS — одна шкала: clipStartTimes / cue.startSec
  useEffect(() => {
    if (activeClipId || !mediaReady) {
      const audio = ttsRef.current
      if (audio) {
        audio.pause()
        if (ownsTtsAudio) {
          audio.removeAttribute('src')
          try {
            audio.load()
          } catch {
            /* ignore */
          }
        }
      }
      onTtsPlayingChangeRef.current?.(false)
      return
    }

    // Пауза не перезапускает эффект — freeze через pausedRef (см. sleep).
    // End-buttons: paused=true, TTS outro не трогаем здесь.

    endedRef.current = false
    let cancelled = false
    let dissolveTimer = 0
    const pendingCueTimers: number[] = []
    let captionIv = 0
    let i = 0
    setIndex(0)
    setExitingIndex(null)
    setExitMode(null)
    setEntering(false)
    setAnimToken((t) => t + 1)
    setTimelineSec(0)

    const clearExit = () => {
      setExitingIndex(null)
      setExitMode(null)
      setEntering(false)
      if (holdFreeze) {
        holdFreeze = false
        seqMark = performance.now()
      }
    }

    let ttsActive = false
    let ttsWaiters: Array<() => void> = []
    /** После outro TTS cleanup не должен глушить audio — звук меню продолжает играть */
    let preserveTtsOnCleanup = false
    let seqElapsedMs = 0
    let seqMark = performance.now()
    let ttsGen = 0
    /** Инкремент при каждом playTts — предыдущий вызов завершается без pause чужого звука */
    let ttsPlayGen = 0
    /**
     * Cut: пока старый кадр сверху (ждём decode), шкалу не двигаем —
     * иначе титр/TTS следующего cue срабатывают на ещё видимом предыдущем слайде.
     */
    let holdFreeze = false
    /**
     * Потолок шкалы, пока играет TTS: если mp3 длиннее cue.durationSec,
     * слайды/титры ждут хвост фразы, а не убегают вперёд.
     */
    let ttsHoldUntilMs: number | null = null

    const nowElapsedMs = () => {
      const now = performance.now()
      if (!pausedRef.current && !holdFreeze) seqElapsedMs += now - seqMark
      seqMark = now
      if (ttsHoldUntilMs != null && seqElapsedMs > ttsHoldUntilMs) {
        seqElapsedMs = ttsHoldUntilMs
      }
      return seqElapsedMs
    }

    const flushTtsWaiters = () => {
      if (ttsActive) return
      const queue = ttsWaiters
      ttsWaiters = []
      for (const resolve of queue) resolve()
    }

    const stopTts = () => {
      const audio = ttsRef.current
      ttsPlayGen += 1
      if (!audio) return
      audio.onended = null
      audio.onerror = null
      audio.pause()
      if (ownsTtsAudio) {
        audio.removeAttribute('src')
        try {
          audio.load()
        } catch {
          /* ignore */
        }
      }
      ttsActive = false
      onTtsPlayingChangeRef.current?.(false)
      flushTtsWaiters()
    }

    const isTtsBusy = () => ttsActive

    const playTts = (src: string, opts?: { preserve?: boolean }) =>
      new Promise<void>((resolve) => {
        const audio = ttsRef.current
        if (!audio) {
          resolve()
          return
        }

        const playId = ++ttsPlayGen
        let settled = false
        let started = false
        let startTimer = 0
        let watchdog = 0
        const onEnded = () => finish('ended')
        const onError = () => finish('error')
        const finish = (reason: 'ended' | 'error' | 'cancel' = 'cancel') => {
          if (settled) return
          settled = true
          window.clearTimeout(startTimer)
          window.clearTimeout(watchdog)
          audio.removeEventListener('ended', onEnded)
          audio.removeEventListener('error', onError)
          audio.removeEventListener('playing', onPlaying)
          // Нас перебили новым playTts — не трогаем audio и ttsActive.
          if (playId !== ttsPlayGen) {
            resolve()
            return
          }
          audio.onended = null
          audio.onerror = null
          ttsActive = false
          // На native ended pause не нужен: иначе лишний stop перед размонтированием превью блока.
          if (!opts?.preserve && reason !== 'ended') {
            try {
              audio.pause()
            } catch {
              /* ignore */
            }
          }
          onTtsPlayingChangeRef.current?.(false)
          flushTtsWaiters()
          resolve()
        }

        const onPlaying = () => {
          started = true
          window.clearTimeout(startTimer)
        }

        const begin = () => {
          if (settled || cancelled || playId !== ttsPlayGen) {
            finish()
            return
          }
          if (opts?.preserve) preserveTtsOnCleanup = true
          try {
            audio.pause()
          } catch {
            /* ignore */
          }
          audio.onended = onEnded
          audio.onerror = onError
          audio.addEventListener('ended', onEnded)
          audio.addEventListener('error', onError)
          audio.addEventListener('playing', onPlaying)
          audio.muted = false
          const playbackSrc = ttsPlaybackUrl(src)
          const abs = (() => {
            try {
              return new URL(playbackSrc, window.location.origin).href
            } catch {
              return playbackSrc
            }
          })()
          // src ставим только здесь — иначе iOS-жест «размутить» затирает файл, а ended не приходит
          if (audio.src !== abs) audio.src = playbackSrc
          audio.volume = Math.min(1, Math.max(0, ttsVolumeRef.current))
          try {
            if (audio.currentTime > 0.01) audio.currentTime = 0
          } catch {
            /* ignore */
          }
          ttsActive = true
          onTtsPlayingChangeRef.current?.(true)

          // Долгая загрузка подписанного/персонального mp3 — не обрывать через 4с.
          startTimer = window.setTimeout(() => {
            if (!settled && !started && playId === ttsPlayGen) finish()
          }, 25_000)
          pendingCueTimers.push(startTimer)

          // Запасной watchdog: если ended потерялся, не висеть вечно.
          watchdog = window.setTimeout(() => {
            if (!settled && playId === ttsPlayGen) finish()
          }, 180_000)
          pendingCueTimers.push(watchdog)

          void audio.play().then(
            () => {
              started = true
              window.clearTimeout(startTimer)
            },
            () => finish(),
          )
        }

        if (pausedRef.current) {
          const poll = window.setInterval(() => {
            if (cancelled || playId !== ttsPlayGen) {
              window.clearInterval(poll)
              finish()
              return
            }
            if (!pausedRef.current) {
              window.clearInterval(poll)
              begin()
            }
          }, 80)
          pendingCueTimers.push(poll)
          return
        }
        begin()
      })

    const waitTtsIdle = () =>
      new Promise<void>((resolve) => {
        if (!isTtsBusy()) {
          resolve()
          return
        }
        ttsWaiters.push(resolve)
      })

    /** Учитывает паузу: время «замирает», пока pausedRef.current */
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const target = nowElapsedMs() + ms
        const step = () => {
          if (cancelled) {
            resolve()
            return
          }
          const left = target - nowElapsedMs()
          if (left <= 0) {
            resolve()
            return
          }
          pendingCueTimers.push(window.setTimeout(step, Math.min(48, Math.max(16, left))))
        }
        step()
      })

    /** Дождаться своей фразы на конце блока (outro / onEnded), не из‑за чужого <audio>. */
    const holdWhileTts = async () => {
      if (!ttsActive) return
      await Promise.race([waitTtsIdle(), sleep(90_000)])
    }

    /**
     * Превью блока владеет <audio>: onEnded размонтирует плеер и убивает хвост фразы.
     * В презентации audio снаружи — поэтому обрыва там не было.
     */
    const waitOwnedAudioIdle = () =>
      new Promise<void>((resolve) => {
        const audio = ttsRef.current
        if (!ownsTtsAudio || !audio || !ttsActive) {
          resolve()
          return
        }
        let settled = false
        const done = () => {
          if (settled) return
          settled = true
          audio.removeEventListener('ended', done)
          audio.removeEventListener('pause', done)
          resolve()
        }
        audio.addEventListener('ended', done)
        audio.addEventListener('pause', done)
        pendingCueTimers.push(window.setTimeout(done, 90_000))
      })

    /**
     * TTS по startSec; фразу доигрываем целиком.
     * Пока mp3 звучит дольше окна cue — шкалу держим на конце cue (слайд + титр ждут).
     * Иначе картинки убегают на несколько секунд при серии фраз.
     */
    const playSequenceTts = async () => {
      const gen = ++ttsGen
      const list = cues
        .filter((c): c is StoryCue & { ttsSrc: string } => Boolean(c.ttsSrc))
        .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
      for (const cue of list) {
        const waitMs = cue.startSec * 1000 - nowElapsedMs()
        if (waitMs > 0) await sleep(waitMs)
        if (cancelled || gen !== ttsGen) return
        ttsHoldUntilMs = Math.max(0, (cue.startSec + cue.durationSec) * 1000 - 1)
        await playTts(cue.ttsSrc)
        ttsHoldUntilMs = null
        if (cancelled || gen !== ttsGen) return
      }
    }

    const warmAhead = (from: number) => {
      for (let k = 1; k <= 3; k++) {
        const clip = safeClips[from + k]
        if (!clip?.src) continue
        if (clipMediaKind(clip) === 'video') {
          void preloadVideo(clip.src)
            .then(({ aspect }) => {
              setAspects((prev) =>
                prev[clip.id] === aspect ? prev : { ...prev, [clip.id]: aspect },
              )
              notifyDecoded(clip.id)
            })
            .catch(() => {})
          continue
        }
        void preloadImage(clip.src)
          .then(async () => {
            const el = imgElsRef.current.get(clip.id)
            if (!el) return
            await decodeImgElement(el)
            notifyDecoded(clip.id)
          })
          .catch(() => {})
      }
    }

    const afterPaint = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      })

    const waitIncomingReady = (clipId: string, timeoutMs: number) =>
      new Promise<void>((resolve) => {
        if (decodedIdsRef.current.has(clipId)) {
          resolve()
          return
        }
        let settled = false
        let poll = 0
        const finish = () => {
          if (settled) return
          settled = true
          window.clearInterval(poll)
          resolve()
        }
        pendingCueTimers.push(window.setTimeout(finish, timeoutMs))
        const img = imgElsRef.current.get(clipId)
        if (img?.complete && img.naturalWidth > 0) {
          void decodeImgElement(img).finally(() => {
            notifyDecoded(clipId)
            finish()
          })
          return
        }
        poll = window.setInterval(() => {
          if (decodedIdsRef.current.has(clipId)) finish()
        }, 32)
        pendingCueTimers.push(poll)
      })

    let revealGen = 0
    const revealIncoming = async (clipId: string | undefined) => {
      const gen = ++revealGen
      if (clipId) await waitIncomingReady(clipId, 280)
      await afterPaint()
      if (cancelled || gen !== revealGen) return
      clearExit()
    }

    const resetVideoForClip = (clip: StoryClip | undefined) => {
      if (!clip || clipMediaKind(clip) !== 'video') return
      const el = videoElsRef.current.get(clip.id)
      if (!el) return
      try {
        el.currentTime = Math.max(0, clip.trimStartSec ?? 0)
      } catch {
        /* ignore */
      }
    }

    const starts = clipStartTimes(safeClips)
    const seqEndSec = starts.length
      ? (starts[starts.length - 1] ?? 0) + clipHoldSec(safeClips[safeClips.length - 1]!)
      : 0

    const goTo = (from: number, next: number) => {
      if (from === next) return
      const incoming = safeClips[next]
      const useDissolve = incoming?.transition === 'dissolve'
      resetVideoForClip(incoming)

      if (useDissolve) {
        holdFreeze = false
        revealGen += 1
        setExitingIndex(from)
        setExitMode('dissolve')
        setIndex(next)
        setEntering(true)
        setAnimToken((t) => t + 1)
        window.clearTimeout(dissolveTimer)
        dissolveTimer = window.setTimeout(() => {
          if (!cancelled) clearExit()
        }, DISSOLVE_SEC * 1000)
      } else {
        // Держим шкалу на конце уходящего клипа, пока новый кадр не поверх.
        const clipEndMs = ((starts[from] ?? 0) + clipHoldSec(safeClips[from]!)) * 1000
        seqElapsedMs = Math.min(seqElapsedMs, Math.max(0, clipEndMs - 1))
        seqMark = performance.now()
        setTimelineSec(seqElapsedMs / 1000)
        holdFreeze = true
        setExitingIndex(from)
        setExitMode('hold')
        setEntering(false)
        setIndex(next)
        setAnimToken((t) => t + 1)
        window.clearTimeout(dissolveTimer)
        void revealIncoming(incoming?.id)
      }
      warmAhead(next)
    }

    warmAhead(0)
    const clipIndexAt = (t: number) => {
      for (let k = starts.length - 1; k >= 0; k--) {
        if (t + 0.0005 >= (starts[k] ?? 0)) return k
      }
      return 0
    }
    const ttsChainTail = playSequenceTts()

    const finishSequence = async () => {
      if (endedRef.current || cancelled) return
      await holdWhileTts()
      if (cancelled || endedRef.current) return
      await Promise.race([ttsChainTail, sleep(90_000)])
      if (cancelled || endedRef.current) return
      await waitOwnedAudioIdle()
      if (cancelled || endedRef.current) return
      endedRef.current = true
      clearExit()
      const outro = outroTtsSrcRef.current?.trim()
      if (outro) {
        await playTts(outro, { preserve: true })
        if (cancelled) return
      }
      onEndedRef.current()
    }

    const tick = () => {
      if (cancelled || endedRef.current) return
      if (holdFreeze) return
      const t = nowElapsedMs() / 1000
      setTimelineSec(t)
      const next = Math.min(clipIndexAt(t), Math.max(0, safeClips.length - 1))
      if (next !== i) {
        // Клипы уже выровнены под cue (syncClipsToCues); шкала ждёт хвост TTS (ttsHoldUntilMs).
        goTo(i, next)
        i = next
      }
      if (t + 0.001 < seqEndSec) return
      if (ttsActive) return
      if (loop) {
        ttsGen += 1
        stopTts()
        holdFreeze = false
        ttsHoldUntilMs = null
        seqElapsedMs = 0
        seqMark = performance.now()
        goTo(i, 0)
        i = 0
        setTimelineSec(0)
        void playSequenceTts()
        return
      }
      window.clearInterval(captionIv)
      void finishSequence()
    }

    tick()
    captionIv = window.setInterval(tick, 50)
    return () => {
      cancelled = true
      window.clearTimeout(dissolveTimer)
      window.clearInterval(captionIv)
      for (const id of pendingCueTimers) window.clearTimeout(id)
      ttsWaiters = []
      if (preserveTtsOnCleanup) {
        return
      }
      stopTts()
    }
  }, [clipsKey, cuesKey, loop, activeClipId, mediaReady, ownsTtsAudio])

  const liveCue = activeCueAt(cues, timelineSec)
  const cueTextVisible = liveCue?.showText !== false
  const line = editable
    ? editShowLine
      ? selectedCueText(editLine, lines)
      : null
    : cueTextVisible && liveCue?.text?.trim()
      ? liveCue.text
      : null
  const titleVisible = safeClips[index]?.showTitle !== false
  const visibleTitle = titleVisible ? title : undefined
  const hasCopy = Boolean(visibleTitle || line)
  const hasEditableCopy = editable && (titleVisible || editShowLine)
  const showCopy = !hideCaptions && (hasCopy || hasEditableCopy)

  useEffect(() => {
    const el = copyRef.current
    if (!el || hideCaptions) {
      setBarHeight(null)
      return
    }
    const update = () => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      setBarHeight(h > 0 ? h : null)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [title, line, hasCopy, hideCaptions, editable, showCopy, titleVisible, index])

  useEffect(() => {
    const phone = rootRef.current?.closest('.phone') as HTMLElement | null
    if (!phone) return
    if (barHeight) phone.style.setProperty('--caption-bar-height', `${barHeight}px`)
    else phone.style.removeProperty('--caption-bar-height')
    return () => {
      phone.style.removeProperty('--caption-bar-height')
    }
  }, [barHeight])

  return (
    <div
      className={`story${paused ? ' is-paused' : ''}`}
      ref={rootRef}
      style={{ '--dissolve-sec': `${DISSOLVE_SEC}s` } as CSSProperties}
    >
      {ownsTtsAudio ? <audio ref={internalTtsRef} preload="auto" playsInline /> : null}
      {safeClips.map((clip, i) => {
        const active = i === index
        const exiting = i === exitingIndex
        const ar = aspects[clip.id]
        const aspect = ar ?? 1.5
        const start = focusToViewportLayout(clip.from, aspect, viewAspect)
        const end = focusToViewportLayout(clip.to, aspect, viewAspect)
        // Редактор (activeClipId): статичный финальный кроп.
        // Плеер на паузе: Ken Burns замирает через animation-play-state, без рестарта.
        const editorStill = Boolean(paused && activeClipId)
        const holdCover = Boolean(exitMode === 'hold' && exitingIndex != null)
        const layout = active && !editorStill ? start : end
        const animSec = clipAnimSec(clip)
        const viewportClass = [
          'story-viewport',
          active ? 'is-active' : exiting ? 'is-exiting' : 'is-done',
          exiting && exitMode ? `is-exit-${exitMode}` : '',
          active && entering ? 'is-entering' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div key={clip.id} className={viewportClass}>
            {clip.src ? (
              clipMediaKind(clip) === 'video' ? (
                <video
                  ref={(el) => bindClipVideo(clip.id, el)}
                  src={clip.src}
                  className="story-video"
                  muted={!clip.playVideoAudio || !active || userMuted}
                  playsInline
                  preload="auto"
                  draggable={false}
                  onLoadedMetadata={(e) => {
                    const el = e.currentTarget
                    if (!el.videoWidth) return
                    const trimStart = Math.max(0, clip.trimStartSec ?? 0)
                    if (Math.abs(el.currentTime - trimStart) > 0.05) {
                      try {
                        el.currentTime = trimStart
                      } catch {
                        /* ignore */
                      }
                    }
                    const next = el.videoWidth / el.videoHeight
                    setAspects((prev) =>
                      prev[clip.id] === next ? prev : { ...prev, [clip.id]: next },
                    )
                    notifyDecoded(clip.id)
                  }}
                />
              ) : (
                <img
                  ref={(el) => bindClipImg(clip.id, el)}
                  src={clip.src}
                  alt=""
                  loading="eager"
                  decoding="async"
                  fetchPriority={active || i === index + 1 ? 'high' : 'low'}
                  className={`story-img ${
                    active && !editorStill && !holdCover && clip.motion !== 'none' ? 'motion-path' : ''
                  }`}
                  draggable={false}
                  data-anim={active && !editorStill ? animToken : 'static'}
                  onLoad={(e) => {
                    const el = e.currentTarget
                    if (!el.naturalWidth) return
                    const next = el.naturalWidth / el.naturalHeight
                    setAspects((prev) =>
                      prev[clip.id] === next ? prev : { ...prev, [clip.id]: next },
                    )
                    void decodeImgElement(el).then(() => notifyDecoded(clip.id))
                  }}
                  style={
                    {
                      left: `${layout.left}%`,
                      top: `${layout.top}%`,
                      width: `${layout.width}%`,
                      height: `${layout.height}%`,
                      '--ken-duration': `${animSec}s`,
                      '--ken-easing': EASING_CSS[clip.easing] ?? 'ease-in-out',
                      '--ken-l0': `${start.left}%`,
                      '--ken-t0': `${start.top}%`,
                      '--ken-w0': `${start.width}%`,
                      '--ken-h0': `${start.height}%`,
                      '--ken-l1': `${end.left}%`,
                      '--ken-t1': `${end.top}%`,
                      '--ken-w1': `${end.width}%`,
                      '--ken-h1': `${end.height}%`,
                    } as CSSProperties
                  }
                />
              )
            ) : null}
          </div>
        )
      })}
      {showCopy ? (
        <div
          ref={copyRef}
          className={`story-copy${editable ? ' is-editable' : ''}`}
          style={captionBarStyle as CSSProperties | undefined}
        >
          <div className="story-copy-title">
            {editable && onTitleChange && titleVisible ? (
              <InlineEdit
                as="h1"
                className="story-title-edit"
                display={visibleTitle ?? ''}
                value={editTitle}
                placeholder="Заголовок блока…"
                onChange={onTitleChange}
              />
            ) : visibleTitle ? (
              <h1>{visibleTitle}</h1>
            ) : null}
          </div>
          <div className="story-copy-captions">
            {editable && onLineChange ? (
              <InlineEdit
                as="p"
                className="story-line"
                display={line ?? ''}
                value={editLine}
                placeholder="Текст титра…"
                multiline
                onChange={onLineChange}
              />
            ) : line ? (
              <p className="story-line">{line}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function selectedCueText(editLine: string | undefined, lines: string[] | undefined) {
  return editLine || (lines?.length ? lines[0] : null) || null
}
