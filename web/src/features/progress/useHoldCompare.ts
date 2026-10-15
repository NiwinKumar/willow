/**
 * Hold to compare with the baseline (the old Stage's hold-to-flicker). Pressing and holding the photo for
 * 250 ms, or holding B, shows the baseline photo in place; while held it flickers between the two every
 * 600 ms (blinking between aligned frames is the quickest way to see a change), except with reduced motion,
 * where it stays on the baseline. A toggle button gives the same view without holding (screen readers,
 * switch access). A quick tap still reaches the spot rings and regions under the finger.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'

const HOLD_MS = 250
const FLICKER_MS = 600

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** True for a key press that belongs to a text field, a select or a shortcut, not to the page. */
function typing(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true
  const t = e.target as HTMLElement | null
  return Boolean(t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))
}

export function useHoldCompare(enabled: boolean, resetKey: string) {
  /** The baseline layer is mounted (and its photo fetched) only once someone asks for it. */
  const [armed, setArmed] = useState(false)
  const [holding, setHolding] = useState(false)
  const [flick, setFlick] = useState(true)
  // Pinned for one check-in only: another check-in on screen starts unpinned.
  const [pinnedFor, setPinnedFor] = useState<string | null>(null)
  const pinned = pinnedFor === resetKey
  const holdTimer = useRef<number | null>(null)
  const flickTimer = useRef<number | null>(null)
  const held = useRef(false)

  const clear = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current)
    if (flickTimer.current) window.clearInterval(flickTimer.current)
    holdTimer.current = null
    flickTimer.current = null
  }
  const begin = useCallback(() => {
    held.current = true
    setHolding(true)
    setFlick(true)
    if (!reduced()) flickTimer.current = window.setInterval(() => setFlick((f) => !f), FLICKER_MS)
  }, [])
  const stop = useCallback(() => {
    clear()
    setHolding(false)
    setFlick(true)
  }, [])

  // Another check-in on screen (or leaving the page): end any hold.
  useEffect(() => stop, [resetKey, stop])

  // Keyboard: hold B.
  useEffect(() => {
    if (!enabled) return
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'b' || e.repeat || typing(e)) return
      setArmed(true)
      begin()
    }
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b') stop()
    }
    const blur = () => stop()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [enabled, begin, stop])

  /** Spread on the photo's wrapper. */
  const bind = {
    onPointerDown: (e: PointerEvent) => {
      if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return
      held.current = false
      setArmed(true)
      clear()
      holdTimer.current = window.setTimeout(begin, HOLD_MS)
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    // A hold ends with a click on whatever is under the finger: swallow it so a ring or region isn't picked.
    onClickCapture: (e: MouseEvent) => {
      if (!held.current) return
      held.current = false
      e.preventDefault()
      e.stopPropagation()
    },
    // Long-press on a phone opens the image menu; the hold is the gesture here.
    onContextMenu: (e: MouseEvent) => {
      if (enabled) e.preventDefault()
    },
  }

  const toggle = () => {
    setArmed(true)
    setPinnedFor((p) => (p === resetKey ? null : resetKey))
  }

  const comparing = enabled && (holding || pinned)
  return { armed: enabled && armed, comparing, showBaseline: comparing && (pinned || flick), pinned, toggle, bind }
}
