import { useCallback, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { normalizeCue, type StoryClip, type StoryCue } from '@/types/story'
import {
  clipBoundaryTimes,
  cueDragFromDelta,
  minCueDurationSec,
  snapThresholdSec,
  type CueDragHoldSnap,
  type CueDragMode,
} from '@/components/editor/timelineMath'

type Args = {
  patchCues: (updater: (prev: StoryCue[]) => StoryCue[]) => void
  cuesRef: MutableRefObject<StoryCue[]>
  clipsRef: MutableRefObject<StoryClip[]>
  ttsDurationsRef: MutableRefObject<Record<string, number>>
  pxPerSecRef: MutableRefObject<number>
  cueDragMovedRef: MutableRefObject<boolean>
  setSelectedCueId: (id: string | null) => void
  setSelectedId: (id: string | null) => void
  setSlidePreview: (v: boolean) => void
  setDragCueId: (id: string | null) => void
  setSnapGuideSec: (sec: number | null) => void
  timelineGestureRef?: MutableRefObject<boolean>
}

export function useCueDrag({
  patchCues,
  cuesRef,
  clipsRef,
  ttsDurationsRef,
  pxPerSecRef,
  cueDragMovedRef,
  setSelectedCueId,
  setSelectedId,
  setSlidePreview,
  setDragCueId,
  setSnapGuideSec,
  timelineGestureRef,
}: Args) {
  return useCallback(
    (event: ReactPointerEvent<HTMLElement>, cue: StoryCue, mode: CueDragMode) => {
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
      setSnapGuideSec(null)

      const startX = event.clientX
      const originStart = cue.startSec
      const originDuration = cue.durationSec
      const originCues = cuesRef.current.map((c) => normalizeCue({ ...c }))
      const snapTargets = clipBoundaryTimes(clipsRef.current)
      const scale = pxPerSecRef.current
      const threshold = snapThresholdSec(scale)
      let holdSnap: CueDragHoldSnap = null

      const onPointerMove = (nextEvent: PointerEvent) => {
        nextEvent.preventDefault()
        if (Math.abs(nextEvent.clientX - startX) > 3) cueDragMovedRef.current = true
        const deltaSec = (nextEvent.clientX - startX) / pxPerSecRef.current
        const minDur = minCueDurationSec(cue, ttsDurationsRef.current)
        const next = cueDragFromDelta({
          originCues,
          cueId: cue.id,
          mode,
          deltaSec,
          originStart,
          originDuration,
          minDur,
          snapTargets,
          threshold,
          holdSnap,
        })
        holdSnap = next.holdSnap
        setSnapGuideSec(next.snapGuideSec)
        patchCues(() => next.cues)
      }

      const stop = (endEvent: PointerEvent) => {
        if (timelineGestureRef) timelineGestureRef.current = false
        setDragCueId(null)
        setSnapGuideSec(null)
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
      clipsRef,
      cueDragMovedRef,
      cuesRef,
      patchCues,
      pxPerSecRef,
      setDragCueId,
      setSelectedCueId,
      setSelectedId,
      setSlidePreview,
      setSnapGuideSec,
      timelineGestureRef,
      ttsDurationsRef,
    ],
  )
}

export type { CueDragMode }
