import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A right-side drawer on the native <dialog> (focus trapped, page inert, Esc closes) that returns focus to the
 * control that opened it. It slides in from the right and leaves the same way (spatial consistency); under
 * reduced motion it only fades. `onClose` runs for Esc, the scrim and the close button.
 */
export function SidePanel({ open, onClose, title, subtitle, children, footer, width = 440, labelledBy }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; labelledBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [leaving, setLeaving] = useState(false)
  const titleId = labelledBy ?? 'side-panel-title'

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open) {
      // Reopened mid-exit: the dialog is still open, so only the exit is cancelled.
      setLeaving(false)
      if (!d.open) {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        d.showModal()
      }
      return
    }
    if (d.open) {
      setLeaving(true)
      const t = window.setTimeout(() => {
        d.close()
        setLeaving(false)
        const o = opener.current
        if (o?.isConnected) o.focus({ preventScroll: true })
      }, 180)
      return () => window.clearTimeout(t)
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      data-theme="dark"
      className={`m-0 ml-auto h-dvh max-h-none max-w-[100vw] overflow-hidden border-0 border-l border-line bg-surface p-0 text-ink shadow-modal backdrop:bg-black/50 ${leaving ? 'animate-[proofOut_.18s_var(--ease-exit)_both]' : 'animate-[proofIn_.32s_var(--ease-spring)_both]'}`}
      style={{ width: `min(${width}px, 100vw)` }}
    >
      {open || leaving ? (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id={titleId} className="m-0 text-proof-h font-medium text-ink">
                {title}
              </h2>
              {subtitle ? <p className="m-0 text-proof-small text-ink-2">{subtitle}</p> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Close panel" className="hit44 -mr-1.5 grid size-8 shrink-0 place-items-center rounded-xs border-0 bg-transparent text-ink-2 hover:bg-glass hover:text-ink">
              <X size={16} strokeWidth={1.6} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer ? <div className="border-t border-line px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  )
}
