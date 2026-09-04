import { useCallback, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  clamp01,
  type FocusPoint,
  type MotionPath,
} from '../types/story'
import './MotionGuide.css'

type Props = {
  from: FocusPoint
  to: FocusPoint
  /** Если задан — точки можно таскать мышкой */
  onChange?: (path: MotionPath) => void
  compact?: boolean
}

type DragTarget = 'from' | 'to' | null

/** Интерактивный путь A→B: перетаскивай центры «откуда» и «куда». */
export function MotionGuide({ from, to, onChange, compact = false }: Props) {
  const uid = useId().replace(/:/g, '')
  const rootRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragTarget>(null)
  const editable = Boolean(onChange)

  const clientToNorm = useCallback((clientX: number, clientY: number) => {
    const el = rootRef.current
    if (!el) return { x: 0.5, y: 0.5 }
    const r = el.getBoundingClientRect()
    return {
      x: clamp01((clientX - r.left) / r.width),
      y: clamp01((clientY - r.top) / r.height),
    }
  }, [])

  const onPointerDown = (target: 'from' | 'to') => (e: ReactPointerEvent) => {
    if (!onChange) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    setDrag(target)
    const p = clientToNorm(e.clientX, e.clientY)
    if (target === 'from') onChange({ from: { ...from, ...p }, to })
    else onChange({ from, to: { ...to, ...p } })
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag || !onChange) return
    const p = clientToNorm(e.clientX, e.clientY)
    if (drag === 'from') onChange({ from: { ...from, ...p }, to })
    else onChange({ from, to: { ...to, ...p } })
  }

  const endDrag = () => setDrag(null)

  const ax = from.x * 100
  const ay = from.y * 100
  const bx = to.x * 100
  const by = to.y * 100
  const marker = `mg-${uid}-arr`

  return (
    <div
      ref={rootRef}
      className={`motion-guide ${compact ? 'is-compact' : ''} ${editable ? 'is-editable' : ''} ${drag ? 'is-dragging' : ''}`}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <svg className="motion-guide-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* центр экрана (куда тянется фокус) */}
        <line x1="50" y1="44" x2="50" y2="56" className="mg-cross" />
        <line x1="44" y1="50" x2="56" y2="50" className="mg-cross" />
        <circle cx="50" cy="50" r="1.8" className="mg-center" />

        <defs>
          <marker id={marker} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
            <path d="M0,0 L5,2.5 L0,5 Z" className="mg-arrow-head" />
          </marker>
        </defs>

        <line
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          className="mg-path"
          markerEnd={`url(#${marker})`}
        />
      </svg>

      <button
        type="button"
        className={`mg-handle mg-handle-a ${drag === 'from' ? 'is-active' : ''}`}
        style={{ left: `${ax}%`, top: `${ay}%` }}
        onPointerDown={onPointerDown('from')}
        aria-label="Точка A — откуда"
        disabled={!editable}
      >
        A
      </button>
      <button
        type="button"
        className={`mg-handle mg-handle-b ${drag === 'to' ? 'is-active' : ''}`}
        style={{ left: `${bx}%`, top: `${by}%` }}
        onPointerDown={onPointerDown('to')}
        aria-label="Точка B — куда"
        disabled={!editable}
      >
        B
      </button>

      <div className="motion-guide-legend">
        <span className="mg-tag mg-from">A откуда</span>
        <span className="mg-label">→</span>
        <span className="mg-tag mg-to">B куда</span>
      </div>
    </div>
  )
}
