import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Pos = { x: number; y: number; below: boolean }

/**
 * Tooltip behaviour for any trigger: shows on hover and keyboard focus, hides on leave, blur, Esc or scroll.
 * The text is also in the DOM as a visually hidden description (aria-describedby), so screen readers get it
 * without the floating copy. The floating copy is portalled to <body> with fixed coordinates, so tables that
 * scroll or clip never cut it off.
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
  const hide = useCallback(() => setPos(null), [])
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
  const trigger = {
    ref: (el: HTMLElement | null) => {
      ref.current = el
    },
    'aria-describedby': id,
    onPointerEnter: show,
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
              aria-hidden
              data-theme="dark"
              className="pointer-events-none fixed z-[90] max-w-[280px] rounded-xs border border-line-strong bg-muted px-2.5 py-1.5 font-ui text-proof-small text-ink shadow-modal animate-[wFadeIn_.12s_ease_both]"
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
