import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { fillName, resolveMenuCopy } from '../content'
import { ttsPlaybackUrl } from '../lib/ttsUrl'
import {
  menuThemeStyle,
  normalizeMenuLinks,
  normalizeMenuTheme,
  storyFontCss,
  type BranchId,
  type MenuCopy,
  type MenuLink,
  type MenuTheme,
  type PropertyBranch,
} from '../types/story'

type Props = {
  brandName: string
  guestName: string
  branches: PropertyBranch[]
  onSelect: (id: BranchId) => void
  onLink: (link: MenuLink) => void
  menuCopy?: MenuCopy
  menuTheme?: MenuTheme
  menuLinks?: MenuLink[]
  /** Фон меню из медиатеки шаблона */
  bgSrc?: string
  /** Озвучка при появлении меню */
  ttsSrc?: string
  ttsVolume?: number
  /** Гость выключил звук (на iOS volume=0 не глушит — нужен muted) */
  userMuted?: boolean
  /** Внешний audio, уже размученный жестом в плеере (iOS) */
  ttsAudioRef?: { current: HTMLAudioElement | null }
  onTtsPlayingChange?: (playing: boolean) => void
  /** В конструкторе: перетаскивание блока и размера кнопок */
  editable?: boolean
  onLayoutPatch?: (patch: Partial<MenuTheme>) => void
}

function MenuMultiline({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {line}
        </Fragment>
      ))}
    </>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

type Drag =
  | {
      kind: 'move'
      pointerId: number
      startX: number
      startY: number
      origX: number
      origY: number
      origW: number
      moved: boolean
    }
  | {
      kind: 'resize'
      pointerId: number
      startX: number
      startY: number
      origX: number
      origW: number
      origFont: number
      origPad: number
      moved: boolean
    }

