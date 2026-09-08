import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ChevronRight, LayoutGrid, Play, Volume2, VolumeX } from 'lucide-react'
import { fillName, fillNameOptional, openMenuHref, resolveMenuLinkHref, whatsAppHref } from '../content'
import { useGuestName } from '../hooks/useGuestName'
import { enterPresentationFullscreen, syncVisualViewportVars } from '../lib/fullscreen'
import { trackPublicEvent } from '../lib/api'
import { preloadImages } from '../lib/preloadImages'
import { ttsPlaybackUrl } from '../lib/ttsUrl'
import type { EndButton, MenuLink, PropertyConfig, ViewOrientation } from '../types/story'
import {
  captionBarStyle,
  clipHoldSec,
  endButtonsGoStraightToMenu,
  getDefaultMenuId,
  normalizeClip,
  normalizeTheme,
  parseMenuLinkHref,
  resolveMenu,
  resolveReturnMenuId,
  withoutDisabledBlocks,
  type StorySequence,
} from '../types/story'
import { backgroundMusicSrc, syncClipsToCues } from './editor/timelineMath'
import { MenuScreen } from './MenuScreen'
import { PlayerLoading } from './PlayerLoading'
import { StoryPlayer, type PlaybackProgress } from './StoryPlayer'

/** «Далее» появляется чуть позже старта блока — не перекрывает первый кадр. */
const NEXT_BTN_DELAY_MS = 2500

/** Длительность блока как в плеере (клипы, выровненные под cues). */
function playbackBlockDurationSec(seq: StorySequence | undefined): number {
  if (!seq?.clips.length) return 0.8
  const normalized = seq.clips.map(normalizeClip)
  const cues = seq.cues ?? []
  const clips = cues.length ? syncClipsToCues(normalized, cues) : normalized
  const dur = clips.reduce((sum, c) => sum + clipHoldSec(c), 0)
  return Math.max(0.8, dur)
}

type Phase = 'flow' | 'menu' | 'sequence'

type Props = {
  property: PropertyConfig
  /** Имя из share-пакета (без имени в URL) */
  guestNameOverride?: string
  /** Короткий id ссылки — для событий аналитики */
  publicId?: string | null
  /** Превью в конструкторе: без fullscreen и без захвата всей страницы */
  embedded?: boolean
}

function orientationFromSearch(themeOrientation: ViewOrientation): ViewOrientation {
  const q = new URLSearchParams(window.location.search).get('orientation')
  if (q === 'landscape' || q === 'portrait') return q
  return themeOrientation
}


