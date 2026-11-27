import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useClampToViewport } from './useClamp'

/**
 * A button that opens a small panel under it (account menu, "Advanced", dismiss reasons). Closes on a click
 * outside, Esc (focus back on the button) or when `close()` from the render prop runs. The panel fades in;
 * under reduced motion the shared rule turns it into a plain appear.
 */
export function Menu({ trigger, label, children, align = 'left', width = 280, className = '', triggerClass }: { trigger: ReactNode; label: string; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: number; className?: string; triggerClass?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const clamp = useClampToViewport(pop, open)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      btn.current?.focus()
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass ?? 'hit44 inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line bg-surface px-3 text-proof-small text-ink hover:border-line-strong hover:bg-pf-hover'}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={pop}
          role="menu"
          aria-label={label}
          style={{ width, ...clamp }}
          className={`absolute top-[calc(100%+6px)] z-[70] flex max-h-[min(70vh,560px)] max-w-[calc(100vw-32px)] flex-col overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-[0_0_0_1px_var(--line-subtle),0_16px_24px_-8px_rgba(0,0,0,.14)] animate-[proofDrop_.14s_var(--ease-standard)_both] ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

/** One row in a Menu: a label and an optional quiet line under it. */
export function MenuItem({ children, sub, onClick, disabled, current }: { children: ReactNode; sub?: ReactNode; onClick: () => void; disabled?: boolean; current?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      aria-current={current ? 'true' : undefined}
      className={`flex w-full flex-col items-start gap-0.5 rounded-ctl border-0 px-3 py-2 text-left transition-colors hover:bg-pf-hover disabled:cursor-not-allowed disabled:opacity-50 ${current ? 'bg-pf-hover' : 'bg-transparent'}`}
    >
      <span className="flex w-full items-center gap-2 text-proof-body text-ink">{children}</span>
      {sub ? <span className="text-proof-label text-ink-2">{sub}</span> : null}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <span className="px-3 pb-1 pt-2 text-proof-label font-medium text-ink-2">{children}</span>
}

export function MenuDivider() {
  return <span aria-hidden className="my-1 h-px bg-line" />
}
