import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/*
 * Willow Proof layout primitives, after Vercel's Geist: a page header (title, one line of context, actions on
 * the right), titled panels on a 12 px radius with hairline borders, 36 px buttons on a 6 px radius. One
 * accent; hierarchy comes from size, weight and space, not from labels or colour.
 */

/** Page opener: title (24 px semibold), an optional one-line description, actions on the right. */
export function PageHeader({ title, description, actions, id, leading }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string; leading?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 items-start gap-4">
        {leading}
        <div className="flex min-w-0 max-w-[760px] flex-col gap-1">
          <h1 id={id} className="m-0 text-proof-title text-ink [text-wrap:balance]">
            {title}
          </h1>
          {description ? <p className="m-0 text-proof-body text-ink-2 [&_strong]:font-medium [&_strong]:text-ink">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** Round-1 name for PageHeader; `eyebrow` is ignored (no eyebrows in Proof). */
export function SectionHeader({ title, answer, actions, id }: { eyebrow?: ReactNode; title: string; answer?: ReactNode; actions?: ReactNode; id?: string }) {
  return <PageHeader title={title} description={answer} actions={actions} id={id} />
}

/**
 * A titled surface for one chart, table or list. `title` names what it shows (16 px semibold); `meta` sits
 * beside the title (a count, a badge); `actions` on the right; `description` one quiet line under the title;
 * `footnote` for the method, only when it changes how a number reads. `flush` drops the body padding (tables).
 */
export function Panel({ title, id, meta, actions, description, footnote, children, flush = false, className = '' }: { title?: ReactNode; id?: string; meta?: ReactNode; actions?: ReactNode; description?: ReactNode; footnote?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section aria-labelledby={title && id ? id : undefined} className={`flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface ${className}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pb-1 pt-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {title ? (
                <h2 id={id} className="m-0 text-proof-h text-ink">
                  {title}
                </h2>
              ) : null}
              {meta}
            </div>
            {description ? <p className="m-0 text-proof-small text-ink-2">{description}</p> : null}
          </div>
          {actions ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={`flex min-w-0 flex-1 flex-col ${flush ? 'pt-3' : 'px-5 pb-5 pt-3'}`}>{children}</div>
      {footnote ? <div className="border-t border-line bg-pf-bg2 px-5 py-3 text-proof-small text-ink-2">{footnote}</div> : null}
    </section>
  )
}

const BTN = {
  primary: 'border-transparent bg-cta text-inverse hover:opacity-90',
  secondary: 'border-line bg-surface text-ink hover:bg-pf-hover hover:border-line-strong',
  ghost: 'border-transparent bg-transparent text-ink hover:bg-pf-hover',
} as const
type BtnKind = keyof typeof BTN
const btnClass = (kind: BtnKind, size: 'sm' | 'md' | 'lg') =>
  `hit44 inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border font-medium no-underline transition-[background,border-color,opacity,transform] duration-150 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 ${size === 'sm' ? 'h-8 px-2.5 text-proof-small' : size === 'lg' ? 'h-10 px-4 text-proof-body' : 'h-9 px-3 text-proof-small'} ${BTN[kind]}`

/** A Geist button: primary (filled ink), secondary (bordered), ghost. `to` renders a router link. */
export function Button({ children, onClick, to, kind = 'secondary', size = 'md', disabled, label, type = 'button', title }: { children: ReactNode; onClick?: () => void; to?: string; kind?: BtnKind; size?: 'sm' | 'md' | 'lg'; disabled?: boolean; label?: string; type?: 'button' | 'submit'; title?: string }) {
  if (to && !disabled)
    return (
      <Link to={to} aria-label={label} title={title} className={btnClass(kind, size)}>
        {children}
      </Link>
    )
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={label} title={title} className={btnClass(kind, size)}>
      {children}
    </button>
  )
}

/** Small secondary control (toolbars, panel actions). `pressed` makes it a toggle. */
export function ToolButton({ children, onClick, pressed, label, disabled }: { children: ReactNode; onClick: () => void; pressed?: boolean; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      disabled={disabled}
      className={`hit44 inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-ctl border px-3 text-proof-small transition-colors duration-150 active:scale-[.98] disabled:opacity-50 ${pressed ? 'border-ink bg-surface text-ink' : 'border-line bg-surface text-ink hover:border-line-strong hover:bg-pf-hover'}`}
    >
      {children}
    </button>
  )
}

const BADGE = {
  gray: 'bg-sunken text-ink-2',
  green: 'bg-proof-leaf-soft text-proof-leaf',
  amber: 'bg-pf-amber-soft text-pf-amber',
  red: 'bg-pf-red-soft text-pf-red',
  outline: 'border border-line text-ink-2',
} as const

/** A Geist badge: short static metadata next to what it describes. Colour carries status; the word carries it too. */
export function Badge({ children, tone = 'gray', title }: { children: ReactNode; tone?: keyof typeof BADGE; title?: string }) {
  return (
    <span title={title} className={`inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-proof-label font-medium ${BADGE[tone]}`}>
      {children}
    </span>
  )
}
