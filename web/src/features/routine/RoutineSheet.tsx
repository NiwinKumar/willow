import { ArrowLeft, X } from 'lucide-react'
import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'

import './routine.css'

/** After a sheet closes: if focus fell to <body>, return it to the opener (when it is still on the page). */
function refocus(opener: HTMLElement | null) {
  requestAnimationFrame(() => {
    const a = document.activeElement
    if (opener?.isConnected && (!a || a === document.body)) opener.focus({ preventScroll: true })
  })
}

const CLOSE_DRAG_PX = 120

/**
 * The Routine design's own overlays (Willow App Routine.dc.html), on the native <dialog> (focus trap, Esc,
 * inert page), over the design's blurred scrim:
 *   bottom – "Add product": rises from the bottom at every width (centred, up to 760px wide, 92dvh tall),
 *            rounded top, drag handle (drag it down to close), large serif title, round back and close.
 *            `fixedHeight`: always as tall as it can be, so it never jumps as its content changes.
 *   side   – "Product information": a full-height panel from the right, up to 540px, on the canvas colour;
 *            headless (the content draws its hero), with a round close button over the hero's corner.
 */
export function RoutineSheet({ open, onClose, kind, title, onBack, fixedHeight = false, children }: { open: boolean; onClose: () => void; kind: 'bottom' | 'side'; title: string; onBack?: () => void; fixedHeight?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      d.style.transform = ''
      d.showModal()
    }
    if (!open && d.open) {
      d.close()
      refocus(opener.current)
    }
  }, [open])
  useEffect(() => () => refocus(opener.current), [])

  // Drag the handle down to close (the sheet follows the finger; short drags spring back).
  const onDown = (e: PointerEvent<HTMLSpanElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, dy: 0 }
  }
  const onMove = (e: PointerEvent<HTMLSpanElement>) => {
    const d = ref.current
    if (!drag.current || !d) return
    drag.current.dy = Math.max(0, e.clientY - drag.current.y)
    d.style.transition = 'none'
    d.style.transform = `translateY(${drag.current.dy}px)`
  }
  const onUp = () => {
    const d = ref.current
    const dy = drag.current?.dy ?? 0
    drag.current = null
    if (!d) return
    d.style.transition = 'transform .35s cubic-bezier(.2,.7,.2,1)'
    if (dy > CLOSE_DRAG_PX) onClose()
    else d.style.transform = ''
  }

  const round = 'grid shrink-0 place-items-center rounded-full transition-[background,scale] active:scale-95'
  const shape =
    kind === 'bottom'
      ? `mx-auto mt-auto mb-0 w-full max-w-[760px] max-h-[92dvh] ${fixedHeight ? 'h-[92dvh]' : ''} overflow-y-auto rounded-t-[44px] bg-surface p-[clamp(20px,3vw,32px)] motion-safe:animate-[rtSheet_.45s_cubic-bezier(.2,.7,.2,1)_both]`
      : 'my-0 mr-0 ml-auto h-dvh max-h-none w-full max-w-[540px] overflow-y-auto bg-canvas p-[clamp(16px,3vw,24px)] motion-safe:animate-[rtSlide_.4s_cubic-bezier(.2,.7,.2,1)_both]'
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={`border-0 text-ink shadow-modal backdrop:bg-[rgba(18,18,18,.35)] backdrop:backdrop-blur-[8px] ${shape}`}
    >
      {open && kind === 'bottom' ? (
        <div className="flex flex-col gap-4">
          <span
            aria-hidden
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className="-mt-2 -mb-2 flex h-6 w-24 cursor-grab touch-none items-start justify-center self-center active:cursor-grabbing"
          >
            <span className="mt-0 block h-[5px] w-11 rounded-[5px] bg-[#D6D4CE]" />
          </span>
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              {onBack ? (
                <button type="button" onClick={onBack} aria-label="Back" className={`${round} size-12 bg-canvas hover:bg-muted`}>
                  <ArrowLeft size={18} strokeWidth={1.8} aria-hidden />
                </button>
              ) : null}
              <h2 className="m-0 font-serif text-[clamp(34px,4vw,44px)] leading-none font-normal">{title}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={`${round} size-[52px] bg-canvas hover:bg-muted`}>
              <X size={18} strokeWidth={1.8} aria-hidden />
            </button>
          </div>
          {children}
        </div>
      ) : open ? (
        <div className="relative flex min-h-full flex-col gap-3">
          <button type="button" onClick={onClose} aria-label="Close" className={`${round} absolute top-4 right-4 z-10 size-[52px] bg-white hover:bg-surface`}>
            <X size={18} strokeWidth={1.8} aria-hidden />
          </button>
          {children}
        </div>
      ) : null}
    </dialog>
  )
}
