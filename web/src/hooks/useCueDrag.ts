import { useCallback, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { normalizeCue, type StoryCue } from '@/types/story'
import { cueDragFromDelta, minCueDurationSec } from '@/components/editor/timelineMath'

type Args = {
  patchCues: (updater: (prev: StoryCue[]) => StoryCue[]) => void
  cuesRef: MutableRefObject<StoryCue[]>
  ttsDurationsRef: MutableRefObject<Record<string, number>>
  pxPerSecRef: MutableRefObject<number>
  cueDragMovedRef: MutableRefObject<boolean>
  setSelectedCueId: (id: string | null) => void
  setSelectedId: (id: string | null) => void
  setSlidePreview: (v: boolean) => void
  setDragCueId: (id: string | null) => void
  timelineGestureRef?: MutableRefObject<boolean>
}

export function useCueDrag({
  patchCues,
  cuesRef,
  ttsDurationsRef,
  pxPerSecRef,
  cueDragMovedRef,
  setSelectedCueId,
  setSelectedId,
  setSlidePreview,
  setDragCueId,
  timelineGestureRef,
}: Args) {
  return useCallback(
    (event: ReactPointerEvent<HTMLElement>, cue: StoryCue, mode: 'move' | 'resize') => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const target = event.currentTarget
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }

      cueDragMovedRef.current = false
      if (timelineGestureRef) timelineGestureRef.current = true
      setSlidePreview(false)
      setSelectedCueId(cue.id)
      setSelectedId(null)
      setDragCueId(cue.id)

      const startX = event.clientX
      const originStart = cue.startSec
      const originDuration = cue.durationSec
      const originCues = cuesRef.current.map((c) => normalizeCue({ ...c }))

      const onPointerMove = (nextEvent: PointerEvent) => {
        nextEvent.preventDefault()
        if (Math.abs(nextEvent.clientX - startX) > 3) cueDragMovedRef.current = true
        const deltaSec = (nextEvent.clientX - startX) / pxPerSecRef.current
        const minDur = minCueDurationSec(cue, ttsDurationsRef.current)
        patchCues(() =>
          cueDragFromDelta({
            originCues,
            cueId: cue.id,
            mode,
            deltaSec,
            originStart,
            originDuration,
            minDur,
          }),
        )
      }

      const stop = (endEvent: PointerEvent) => {
        if (timelineGestureRef) timelineGestureRef.current = false
        setDragCueId(null)
        try {
          if (target.hasPointerCapture(endEvent.pointerId)) {
            target.releasePointerCapture(endEvent.pointerId)
          }
        } catch {
          /* ignore */
        }
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
      }

      window.addEventListener('pointermove', onPointerMove, { passive: false })
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
    },
    [
      cueDragMovedRef,
      cuesRef,
      patchCues,
      pxPerSecRef,
      setDragCueId,
      setSelectedCueId,
      setSelectedId,
      setSlidePreview,
      timelineGestureRef,
      ttsDurationsRef,
    ],
  )
}
