import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  VIEW_ASPECT,
  clampFocus,
  focusToCropRect,
  focusToViewportLayout,
  pointerToImageUV,
} from '../lib/cropMath'
import type { FocusPoint, MotionPath } from '../types/story'
import './CropPathEditor.css'

type Props = {
  src: string
  from: FocusPoint
  to: FocusPoint
  onChange: (path: MotionPath) => void
  /** A и B всегда одинаковые — один кадр без анимации */
  linked?: boolean
  /** Соотношение кадра плеера (портрет / альбом) */
  viewAspect?: number
}

type DragKind = 'from' | 'to' | null

/** Полное фото + две рамки кадра (A старт, B финиш) + мини-превью «как у гостя». */
export function CropPathEditor({
  src,
  from,
  to,
  onChange,
  linked = false,
  viewAspect = VIEW_ASPECT,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const dimMaskId = `crop-dim-${useId().replace(/:/g, '')}`
  const [imgAspect, setImgAspect] = useState(1)
  const [drag, setDrag] = useState<DragKind>(null)
  const [previewKind, setPreviewKind] = useState<'from' | 'to'>('from')

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setImgAspect(img.naturalWidth / img.naturalHeight)
      }
    }
    img.src = src
  }, [src])

  // Поджать точки под реальный aspect, когда узнали размер / сменили ориентацию
  useEffect(() => {
    const nf = clampFocus(from, imgAspect, viewAspect)
    const nt = linked ? nf : clampFocus(to, imgAspect, viewAspect)
    if (
      nf.x !== from.x ||
      nf.y !== from.y ||
      nf.scale !== from.scale ||
      nt.x !== to.x ||
      nt.y !== to.y ||
      nt.scale !== to.scale
    ) {
      onChange({ from: nf, to: nt })
    }
    // только при смене aspect / src / linked / viewAspect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgAspect, src, linked, viewAspect])

  const move = useCallback(
    (kind: 'from' | 'to', clientX: number, clientY: number) => {
      const box = imgRef.current?.getBoundingClientRect()
      if (!box) return
      const uv = pointerToImageUV(clientX, clientY, box)
      if (linked) {
        const base = kind === 'from' ? from : to
        const next = clampFocus({ ...base, x: uv.x, y: uv.y }, imgAspect, viewAspect)
        onChange({ from: next, to: { ...next } })
        return
      }
      if (kind === 'from') {
        onChange({
          from: clampFocus({ ...from, x: uv.x, y: uv.y }, imgAspect, viewAspect),
          to: clampFocus(to, imgAspect, viewAspect),
        })
      } else {
        onChange({
          from: clampFocus(from, imgAspect, viewAspect),
          to: clampFocus({ ...to, x: uv.x, y: uv.y }, imgAspect, viewAspect),
        })
      }
    },
    [from, to, imgAspect, onChange, linked, viewAspect],
  )

  const onPointerDown = (kind: 'from' | 'to') => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag(kind)
    setPreviewKind(kind)
    move(kind, e.clientX, e.clientY)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag) return
    move(drag, e.clientX, e.clientY)
  }

  const endDrag = () => setDrag(null)

  const rectA = focusToCropRect(from, imgAspect, viewAspect)
  const rectB = focusToCropRect(to, imgAspect, viewAspect)
  const activeKind = drag ?? (linked ? 'from' : previewKind)
  const previewFocus = activeKind === 'to' ? to : from
  const guestLayout = focusToViewportLayout(previewFocus, imgAspect, viewAspect)
  const isLandscape = viewAspect > 1

  return (
    <div
      className={`crop-editor is-workspace ${drag ? 'is-dragging' : ''} ${linked ? 'is-linked' : ''}`}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="crop-editor-canvas">
        <div className="crop-editor-media">
          <img ref={imgRef} src={src} alt="" className="crop-editor-img" draggable={false} />
          <div className="crop-editor-overlay">
            <svg className="crop-dim" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
              <defs>
                <mask id={dimMaskId} maskUnits="objectBoundingBox">
                  <rect width="1" height="1" fill="white" />
                  <rect
                    x={rectA.left}
                    y={rectA.top}
                    width={rectA.width}
                    height={rectA.height}
                    fill="black"
                  />
                  {!linked ? (
                    <rect
                      x={rectB.left}
                      y={rectB.top}
                      width={rectB.width}
                      height={rectB.height}
                      fill="black"
                    />
                  ) : null}
                </mask>
              </defs>
              <rect width="1" height="1" fill="rgba(0,0,0,0.28)" mask={`url(#${dimMaskId})`} />
            </svg>
            {!linked ? (
              <svg className="crop-path-line" viewBox="0 0 1 1" preserveAspectRatio="none">
                <line
                  x1={rectA.cx}
                  y1={rectA.cy}
                  x2={rectB.cx}
                  y2={rectB.cy}
                  stroke="rgba(255,255,255,0.85)"
                  strokeWidth="0.006"
                  strokeDasharray="0.018 0.012"
                />
              </svg>
            ) : null}
            <div
              className={`crop-frame crop-frame-a ${activeKind === 'from' ? 'is-active' : ''}`}
              style={{
                left: `${rectA.left * 100}%`,
                top: `${rectA.top * 100}%`,
                width: `${rectA.width * 100}%`,
                height: `${rectA.height * 100}%`,
              }}
              onPointerDown={onPointerDown('from')}
            >
              <span className="crop-frame-label">{linked ? '·' : 'A'}</span>
              <span className="crop-frame-hint">{linked ? 'кадр' : 'старт'}</span>
            </div>
            {!linked ? (
              <div
                className={`crop-frame crop-frame-b ${activeKind === 'to' ? 'is-active' : ''}`}
                style={{
                  left: `${rectB.left * 100}%`,
                  top: `${rectB.top * 100}%`,
                  width: `${rectB.width * 100}%`,
                  height: `${rectB.height * 100}%`,
                }}
                onPointerDown={onPointerDown('to')}
              >
                <span className="crop-frame-label">B</span>
                <span className="crop-frame-hint">финиш</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <aside
        className={`crop-guest-preview${isLandscape ? ' is-landscape' : ''}`}
        aria-label="Превью кадра у гостя"
      >
        <div className="crop-guest-preview-phone">
          <img
            src={src}
            alt=""
            className="crop-guest-preview-img"
            draggable={false}
            style={
              {
                left: `${guestLayout.left}%`,
                top: `${guestLayout.top}%`,
                width: `${guestLayout.width}%`,
                height: `${guestLayout.height}%`,
              } as CSSProperties
            }
          />
        </div>
        <p className="crop-guest-preview-label">
          {linked ? 'как у гостя' : activeKind === 'to' ? 'финиш · гость' : 'старт · гость'}
        </p>
      </aside>
    </div>
  )
}
