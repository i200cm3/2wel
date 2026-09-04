import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TrackContextMenuState } from './editorTypes'

export function TrackContextMenu({
  state,
  onClose,
  onDelete,
  onDuplicate,
}: {
  state: TrackContextMenuState | null
  onClose: () => void
  onDelete: (kind: 'clip' | 'cue', id: string) => void
  onDuplicate: (kind: 'clip' | 'cue', id: string) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setConfirm(false)
  }, [state])

  useEffect(() => {
    if (!state) return
    const onDoc = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onReposition = () => onClose()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('contextmenu', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('contextmenu', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [state, onClose])

  if (!state) return null

  const popW = 176
  const popH = 80
  const left = Math.min(state.x, Math.max(8, window.innerWidth - popW - 8))
  const top = Math.min(state.y, Math.max(8, window.innerHeight - popH - 8))

  return createPortal(
    <div
      ref={popRef}
      className="bg-popover text-popover-foreground ring-foreground/10 fixed z-80 min-w-40 rounded-lg p-1 shadow-md ring-1"
      role="menu"
      style={{ top, left }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        onClick={() => {
          onDuplicate(state.kind, state.id)
          onClose()
        }}
      >
        <Copy data-icon="inline-start" aria-hidden />
        Дублировать
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="w-full justify-start"
        onClick={() => {
          if (!confirm) {
            setConfirm(true)
            return
          }
          onDelete(state.kind, state.id)
          onClose()
        }}
      >
        <Trash2 data-icon="inline-start" aria-hidden />
        {confirm ? 'Уверены?' : 'Удалить'}
      </Button>
    </div>,
    document.body,
  )
}
