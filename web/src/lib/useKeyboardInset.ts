import { useEffect } from 'react'

/**
 * The on-screen keyboard, for overlays fixed to the bottom of the screen (sheets, the phone Wisp panel). iOS
 * Safari and Chrome on Android lay the page out as if the keyboard were not there and only shrink the visual
 * viewport, so a fixed footer or composer ends up under the keyboard. While a text field has focus and the
 * visual viewport is shorter than the layout viewport, this sets on <html>:
 *   --kb      how far the keyboard (the visual viewport's bottom) is above the layout viewport's bottom
 *   --kb-top  how far the visual viewport is scrolled down inside the layout viewport
 *   --vvh     the visible height
 * and removes them otherwise, so `bottom: var(--kb, 0px)` and `max-height: var(--vvh, 100dvh)` fall back to
 * the normal layout. One listener for every overlay that asks (counted), none when nothing is open.
 */
let users = 0
let stop: (() => void) | null = null

function start() {
  const vv = window.visualViewport
  if (!vv) return null
  const root = document.documentElement
  const typing = () => {
    const a = document.activeElement
    return a instanceof HTMLElement && (a.isContentEditable || a.matches('textarea, input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=file])'))
  }
  const update = () => {
    const kb = root.clientHeight - vv.height - vv.offsetTop
    // A pinch zoom also shrinks the visual viewport: only a keyboard (scale 1, a field focused, a real gap) counts.
    if (kb > 80 && Math.abs(vv.scale - 1) < 0.01 && typing()) {
      root.style.setProperty('--kb', `${Math.round(kb)}px`)
      root.style.setProperty('--kb-top', `${Math.round(vv.offsetTop)}px`)
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`)
    } else {
      for (const p of ['--kb', '--kb-top', '--vvh']) root.style.removeProperty(p)
    }
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  document.addEventListener('focusin', update)
  document.addEventListener('focusout', update)
  update()
  return () => {
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
    document.removeEventListener('focusin', update)
    document.removeEventListener('focusout', update)
    for (const p of ['--kb', '--kb-top', '--vvh']) root.style.removeProperty(p)
  }
}

export function useKeyboardInset(active: boolean) {
  useEffect(() => {
    if (!active) return
    if (users++ === 0) stop = start()
    return () => {
      if (--users === 0) {
        stop?.()
        stop = null
      }
    }
  }, [active])
}
