import type { ReactNode } from 'react'

/**
 * The settings page's two building blocks: a Group (a small heading over one card) and a Row (the setting's
 * name and a line of help on the left, its control on the right; `stack` puts the control below, for chips).
 * Rows inside a group are divided by hairlines, so every setting reads the same way.
 */
export function Group({ id, title, children, tone = 'plain' }: { id: string; title: string; children: ReactNode; tone?: 'plain' | 'danger' }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-24 flex-col gap-2">
      <h2 id={`${id}-h`} className="m-0 px-1 text-[13px] font-normal text-ink-2">
        {title}
      </h2>
      <div className={`flex flex-col divide-y rounded-[24px] px-5 squircle ${tone === 'danger' ? 'divide-coral/25 bg-surface shadow-[inset_0_0_0_1px_rgba(255,107,74,.35)]' : 'divide-ink/[.07] bg-surface'}`}>{children}</div>
    </section>
  )
}

export function Row({ label, hint, children, stack = false, id }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; stack?: boolean; id?: string }) {
  return (
    <div id={id} className={`flex scroll-mt-24 gap-x-6 gap-y-3 py-4 ${stack ? 'flex-col' : 'flex-wrap items-center justify-between'}`}>
      <div className={`flex min-w-0 flex-col gap-0.5 ${stack ? '' : 'flex-[1_1_240px]'}`}>
        <span className="text-[15px]">{label}</span>
        {hint ? <span className="text-[13px] leading-[1.45] text-ink-2">{hint}</span> : null}
      </div>
      {children ? <div className={stack ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-2'}>{children}</div> : null}
    </div>
  )
}

/** A toggle in a group: the same padding as a Row. */
export function ToggleRow({ children }: { children: ReactNode }) {
  return <div className="py-2.5">{children}</div>
}
