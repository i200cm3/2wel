import { useCallback, type PointerEvent as ReactPointerEvent } from 'react'
import type { MutableRefObject } from 'react'
import { clipHoldSec, type StoryClip, type StoryCue } from '@/types/story'
import {
  clipResizeFromDelta,
  cueSnapTimes,
  snapThresholdSec,
  type ClipResizeEdge,
} from '@/components/editor/timelineMath'

type Args = {
  updateClip: (clipId: string, patch: Partial<StoryClip>) => void
  clips: StoryClip[] | undefined
  cuesRef: MutableRefObject<StoryCue[]>
  ttsDurationsRef: MutableRefObject<Record<string, number>>
  pxPerSecRef: MutableRefObject<number>
  setSelectedId: (id: string | null) => void
  setSelectedCueId: (id: string | null) => void
  setSlidePreview: (v: boolean) => void
  setDragClipResizeId: (id: string | null) => void
  setSnapGuideSec: (sec: number | null) => void
  /** Синхронный флаг жеста — чтобы selection-scroll не срабатывал до commit state */
  timelineGestureRef?: MutableRefObject<boolean>
}

export function useClipResize({
  updateClip,
  clips,
  cuesRef,
  ttsDurationsRef,
  pxPerSecRef,
  setSelectedId,
  setSelectedCueId,
  setSlidePreview,
  setDragClipResizeId,
  setSnapGuideSec,
  timelineGestureRef,
}: Args) {
  return useCallback(
    (event: ReactPointerEvent<HTMLElement>, clip: StoryClip, edge: ClipResizeEdge = 'end') => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const target = event.currentTarget
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }

      if (timelineGestureRef) timelineGestureRef.current = true
      const clipEl = target.closest('[data-clip-id]') as HTMLElement | null
      const prevDraggable = clipEl?.draggable
      if (clipEl) clipEl.draggable = false
      setDragClipResizeId(clip.id)
      setSelectedId(clip.id)
      setSelectedCueId(null)
      setSlidePreview(false)
      setSnapGuideSec(null)

      const startX = event.clientX
      const clipIndex = clips?.findIndex((c) => c.id === clip.id) ?? -1
      const clipStartSec = (clips ?? [])
        .slice(0, Math.max(0, clipIndex))
        .reduce((sum, c) => sum + clipHoldSec(c), 0)
      const snapTargets = cueSnapTimes(cuesRef.current, ttsDurationsRef.current)
      const scale = pxPerSecRef.current
      const threshold = snapThresholdSec(scale)
      let holdSnap: number | null = null

      const onPointerMove = (nextEvent: PointerEvent) => {
        nextEvent.preventDefault()
        const deltaSec = (nextEvent.clientX - startX) / scale
        const next = clipResizeFromDelta({
          clip,
          edge,
          deltaSec,
          clipStartSec,
          snapTargets,
          threshold,
          holdSnap,
        })
        holdSnap = next.holdSnap
        setSnapGuideSec(next.snapGuideSec)
        updateClip(clip.id, next.patch)
      }

      const stop = (endEvent: PointerEvent) => {
        if (timelineGestureRef) timelineGestureRef.current = false
        if (clipEl && prevDraggable != null) clipEl.draggable = prevDraggable
        setDragClipResizeId(null)
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
      clips,
      cuesRef,
      pxPerSecRef,
      setDragClipResizeId,
      setSelectedCueId,
      setSelectedId,
      setSlidePreview,
      setSnapGuideSec,
      timelineGestureRef,
      ttsDurationsRef,
      updateClip,
    ],
  )
}
