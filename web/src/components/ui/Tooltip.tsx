import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A small ink tooltip for icon-only controls (the collapsed sidebar). Anchored to the control, it says in
 * words what the icon is, with its keyboard shortcut when there is one.
 *
 * - Mouse or pen: shows after 120 ms of hover (the browser's own title tooltip takes about a second and
 *   cannot be styled). Moving straight on to a neighbour shows the next one at once, without the delay.
 * - Keyboard: shows at once on focus-visible, hides on blur or Escape.
 * - Touch: never (a tap would flash it over the finger); the control's own label is read by screen readers.
 * - Hides on press, so it never sits over what the click opens.
 *
 * Four tests: it tells a person what an unlabelled icon does (1); it reads as a label at a glance (2); it
 * sits beside the control, never over it, and never takes a click (3); ink pill, radius-xs, Outfit 13 and
 * the standard ease, as DESIGN.md "Tooltip" draws it (4).
 */
const DELAY = 120
/** After a tooltip hides, the next one within this window shows at once (moving down a row of icons). */
const WARM = 400
let lastHidden = 0

type Phase = 'hidden' | 'shown' | 'leaving'

export function Tooltip({ content, shortcut, side = 'right', disabled, children }: { content: ReactNode; shortcut?: string; side?: 'right' | 'top'; disabled?: boolean; children: ReactNode }) {
  const wrap = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('hidden')
  const [warm, setWarm] = useState(false)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const id = useId()

  const anchor = () => wrap.current?.firstElementChild as HTMLElement | null | undefined
  const place = () => {
    const r = anchor()?.getBoundingClientRect()
    if (!r) return
    setAt(side === 'right' ? { x: r.right + 10, y: r.top + r.height / 2 } : { x: r.left + r.width / 2, y: r.top - 8 })
  }
  const show = (now: boolean) => {
    window.clearTimeout(timer.current)
    const quick = now || Date.now() - lastHidden < WARM
    const go = () => {
      place()
      setWarm(quick)
      setPhase('shown')
    }
    if (quick) go()
    else timer.current = window.setTimeout(go, DELAY)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setPhase((p) => {
      if (p !== 'shown') return p === 'leaving' ? p : 'hidden'
      lastHidden = Date.now()
      return 'leaving'
    })
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // The leave animation is 90 ms; then unmount.
  useEffect(() => {
    if (phase !== 'leaving') return
    const t = window.setTimeout(() => setPhase('hidden'), 90)
    return () => window.clearTimeout(t)
  }, [phase])
  // Describe the control while shown (its accessible name stays its own label).
  useLayoutEffect(() => {
    const el = anchor()
    if (!el) return
    if (phase === 'shown' && !disabled) el.setAttribute('aria-describedby', id)
    else if (el.getAttribute('aria-describedby') === id) el.removeAttribute('aria-describedby')
  }, [phase, disabled, id])

  const live = !disabled && phase !== 'hidden' && at
  return (
    <span
      ref={wrap}
      className="contents"
      onPointerEnter={(e) => {
        if (!disabled && e.pointerType !== 'touch') show(false)
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        if (!disabled && (e.target as HTMLElement).matches(':focus-visible')) show(true)
      }}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide()
      }}
    >
      {children}
      {live
        ? createPortal(
            <span
              role="tooltip"
              id={id}
              data-side={side}
              data-phase={phase}
              data-warm={warm || undefined}
              className="w-tip pointer-events-none fixed z-[90] flex items-center gap-2 rounded-xs bg-selected py-[6px] pr-2.5 pl-3 text-[13px] leading-[1.25] whitespace-nowrap text-inverse shadow-[0_10px_24px_-10px_rgba(0,0,0,.5)]"
              style={{ left: at.x, top: at.y }}
            >
              {content}
              {shortcut ? <kbd className="grid h-[18px] min-w-[18px] place-items-center rounded-[5px] bg-white/16 px-1 font-mono text-[10.5px] text-white/85">{shortcut}</kbd> : null}
            </span>,
            document.body,
          )
        : null}
    </span>
  )
}