export function Presentation({ property: rawProperty, guestNameOverride, publicId, embedded }: Props) {
  const property = useMemo(() => withoutDisabledBlocks(rawProperty), [rawProperty])
  const guestName = useGuestName(guestNameOverride ?? property.defaultGuestName)
  const [phase, setPhase] = useState<Phase>('flow')
  const [flowIndex, setFlowIndex] = useState(0)
  const [sequenceId, setSequenceId] = useState<string | null>(null)
  const [activeMenuId, setActiveMenuId] = useState(() => getDefaultMenuId(property))
  const [showEndButtons, setShowEndButtons] = useState(false)
  const [soundArmed, setSoundArmed] = useState(false)
  const [userPaused, setUserPaused] = useState(false)
  const [userMuted, setUserMuted] = useState(false)
  const [mediaWarm, setMediaWarm] = useState({ done: 0, total: 0 })
  const [mediaReady, setMediaReady] = useState(false)
  const [playbackProgress, setPlaybackProgress] = useState<PlaybackProgress | null>(null)
  const [skipRequest, setSkipRequest] = useState(0)
  const [showNextBtn, setShowNextBtn] = useState(false)
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null)
  const ttsUnlockedRef = useRef(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const soundArmedRef = useRef(false)
  const userPausedRef = useRef(false)
  const musicVolRef = useRef(0)

  const flowSeqId = property.flow[flowIndex]
  const flowSeq = flowSeqId ? property.sequences[flowSeqId] : undefined
  const branchSeq = sequenceId ? property.sequences[sequenceId] : undefined
  const theme = normalizeTheme(property.theme)
  const isLandscape = orientationFromSearch(theme.orientation) === 'landscape'
  const musicVol = userMuted ? 0 : theme.musicVolume
  const ttsVol = userMuted ? 0 : theme.ttsVolume
  const musicSrc = backgroundMusicSrc(property.id, property.musicSrc)

  soundArmedRef.current = soundArmed
  userPausedRef.current = userPaused
  musicVolRef.current = musicVol

  const track = useCallback(
    (type: 'autoplay' | 'menu' | 'whatsapp' | 'topic' | 'contact', topicOrChannel?: string) => {
      if (!publicId) return
      if (type === 'topic') {
        trackPublicEvent(publicId, 'topic', { topic: topicOrChannel })
        return
      }
      if (type === 'contact') {
        trackPublicEvent(publicId, 'contact', { channel: topicOrChannel })
        return
      }
      trackPublicEvent(publicId, type)
    },
    [publicId],
  )

  const activeSeq = useMemo(() => {
    if (phase === 'flow') return flowSeq
    if (phase === 'sequence') return branchSeq
    return undefined
  }, [phase, flowSeq, branchSeq])

  const endButtons = activeSeq?.endButtons
  const activeMenu = useMemo(
    () => resolveMenu(property, activeMenuId),
    [property, activeMenuId],
  )

  /** Какой TTS включить на текущем заходе в меню (firstOnly — только первый раз за сессию). */
  const [menuVisitTtsSrc, setMenuVisitTtsSrc] = useState<string | undefined>()
  const menuTtsPlayedRef = useRef(false)

  useEffect(() => {
    menuTtsPlayedRef.current = false
    setMenuVisitTtsSrc(undefined)
  }, [property.id, publicId, guestName])

  useEffect(() => {
    setActiveMenuId((cur) =>
      property.menus?.[cur] ? cur : getDefaultMenuId(property),
    )
  }, [property])

  useEffect(() => {
    if (embedded) return
    const prev = document.title
    const name = property.brand.fullName?.trim() || property.brand.name?.trim()
    if (name) document.title = name
    return () => {
      document.title = prev
    }
  }, [embedded, property.brand.fullName, property.brand.name])

  useEffect(() => {
    if (embedded) return
    const root = document.documentElement
    root.classList.add('is-player-presentation')
    root.classList.toggle('is-landscape-presentation', isLandscape)
    return () => {
      root.classList.remove(
        'is-player-presentation',
        'is-landscape-presentation',
        'fs-active',
      )
    }
  }, [embedded, isLandscape])

  useEffect(() => {
    const onFs = () => {
      const active = Boolean(
        document.fullscreenElement ||
          (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement,
      )
      document.documentElement.classList.toggle('fs-active', active)
    }
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('webkitfullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('webkitfullscreenchange', onFs)
    }
  }, [])

  /** Фон часто глохнет после unlock TTS / смены src — дожимаем play, пока сессия активна. */
  const kickMusic = useCallback(() => {
    const music = musicRef.current
    if (!music || !soundArmedRef.current || userPausedRef.current) return
    music.volume = musicVolRef.current
    if (music.paused) void music.play().catch(() => {})
  }, [])

  const armSound = useCallback(() => {
    const resumeMusic = () => {
      const music = musicRef.current
      if (!music) return
      music.volume = musicVolRef.current
      void music.play().catch(() => {})
    }

    // iOS/Android: каждый <audio> нужно «размутить» в жесте, иначе TTS с таймера молчит.
    // Тихий data-URI + volume=0 — без гонки с реальным cue (cleanup только если src ещё silent).
    // Важно: silent play на TTS часто прерывает уже запущенный фон — поэтому музыку
    // стартуем/дожимаем после unlock, иначе intro без озвучки идёт в тишине.
    const tts = ttsAudioRef.current
    let unlockingTts = false
    if (tts && !ttsUnlockedRef.current) {
      ttsUnlockedRef.current = true
      const srcNow = tts.getAttribute('src') || ''
      const hasRealSrc = Boolean(srcNow) && !srcNow.startsWith('data:')
      if (hasRealSrc) {
        tts.muted = false
        unlockingTts = true
        void tts.play().finally(() => {
          resumeMusic()
        })
      } else {
        const silent =
          'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
        unlockingTts = true
        tts.volume = 0
        tts.src = silent
        void tts.play().finally(() => {
          try {
            if (tts.src.startsWith('data:')) {
              tts.pause()
              tts.removeAttribute('src')
              tts.load()
            }
          } catch {
            /* ignore */
          }
          resumeMusic()
        })
      }
    }

    resumeMusic()
    if (unlockingTts) {
      window.setTimeout(resumeMusic, 0)
      window.setTimeout(resumeMusic, 120)
      window.setTimeout(resumeMusic, 320)
    }

    if (!soundArmed) setSoundArmed(true)
    setUserPaused(false)
    if (!embedded) {
      void enterPresentationFullscreen(
        stageRef.current,
        isLandscape ? 'landscape' : 'portrait',
      )
    }
  }, [soundArmed, isLandscape, embedded])

  useEffect(() => {
    const music = musicRef.current
    const tts = ttsAudioRef.current
    if (!music) return
    music.volume = musicVol
    if (!soundArmed) return
    if (userPaused) {
      music.pause()
      tts?.pause()
      return
    }
    kickMusic()
    const onReady = () => kickMusic()
    music.addEventListener('canplay', onReady)
    music.addEventListener('loadeddata', onReady)
    if (
      phase !== 'menu' &&
      tts &&
      tts.src &&
      tts.paused &&
      tts.currentTime > 0 &&
      !tts.ended
    ) {
      void tts.play().catch(() => {})
    }
    return () => {
      music.removeEventListener('canplay', onReady)
      music.removeEventListener('loadeddata', onReady)
    }
  }, [musicVol, soundArmed, userPaused, phase, musicSrc, kickMusic])

  const ensureMusicPlaying = useCallback(() => {
    kickMusic()
  }, [kickMusic])

  const startPresentation = useCallback(() => {
    armSound()
  }, [armSound])

  const togglePause = useCallback(() => {
    if (!soundArmed) {
      armSound()
      return
    }
    setUserPaused((p) => {
      const next = !p
      const music = musicRef.current
      if (music) {
        if (next) music.pause()
        else {
          music.volume = musicVol
          void music.play().catch(() => {})
        }
      }
      return next
    })
  }, [soundArmed, armSound, musicVol])

  const toggleMute = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    setUserMuted((m) => !m)
  }, [])

  useEffect(() => {
    if (embedded) return
    syncVisualViewportVars()
    const onResize = () => syncVisualViewportVars()
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('scroll', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('scroll', onResize)
    }
  }, [embedded])

  const goMenu = useCallback(
    (menuId?: string | null) => {
      const audio = ttsAudioRef.current
      if (audio) {
        audio.onended = null
        audio.onerror = null
        audio.pause()
        try {
          audio.currentTime = 0
        } catch {
          /* ignore */
        }
      }
      setSequenceId(null)
      setShowEndButtons(false)
      const nextMenuId =
        menuId && property.menus?.[menuId] ? menuId : getDefaultMenuId(property)
      const menu = resolveMenu(property, nextMenuId)
      const src = menu.menuTtsSrc?.trim() || undefined
      const firstOnly = menu.menuTtsFirstOnly !== false
      let visitTts: string | undefined
      if (src) {
        if (!firstOnly || !menuTtsPlayedRef.current) {
          visitTts = src
          if (firstOnly) menuTtsPlayedRef.current = true
        }
      }
      setMenuVisitTtsSrc(visitTts)
      setActiveMenuId(nextMenuId)
      if (phase === 'flow' && flowIndex + 1 >= property.flow.length) {
        track('autoplay')
      }
      if (phase !== 'menu') track('menu')
      setPhase('menu')
    },
    [phase, flowIndex, property, track],
  )

  const playSequence = useCallback(
    (id: string) => {
      armSound()
      const audio = ttsAudioRef.current
      if (audio) {
        audio.pause()
        try {
          audio.currentTime = 0
        } catch {
          /* ignore */
        }
      }
      setShowEndButtons(false)
      setSequenceId(id)
      setPhase('sequence')
      track('topic', id)
    },
    [armSound, track],
  )

  const advanceFlow = useCallback(() => {
    const next = flowIndex + 1
    if (next >= property.flow.length) {
      goMenu(getDefaultMenuId(property))
      return
    }
    setShowEndButtons(false)
    setFlowIndex(next)
  }, [flowIndex, property, goMenu])

  const openContact = useCallback(() => {
    armSound()
    track('whatsapp')
    track('contact', 'whatsapp')
    const href = whatsAppHref(guestName, property)
    openMenuHref(href)
  }, [armSound, guestName, property, track])

  const openMenuLink = useCallback(
    (link: MenuLink) => {
      armSound()
      const href = resolveMenuLinkHref(link.href, guestName, property)
      if (!href) return
      const channel = parseMenuLinkHref(link.href).kind
      track('contact', channel)
      if (channel === 'whatsapp') track('whatsapp')
      openMenuHref(href)
    },
    [armSound, guestName, property, track],
  )

  const filledTitle = fillNameOptional(activeSeq?.title, guestName)
  const filledCues = useMemo(() => {
    const list = activeSeq?.cues ?? []
    return list.map((c) => ({
      ...c,
      text: c.text ? fillName(c.text, guestName) : c.text,
    }))
  }, [activeSeq?.cues, guestName])

  const onSequenceEnded = useCallback(() => {
    const defaultMenu = getDefaultMenuId(property)
    // Автопоказ: всегда дальше по flow или в меню — без оверлея endButtons на about.
    if (phase === 'flow') {
      if (flowIndex + 1 < property.flow.length) {
        advanceFlow()
        return
      }
      goMenu(
        endButtonsGoStraightToMenu(endButtons)
          ? resolveReturnMenuId(endButtons, defaultMenu)
          : defaultMenu,
      )
      return
    }
    if (endButtonsGoStraightToMenu(endButtons)) {
      goMenu(resolveReturnMenuId(endButtons, defaultMenu))
      return
    }
    if (endButtons?.length) {
      setShowEndButtons(true)
      return
    }
    goMenu(defaultMenu)
  }, [endButtons, phase, flowIndex, property, advanceFlow, goMenu])

  const onEndButton = useCallback(
    (btn: EndButton) => {
      armSound()
      const { target } = btn
      if (target.kind === 'next') {
        if (phase === 'flow') advanceFlow()
        else goMenu()
        return
      }
      if (target.kind === 'menu') {
        goMenu(target.menuId)
        return
      }
      if (target.kind === 'contact') {
        openContact()
        return
      }
      if (target.kind === 'sequence') {
        playSequence(target.sequenceId)
      }
    },
    [armSound, phase, advanceFlow, goMenu, openContact, playSequence],
  )

  useEffect(() => {
    setShowEndButtons(false)
    setUserPaused(false)
    setPlaybackProgress(null)
    setShowNextBtn(false)
    setSkipRequest(0)
  }, [phase, flowIndex, sequenceId])

  useEffect(() => {
    if (phase === 'menu' || showEndButtons || !soundArmed || userPaused) {
      setShowNextBtn(false)
      return
    }
    const timer = window.setTimeout(() => setShowNextBtn(true), NEXT_BTN_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [phase, flowIndex, sequenceId, showEndButtons, soundArmed, userPaused])

  const skipAhead = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    setUserPaused(false)
    setSkipRequest((n) => n + 1)
  }, [])

  /** Полоски = блоки flow; ширина ∝ длительности → скорость заполнения ровная. */
  const blockProgressUi = useMemo(() => {
    if (phase === 'menu' || showEndButtons) return null

    const withinBlock = (() => {
      if (!playbackProgress) return 0
      if (playbackProgress.durationSec > 0) {
        return Math.min(
          1,
          Math.max(0, playbackProgress.timelineSec / playbackProgress.durationSec),
        )
      }
      if (playbackProgress.clipCount <= 0) return 0
      return Math.min(
        1,
        (playbackProgress.clipIndex + playbackProgress.clipProgress) /
          playbackProgress.clipCount,
      )
    })()

    if (phase === 'flow') {
      const weights = property.flow.map((id) =>
        playbackBlockDurationSec(property.sequences[id]),
      )
      const count = weights.length
      if (count <= 0) return null
      return {
        count,
        index: flowIndex,
        progress: withinBlock,
        weights,
        label: `Блок ${flowIndex + 1} из ${count}`,
      }
    }
    if (phase === 'sequence') {
      return {
        count: 1,
        index: 0,
        progress: withinBlock,
        weights: [1],
        label: 'Прогресс блока',
      }
    }
    return null
  }, [
    phase,
    showEndButtons,
    property.flow,
    property.sequences,
    flowIndex,
    playbackProgress,
  ])

  useEffect(() => {
    const ordered: string[] = []
    const seen = new Set<string>()
    const push = (src?: string) => {
      if (!src || seen.has(src)) return
      seen.add(src)
      ordered.push(src)
    }
    for (const id of property.flow) {
      for (const clip of property.sequences[id]?.clips ?? []) push(clip.src)
    }
    for (const menu of Object.values(property.menus ?? {})) {
      if (menu.menuBgSrc) push(menu.menuBgSrc)
      for (const branch of menu.branches) {
        for (const clip of property.sequences[branch.sequenceId]?.clips ?? []) push(clip.src)
      }
    }
    for (const seq of Object.values(property.sequences)) {
      for (const clip of seq.clips) push(clip.src)
    }
    void preloadImages(ordered)

    const tts = new Set<string>()
    for (const seq of Object.values(property.sequences)) {
      for (const cue of seq.cues ?? []) {
        if (cue.ttsSrc) tts.add(cue.ttsSrc)
      }
      for (const clip of seq.clips) {
        if (clip.ttsSrc) tts.add(clip.ttsSrc)
      }
    }
    for (const menu of Object.values(property.menus ?? {})) {
      if (menu.menuTtsSrc) tts.add(menu.menuTtsSrc)
    }
    for (const src of tts) {
      const a = new Audio()
      a.preload = 'auto'
      a.src = ttsPlaybackUrl(src)
    }
  }, [property])

  useEffect(() => {
    const ids: string[] = []
    if (phase === 'flow') {
      const nextId = property.flow[flowIndex + 1]
      if (nextId) ids.push(nextId)
    }
    if (phase === 'menu') {
      for (const b of activeMenu.branches) ids.push(b.sequenceId)
    }
    const srcs = ids.flatMap((id) =>
      (property.sequences[id]?.clips ?? []).map((c) => c.src).filter(Boolean),
    )
    void preloadImages(srcs)
  }, [phase, flowIndex, property, activeMenu.branches])

  const hasPlayableFlow = property.flow.some(
    (id) => (property.sequences[id]?.clips?.length ?? 0) > 0,
  )

  return (
    <div
      ref={stageRef}
      className={`app is-player${isLandscape ? ' is-landscape' : ''}${embedded ? ' is-embedded' : ''}`}
      style={captionBarStyle(property.theme)}
    >
      <audio
        ref={musicRef}
        src={musicSrc}
        loop
        preload="auto"
        playsInline
        onError={() => {
          /* без чужого эмбиента: тишина лучше, чем музыка другого объекта */
        }}
      />
      <audio ref={ttsAudioRef} preload="auto" playsInline />
      <div className="phone">
        {phase !== 'menu' && activeSeq && (
          <>
            <StoryPlayer
              key={`${phase}-${phase === 'flow' ? flowIndex : sequenceId}-${isLandscape ? 'land' : 'port'}`}
              clips={activeSeq.clips}
              cues={filledCues}
              title={filledTitle}
              captionBarStyle={captionBarStyle(property.theme)}
              paused={showEndButtons || !soundArmed || userPaused}
              hideCaptions={showEndButtons}
              onEnded={onSequenceEnded}
              onTtsPlayingChange={() => ensureMusicPlaying()}
              ttsVolume={ttsVol}
              userMuted={userMuted}
              ttsAudioRef={ttsAudioRef}
              skipRequest={skipRequest}
              onPlaybackProgress={setPlaybackProgress}
              onMediaProgress={(done, total) => {
                setMediaWarm({ done, total })
                const ready = total > 0 ? done >= total : true
                setMediaReady(ready)
                // После прогрева кадров / remount блока снова дожимаем фон
                // (не ждём первую озвучку — intro часто без TTS).
                if (ready) ensureMusicPlaying()
              }}
            />
            {soundArmed && blockProgressUi ? (
              <div
                className="player-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={blockProgressUi.count}
                aria-valuenow={blockProgressUi.index + 1}
                aria-label={blockProgressUi.label}
              >
                {Array.from({ length: blockProgressUi.count }, (_, i) => {
                  const fill =
                    i < blockProgressUi.index
                      ? 1
                      : i === blockProgressUi.index
                        ? blockProgressUi.progress
                        : 0
                  const weight = blockProgressUi.weights[i] ?? 1
                  return (
                    <div
                      key={i}
                      className="player-progress-seg"
                      style={{ flexGrow: weight }}
                    >
                      <div
                        className="player-progress-fill"
                        style={{ transform: `scaleX(${fill})` }}
                      />
                    </div>
                  )
                })}
              </div>
            ) : null}
            {showEndButtons && endButtons?.length ? (
              <div className="end-buttons" role="dialog" aria-label="Дальше">
                <div className="end-buttons-inner">
                  {endButtons.map((btn) => (
                    <button
                      key={btn.id}
                      type="button"
                      className={
                        btn.target.kind === 'contact' ? 'menu-contact' : 'menu-btn'
                      }
                      onClick={() => onEndButton(btn)}
                    >
                      {fillName(btn.label, guestName)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        {phase === 'menu' && (
          <MenuScreen
            brandName={property.brand.fullName}
            guestName={guestName}
            branches={activeMenu.branches}
            onSelect={(id) => {
              const branch = activeMenu.branches.find((b) => b.id === id)
              if (branch) playSequence(branch.sequenceId)
            }}
            onLink={openMenuLink}
            menuCopy={activeMenu.menuCopy}
            menuTheme={activeMenu.menuTheme}
            menuLinks={activeMenu.menuLinks}
            bgSrc={activeMenu.menuBgSrc}
            ttsSrc={menuVisitTtsSrc}
            ttsVolume={ttsVol}
            ttsAudioRef={ttsAudioRef}
          />
        )}

        {phase === 'menu' && soundArmed ? (
          <div className="player-corner-actions">
            <button
              type="button"
              className="player-corner-btn"
              onClick={toggleMute}
              aria-label={userMuted ? 'Включить звук' : 'Выключить звук'}
              title={userMuted ? 'Включить звук' : 'Выключить звук'}
              aria-pressed={userMuted}
            >
              {userMuted ? (
                <VolumeX size={22} strokeWidth={2} aria-hidden />
              ) : (
                <Volume2 size={22} strokeWidth={2} aria-hidden />
              )}
            </button>
          </div>
        ) : null}

        {phase !== 'menu' && !showEndButtons ? (
          !hasPlayableFlow && !embedded ? (
            <div className="start-gate" role="status">
              <p className="start-gate-message">Презентация ещё без кадров</p>
            </div>
          ) : !embedded && !soundArmed && !mediaReady ? (
            <PlayerLoading
              overlay
              label={
                mediaWarm.total
                  ? `Загружаем кадры ${mediaWarm.done} из ${mediaWarm.total}`
                  : 'Загружаем кадры'
              }
              value={
                mediaWarm.total
                  ? Math.round((mediaWarm.done / mediaWarm.total) * 100)
                  : null
              }
            />
          ) : !soundArmed ? (
            <div className="start-gate" role="dialog" aria-label="Начать">
              <button
                type="button"
                className="start-gate-icon-btn"
                onClick={startPresentation}
                aria-label="Смотреть"
              >
                <Play size={48} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ) : userPaused ? (
            <div className="start-gate" role="dialog" aria-label="Пауза">
              <div className="player-corner-actions has-progress">
                <button
                  type="button"
                  className="player-corner-btn"
                  onClick={toggleMute}
                  aria-label={userMuted ? 'Включить звук' : 'Выключить звук'}
                  title={userMuted ? 'Включить звук' : 'Выключить звук'}
                  aria-pressed={userMuted}
                >
                  {userMuted ? (
                    <VolumeX size={22} strokeWidth={2} aria-hidden />
                  ) : (
                    <Volume2 size={22} strokeWidth={2} aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  className="player-corner-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    goMenu()
                  }}
                  aria-label="В меню"
                  title="В меню"
                >
                  <LayoutGrid size={22} strokeWidth={2} aria-hidden />
                </button>
              </div>
              {showNextBtn ? (
                <button
                  type="button"
                  className="player-next-btn"
                  onClick={skipAhead}
                  aria-label="Далее"
                >
                  Далее
                  <ChevronRight size={18} strokeWidth={2.5} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className="start-gate-icon-btn"
                onClick={togglePause}
                aria-label="Продолжить"
              >
                <Play size={48} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ) : (
            <>
              <div className="player-corner-actions has-progress">
                <button
                  type="button"
                  className="player-corner-btn"
                  onClick={toggleMute}
                  aria-label={userMuted ? 'Включить звук' : 'Выключить звук'}
                  title={userMuted ? 'Включить звук' : 'Выключить звук'}
                  aria-pressed={userMuted}
                >
                  {userMuted ? (
                    <VolumeX size={22} strokeWidth={2} aria-hidden />
                  ) : (
                    <Volume2 size={22} strokeWidth={2} aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  className="player-corner-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    goMenu()
                  }}
                  aria-label="В меню"
                  title="В меню"
                >
                  <LayoutGrid size={22} strokeWidth={2} aria-hidden />
                </button>
              </div>
              {showNextBtn ? (
                <button
                  type="button"
                  className="player-next-btn"
                  onClick={skipAhead}
                  aria-label="Далее"
                >
                  Далее
                  <ChevronRight size={18} strokeWidth={2.5} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className="playback-tap-layer"
                onClick={togglePause}
                aria-label="Пауза"
              />
            </>
          )
        ) : null}
      </div>
    </div>
  )
}
