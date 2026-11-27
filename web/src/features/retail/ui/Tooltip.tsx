import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Pos = { x: number; y: number; below: boolean }

/** Hover delay before a tooltip shows (ms). */
const HOVER_DELAY = 300

/**
 * Tooltip behaviour for any trigger: shows on hover and keyboard focus, hides on leave, blur, Esc or scroll.
 * The text is also in the DOM as a visually hidden description (aria-describedby), so screen readers get it
 * without the floating copy. The floating copy is portalled to <body> with fixed coordinates, so tables that
 * scroll or clip never cut it off, and shown as a manual popover so it sits in the top layer, above an open
 * side panel (a modal <dialog>) too.
 *
 *   const tip = useTooltip(<>95% interval 41–55%</>)
 *   <button {...tip.trigger}>48%</button>{tip.node}
 */
export function useTooltip(content: ReactNode) {
  const id = useId()
  const ref = useRef<HTMLElement | null>(null)
  const [pos, setPos] = useState<Pos | null>(null)
  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const below = r.top < 96
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150), y: below ? r.bottom + 8 : r.top - 8, below })
  }, [])
  // Hover waits a moment (a pointer passing over a row of icons doesn't flash tips); keyboard focus, and a tap
  // (which focuses), show it at once. Touch never triggers the hover path.
  const timer = useRef<number | null>(null)
  const hide = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setPos(null)
  }, [])
  const enter = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch') return
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(show, HOVER_DELAY)
    },
    [show],
  )
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  useEffect(() => {
    if (!pos) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', hide, true)
    }
  }, [pos, hide])
  const float = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const el = float.current
    if (!pos || !el || typeof el.showPopover !== 'function') return
    try {
      el.showPopover()
    } catch {
      /* already open */
    }
  }, [pos])
  const trigger = {
    ref: (el: HTMLElement | null) => {
      ref.current = el
    },
    'aria-describedby': id,
    onPointerEnter: enter,
    onPointerLeave: hide,
    onFocus: show,
    onBlur: hide,
  }
  const node = (
    <>
      <span id={id} className="sr-only">
        {content}
      </span>
      {pos
        ? createPortal(
            <span
              ref={float}
              aria-hidden
              popover="manual"
              data-theme="dark"
              className="pointer-events-none fixed inset-auto z-[90] m-0 max-w-[280px] overflow-visible rounded-ctl border border-line-strong bg-muted px-2.5 py-1.5 font-geist text-proof-small text-ink shadow-modal animate-[wFadeIn_.12s_ease_both]"
              style={{ left: pos.x, top: pos.y, translate: pos.below ? '-50% 0' : '-50% -100%' }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  )
  return { trigger, node }
}
