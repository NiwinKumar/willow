import type { ReactNode } from 'react'

/**
 * The routine builder's building blocks, in onboarding's look (features/website/Welcome.tsx): a step frame
 * that fits one screen with its action bar always in view, glass cards, black-pill choices and the ink button.
 */

/** One step: eyebrow, serif title, the content (scrolls inside only when it must) and the action bar. */
export function Frame({ eyebrow, title, sub, aside, children, actions, wide }: { eyebrow: string; title: ReactNode; sub?: ReactNode; aside?: ReactNode; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  return (
    <div className={`relative mx-auto flex h-full min-h-0 w-full flex-col px-[clamp(14px,3vw,32px)] sm:justify-center sm:pb-[2vh] ${wide ? 'max-w-[1040px]' : 'max-w-[760px]'}`}>
      <div className="flex items-end justify-between gap-4 pt-[clamp(10px,2.4vh,28px)] pb-[clamp(8px,1.8vh,16px)] sm:pt-0">
        <div className="min-w-0">
          <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ {eyebrow}</span>
          <h1 className="mt-1.5 mb-0 font-serif text-h1 font-normal sm:text-greeting [@media(max-height:700px)]:text-[28px]">{title}</h1>
          {sub ? <p className="mt-1 mb-0 text-[14px] leading-[1.4] text-ink-2 [@media(max-height:640px)]:hidden">{sub}</p> : null}
        </div>
        {aside}
      </div>
      <div className="no-scrollbar -mx-3 -mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-3 sm:flex-initial">{children}</div>
      {actions ? <div className="flex flex-col gap-2 pt-2.5 pb-[max(14px,env(safe-area-inset-bottom))]">{actions}</div> : null}
    </div>
  )
}

/** A titled group inside a card. */
export function Field({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-[clamp(10px,1.7vh,16px)] sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[15.5px]">{title}</span>
        {note ? <span className="text-[12.5px] text-ink-2">{note}</span> : null}
      </div>
      {children}
    </div>
  )
}

/** White-pill choices on a translucent track (single choice: role radio; several: aria-pressed). */
export function Pills<T extends string | number | boolean>({ label, options, value, onChange, multi }: {
  label: string
  options: { id: T; label: string }[]
  value: T | T[]
  onChange: (v: T) => void
  multi?: boolean
}) {
  const on = (id: T) => (Array.isArray(value) ? value.includes(id) : value === id)
  return (
    <div role={multi ? 'group' : 'radiogroup'} aria-label={label} className="flex flex-wrap gap-1 self-start rounded-[22px] bg-muted p-1">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role={multi ? undefined : 'radio'}
          aria-checked={multi ? undefined : on(o.id)}
          aria-pressed={multi ? on(o.id) : undefined}
          onClick={() => onChange(o.id)}
          className={`min-h-9 rounded-pill px-3.5 text-[14px] text-ink transition-[background-color,box-shadow,transform] duration-200 ease-standard active:scale-95 ${on(o.id) ? 'bg-white shadow-[0_1px_4px_rgba(0,0,0,.08)]' : 'bg-transparent hover:bg-white/45'}`}
        >
          {multi && on(o.id) ? <span aria-hidden className="mr-1.5 inline-block animate-[wDotIn_.25s_var(--ease-bounce)_both]">✓</span> : null}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The round tick in a choice card's corner: pops in when chosen; a number when order matters. */
export function Tick({ on, n, light }: { on: boolean; n?: number; light?: boolean }) {
  return (
    <span aria-hidden className={`grid size-6 flex-none place-items-center rounded-full border-[1.5px] text-[12px] transition-colors duration-200 ${on ? 'border-transparent bg-selected text-inverse' : light ? 'border-white/80 bg-white/30' : 'border-ink/25 bg-white/40'}`}>
      {on ? <span key={n ?? 'on'} className="animate-[wDotIn_.28s_var(--ease-bounce)_both] font-medium">{n ?? '✓'}</span> : null}
    </span>
  )
}
