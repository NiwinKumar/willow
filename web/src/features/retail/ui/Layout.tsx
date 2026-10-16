import type { ReactNode } from 'react'

/**
 * Section opener: eyebrow (■ CAPS, the Willow label), the title in Instrument Serif (the one serif on the
 * screen), the one-line answer to the section's question, and actions on the right. Insight first: the
 * answer sits above every chart.
 */
export function SectionHeader({ eyebrow, title, answer, actions, id }: { eyebrow?: ReactNode; title: string; answer?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 max-w-[880px] flex-col gap-1.5">
        {eyebrow ? <span className="eyebrow">■ {eyebrow}</span> : null}
        <h1 id={id} className="m-0 font-serif text-proof-title font-normal text-ink">
          {title}
        </h1>
        {answer ? <p className="m-0 max-w-[80ch] text-proof-answer text-ink-2 [&_strong]:font-normal [&_strong]:text-ink">{answer}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/**
 * A titled surface for one chart or table. `title` is the question it answers (14 px, medium); `meta` sits
 * right of it (badges, counts); `actions` far right (export, toggles); `footnote` explains method and units.
 * `flush` drops the body padding for edge-to-edge tables.
 */
export function Panel({ title, id, meta, actions, footnote, children, flush = false, className = '' }: { title?: ReactNode; id?: string; meta?: ReactNode; actions?: ReactNode; footnote?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section aria-labelledby={title && id ? id : undefined} className={`flex min-w-0 flex-col rounded-sm border border-line bg-surface ${className}`}>
      {title || actions ? (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {title ? (
              <h2 id={id} className="m-0 text-proof-h font-medium text-ink">
                {title}
              </h2>
            ) : null}
            {meta}
          </div>
          {actions ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      <div className={`flex min-w-0 flex-1 flex-col ${flush ? '' : 'p-4'}`}>{children}</div>
      {footnote ? <div className="border-t border-line px-4 py-2.5 text-proof-small text-ink-2">{footnote}</div> : null}
    </section>
  )
}

/** Small secondary control, the size every toolbar uses (32 px tall, 44 px hit area via .hit44). */
export function ToolButton({ children, onClick, pressed, label, disabled }: { children: ReactNode; onClick: () => void; pressed?: boolean; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      disabled={disabled}
      className={`hit44 inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xs border px-2.5 text-proof-small transition-colors duration-150 active:scale-[.98] ${pressed ? 'border-proof-leaf-line bg-proof-leaf-soft text-ink' : 'border-line-strong text-ink hover:bg-glass'}`}
    >
      {children}
    </button>
  )
}
