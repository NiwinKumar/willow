import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

import { IconButton } from './IconButton'

/** After a sheet closes: if focus fell to <body>, return it to the opener (when it is still on the page). */
function refocus(opener: HTMLElement | null) {
  requestAnimationFrame(() => {
    const a = document.activeElement
    if (opener?.isConnected && (!a || a === document.body)) opener.focus({ preventScroll: true })
  })
}

/**
 * Overlays on the native <dialog> (focus trap, Esc, inert page for free), drawn as the design draws them:
 *   modal  – centred, radius 40, scrim (confirmations, sign-out, change baseline)
 *   bottom – rises from the bottom on phone, centred modal from 1040px (metric detail, tomorrow sheet)
 *   side   – right-side panel, 400px (check-in picker)
 * `onClose` runs for Esc, the scrim, and the close button.
 */
export function Sheet({ open, onClose, title, hideTitle, variant = 'bottom', size = 'md', children, footer, labelledBy }: { open: boolean; onClose: () => void; title: string; hideTitle?: boolean; variant?: 'modal' | 'bottom' | 'side'; size?: 'sm' | 'md' | 'lg'; children: ReactNode; footer?: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      d.showModal()
    }
    if (!open && d.open) {
      d.close()
      refocus(opener.current)
    }
  }, [open])
  // close() hands focus back to the opener only when it can; a sheet unmounted while open (most callers render
  // it only while needed) drops focus to <body>: give it back to the control that opened it.
  useEffect(() => () => refocus(opener.current), [])
  const width = size === 'sm' ? 'sm:max-w-[440px]' : size === 'lg' ? 'sm:max-w-[980px]' : 'sm:max-w-[640px]'
  const shape =
    variant === 'side'
      ? 'ml-auto mr-3 my-3 h-[calc(100dvh-24px)] max-h-none w-[min(400px,calc(100vw-24px))] rounded-lg animate-[wCapIn_.45s_var(--ease-standard)_both]'
      : variant === 'modal'
        ? `m-auto w-[calc(100vw-32px)] ${width} rounded-xl shadow-modal animate-sheet`
        : `mx-auto mb-0 mt-auto w-full max-h-[92dvh] rounded-t-lg lg:m-auto lg:rounded-xl ${width} animate-sheet`
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : title}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={`squircle max-w-none overflow-hidden bg-surface p-0 text-ink shadow-modal backdrop:bg-scrim backdrop:backdrop-blur-[4px] ${shape}`}
    >
      {open ? (
        <div className={`flex flex-col ${variant === 'side' ? 'h-full' : 'max-h-[92dvh]'}`}>
          {variant === 'bottom' ? <span aria-hidden className="mx-auto mt-2.5 block h-1 w-9 rounded-pill bg-ink/15 lg:hidden" /> : null}
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2 sm:px-6">
            {hideTitle ? <span /> : <h2 className="text-h2 font-normal">{title}</h2>}
            <IconButton icon={X} label="Close" onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6">{children}</div>
          {footer ? <div className="border-t border-line px-5 py-4 sm:px-6">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  )
}
