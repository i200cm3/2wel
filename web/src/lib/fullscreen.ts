/** Попытка открыть настоящий fullscreen (прячет вкладки/адресную строку). */
export async function enterPresentationFullscreen(
  el: HTMLElement | null,
  orientation: 'portrait' | 'landscape' = 'portrait',
): Promise<void> {
  if (!el || typeof document === 'undefined') return

  const doc = document as Document & {
    webkitFullscreenElement?: Element | null
    webkitExitFullscreen?: () => Promise<void> | void
  }
  const node = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void
    webkitRequestFullScreen?: () => Promise<void> | void
  }

  const already =
    document.fullscreenElement === el || doc.webkitFullscreenElement === el
  if (!already) {
    try {
      if (typeof node.requestFullscreen === 'function') {
        await node.requestFullscreen({ navigationUI: 'hide' })
      } else if (typeof node.webkitRequestFullscreen === 'function') {
        await node.webkitRequestFullscreen()
      } else if (typeof node.webkitRequestFullScreen === 'function') {
        await node.webkitRequestFullScreen()
      }
    } catch {
      // iOS Safari часто запрещает — остаёмся в обычном режиме
    }
  }

  const orient = screen.orientation as ScreenOrientation & {
    lock?: (o: string) => Promise<void>
  }
  if (typeof orient?.lock === 'function') {
    try {
      await orient.lock(orientation === 'landscape' ? 'landscape' : 'portrait-primary')
    } catch {
      // lock доступен не везде и только после gesture / в fullscreen
    }
  }
}

/** CSS-переменные под реальный visualViewport (без полос браузера). */
export function syncVisualViewportVars(root: HTMLElement | Document = document.documentElement) {
  const target = root instanceof Document ? root.documentElement : root
  const vv = window.visualViewport
  const w = Math.round(vv?.width ?? window.innerWidth)
  const h = Math.round(vv?.height ?? window.innerHeight)
  const offsetTop = Math.round(vv?.offsetTop ?? 0)
  const offsetLeft = Math.round(vv?.offsetLeft ?? 0)
  target.style.setProperty('--vvw', `${w}px`)
  target.style.setProperty('--vvh', `${h}px`)
  target.style.setProperty('--vv-top', `${offsetTop}px`)
  target.style.setProperty('--vv-left', `${offsetLeft}px`)
}
