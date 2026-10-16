import type { ReactNode } from 'react'

export type Kpi = {
  id: string
  /** What is counted, in words ("Proven products"). */
  label: ReactNode
  /** The figure as shown; "—" when suppressed. */
  value: string
  unit?: string
  /** The denominator or comparison, one short line ("of 12 measured", "+6 pts vs market"). */
  note: ReactNode
  /** Makes the tile a link or a button (opens the view behind the figure). */
  onClick?: () => void
}

/**
 * Key figures (Geist metric row): one bordered surface split by hairlines, the value at 28 px semibold with its
 * unit beside, the comparison underneath. Wraps to two columns on tablets and one on phones.
 */
export function KpiStrip({ items, label = 'Key figures' }: { items: Kpi[]; label?: string }) {
  return (
    <section aria-label={label} className="grid grid-cols-1 overflow-hidden rounded-card border border-line bg-surface sm:grid-cols-2 xl:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ ['--n' as string]: items.length }}>
      {items.map((k) => {
        const body = (
          <>
            <span className="truncate text-proof-small text-ink-2">{k.label}</span>
            <span className="flex flex-wrap items-baseline gap-x-1">
              <span className="text-proof-kpi text-ink tnum">{k.value}</span>
              {k.unit ? <span className="text-proof-body text-ink-2">{k.unit}</span> : null}
            </span>
            <span className="text-proof-small text-ink-2 xl:truncate">{k.note}</span>
          </>
        )
        const cls = 'flex min-w-0 flex-col gap-1.5 border-line px-5 py-4 text-left [&:not(:last-child)]:border-b sm:[&:nth-child(odd):not(:last-child)]:border-r xl:border-b-0 xl:[&:not(:last-child)]:border-r'
        return k.onClick ? (
          <button key={k.id} type="button" onClick={k.onClick} className={`${cls} border-0 bg-transparent transition-colors hover:bg-pf-hover`}>
            {body}
          </button>
        ) : (
          <div key={k.id} className={cls}>
            {body}
          </div>
        )
      })}
    </section>
  )
}
