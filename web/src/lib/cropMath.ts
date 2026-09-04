import type { FocusPoint } from '../types/story'
import { clamp01 } from '../types/story'
import type { ViewOrientation } from '../types/story'

/** Соотношение кадра плеера: портрет 9:16, альбом 16:9 */
export const PORTRAIT_ASPECT = 9 / 16
export const LANDSCAPE_ASPECT = 16 / 9
/** @deprecated используйте PORTRAIT_ASPECT / viewAspectFor */
export const VIEW_ASPECT = PORTRAIT_ASPECT

export function viewAspectFor(orientation: ViewOrientation = 'portrait'): number {
  return orientation === 'landscape' ? LANDSCAPE_ASPECT : PORTRAIT_ASPECT
}

export type CropWindow = {
  /** Доля ширины/высоты изображения 0..1 */
  w: number
  h: number
}

/** Окно cover при данном зуме: какая доля исходного фото видна. */
export function coverWindow(imgAspect: number, scale: number, viewAspect = VIEW_ASPECT): CropWindow {
  const s = Math.max(1, scale)
  if (imgAspect >= viewAspect) {
    // фото шире экрана — по высоте на весь кадр
    return { w: viewAspect / imgAspect / s, h: 1 / s }
  }
  // фото выше/уже — по ширине на весь кадр
  return { w: 1 / s, h: imgAspect / viewAspect / s }
}

export function clampFocus(point: FocusPoint, imgAspect: number, viewAspect = VIEW_ASPECT): FocusPoint {
  const scale = Math.min(1.45, Math.max(1, point.scale))
  const { w, h } = coverWindow(imgAspect, scale, viewAspect)
  return {
    x: Math.min(1 - w / 2, Math.max(w / 2, point.x)),
    y: Math.min(1 - h / 2, Math.max(h / 2, point.y)),
    scale,
  }
}

/** Рамка кропа в UV изображения (left/top/width/height 0..1). */
export function focusToCropRect(point: FocusPoint, imgAspect: number, viewAspect = VIEW_ASPECT) {
  const p = clampFocus(point, imgAspect, viewAspect)
  const { w, h } = coverWindow(imgAspect, p.scale, viewAspect)
  return {
    left: p.x - w / 2,
    top: p.y - h / 2,
    width: w,
    height: h,
    cx: p.x,
    cy: p.y,
  }
}

/**
 * Раскладка фото внутри viewport 100%×100% (left/top/width/height в %).
 * Фокус (x,y) в центре экрана, scale — зум поверх cover.
 */
export function focusToViewportLayout(point: FocusPoint, imgAspect: number, viewAspect = VIEW_ASPECT) {
  const p = clampFocus(point, imgAspect, viewAspect)
  const s = p.scale
  let width: number
  let height: number
  if (imgAspect >= viewAspect) {
    height = 100 * s
    width = (100 * s * imgAspect) / viewAspect
  } else {
    width = 100 * s
    height = (100 * s * viewAspect) / imgAspect
  }
  let left = 50 - p.x * width
  let top = 50 - p.y * height
  left = Math.min(0, Math.max(100 - width, left))
  top = Math.min(0, Math.max(100 - height, top))
  return { left, top, width, height }
}

export function pointerToImageUV(
  clientX: number,
  clientY: number,
  imageBox: DOMRect,
): { x: number; y: number } {
  return {
    x: clamp01((clientX - imageBox.left) / Math.max(imageBox.width, 1), 0),
    y: clamp01((clientY - imageBox.top) / Math.max(imageBox.height, 1), 0),
  }
}