export function MenuScreen({
  brandName,
  guestName,
  branches,
  onSelect,
  onLink,
  menuCopy,
  menuTheme,
  menuLinks,
  bgSrc,
  ttsSrc,
  ttsVolume = 1,
  userMuted = false,
  ttsAudioRef,
  onTtsPlayingChange,
  editable = false,
  onLayoutPatch,
}: Props) {
  const internalTtsRef = useRef<HTMLAudioElement | null>(null)
  const ttsRef = ttsAudioRef ?? internalTtsRef
  const menuRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const onLayoutPatchRef = useRef(onLayoutPatch)
  onLayoutPatchRef.current = onLayoutPatch
  const onTtsPlayingChangeRef = useRef(onTtsPlayingChange)
  onTtsPlayingChangeRef.current = onTtsPlayingChange
  const ttsVolumeRef = useRef(ttsVolume)
  ttsVolumeRef.current = ttsVolume
  const userMutedRef = useRef(userMuted)
  userMutedRef.current = userMuted
  const { kicker, title, hint } = resolveMenuCopy(menuCopy, brandName, guestName)
  const theme = normalizeMenuTheme(menuTheme)
  const photo = bgSrc?.trim()
  const rootStyle = {
    ...menuThemeStyle(theme),
    ...(photo ? { '--menu-photo': `url(${JSON.stringify(photo)})` } : {}),
  } as CSSProperties
  const links = normalizeMenuLinks(menuLinks)
  const themeRef = useRef(theme)
  themeRef.current = theme
  const titleFontCss = storyFontCss(theme.titleFont, theme.titleFont)
  const [fontsReady, setFontsReady] = useState(
    () => typeof document !== 'undefined' && document.fonts?.status === 'loaded',
  )
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fonts = document.fonts
    if (!fonts) {
      setFontsReady(true)
      return
    }
    const mark = () => {
      if (!cancelled) setFontsReady(true)
    }
    setFontsReady(false)
    const family = titleFontCss.split(',')[0]?.trim() || "'Cormorant Garamond'"
    const weight = theme.titleBold ? '600' : '400'
    const style = theme.titleItalic ? 'italic' : 'normal'
    void fonts.load(`${style} ${weight} ${theme.titleFontSize}px ${family}`).then(mark).catch(mark)
    void fonts.ready.then(mark).catch(mark)
    return () => {
      cancelled = true
    }
  }, [theme.titleBold, theme.titleItalic, theme.titleFontSize, titleFontCss])

  useEffect(() => {
    const audio = ttsRef.current
    if (!audio) return
    audio.muted = userMuted
    audio.volume = userMuted ? 0 : Math.min(1, Math.max(0, ttsVolume))
  }, [userMuted, ttsVolume])

  useEffect(() => {
    const audio = ttsRef.current
    const src = ttsSrc?.trim()
    if (!audio || !src) {
      onTtsPlayingChangeRef.current?.(false)
      return
    }

    let cancelled = false

    const done = () => {
      if (!cancelled) onTtsPlayingChangeRef.current?.(false)
    }

    const tryPlay = () => {
      if (cancelled) return
      void audio.play().catch(() => done())
    }

    audio.onended = done
    audio.onerror = done
    audio.src = ttsPlaybackUrl(src)
    audio.muted = userMutedRef.current
    audio.volume = userMutedRef.current
      ? 0
      : Math.min(1, Math.max(0, ttsVolumeRef.current))
    try {
      audio.currentTime = 0
    } catch {
      /* ignore */
    }
    onTtsPlayingChangeRef.current?.(true)

    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      tryPlay()
    } else {
      audio.addEventListener('canplay', tryPlay, { once: true })
    }
    const fallback = window.setTimeout(tryPlay, 60)

    return () => {
      cancelled = true
      window.clearTimeout(fallback)
      audio.removeEventListener('canplay', tryPlay)
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      try {
        audio.load()
      } catch {
        /* ignore */
      }
      onTtsPlayingChangeRef.current?.(false)
    }
  }, [ttsSrc])

  const applyDrag = (clientX: number, clientY: number) => {
    const drag = dragRef.current
    const box = menuRef.current?.getBoundingClientRect()
    const patch = onLayoutPatchRef.current
    if (!drag || !box || box.width < 8 || box.height < 8 || !patch) return
    const dx = (clientX - drag.startX) / box.width
    const dy = (clientY - drag.startY) / box.height
    if (Math.abs(clientX - drag.startX) + Math.abs(clientY - drag.startY) > 4) {
      drag.moved = true
    }
    if (drag.kind === 'move') {
      const w = drag.origW
      patch({
        buttonsX: clamp(drag.origX + dx, 0, Math.max(0, 1 - w)),
        buttonsY: clamp(drag.origY - dy, 0, 0.55),
      })
      return
    }
    const w = clamp(drag.origW + dx, 0.42, 1)
    patch({
      buttonsW: w,
      buttonsX: clamp(drag.origX, 0, Math.max(0, 1 - w)),
      buttonFontSize: clamp(Math.round(drag.origFont + dy * 80), 12, 24),
      buttonPadY: clamp(Math.round(drag.origPad + dy * 50), 8, 22),
    })
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    try {
      menuRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    const skippedClick = drag.moved
    dragRef.current = null
    setDragging(false)
    if (skippedClick) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const startDrag = (kind: 'move' | 'resize', event: ReactPointerEvent<HTMLElement>) => {
    if (!editable || !onLayoutPatch) return
    event.preventDefault()
    event.stopPropagation()
    const t = themeRef.current
    const base = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    dragRef.current =
      kind === 'move'
        ? { kind, ...base, origX: t.buttonsX, origY: t.buttonsY, origW: t.buttonsW }
        : {
            kind,
            ...base,
            origX: t.buttonsX,
            origW: t.buttonsW,
            origFont: t.buttonFontSize,
            origPad: t.buttonPadY,
          }
    setDragging(true)
    menuRef.current?.setPointerCapture(event.pointerId)
  }

  const onInnerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable) return
    if ((event.target as HTMLElement | null)?.closest?.('.menu-box-handle')) return
    startDrag('move', event)
  }

  const onInnerClick = (event: ReactPointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    if (!editable) return
    if (dragRef.current?.moved) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (
    <div
      ref={menuRef}
      className={`menu${fontsReady ? ' is-fonts-ready' : ''}${editable ? ' is-editable' : ''}`}
      style={rootStyle}
      onPointerMove={(e) => {
        if (dragRef.current?.pointerId === e.pointerId) applyDrag(e.clientX, e.clientY)
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {ttsAudioRef ? null : <audio ref={internalTtsRef} preload="auto" playsInline />}
      <div className="menu-bg" />
      <div
        className={`menu-inner${dragging ? ' is-dragging' : ''}`}
        onPointerDown={onInnerPointerDown}
        onClick={onInnerClick}
      >
        {kicker ? <p className="menu-kicker">{kicker}</p> : null}
        {title ? (
          <h2>
            <MenuMultiline text={title} />
          </h2>
        ) : null}
        {hint ? <p className="menu-hint">{hint}</p> : null}
        <div className="menu-grid">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              className="menu-btn"
              onClick={(e) => {
                if (editable) {
                  e.preventDefault()
                  return
                }
                onSelect(b.id)
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
        {links.length ? (
          <div className="menu-links">
            {links.map((link) => (
              <button
                key={link.id}
                type="button"
                className="menu-btn menu-link-btn"
                style={{ background: link.bg, color: link.textColor }}
                onClick={(e) => {
                  if (editable) {
                    e.preventDefault()
                    return
                  }
                  onLink(link)
                }}
              >
                {fillName(link.label, guestName)}
              </button>
            ))}
          </div>
        ) : null}
        {editable ? (
          <button
            type="button"
            className="menu-box-handle"
            aria-label="Изменить размер кнопок"
            title="Ширина блока и размер кнопок"
            onPointerDown={(e) => startDrag('resize', e)}
          />
        ) : null}
      </div>
    </div>
  )
}
