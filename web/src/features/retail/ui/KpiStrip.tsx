import type { ReactNode } from 'react'

export type Kpi = {
  id: string
  /** What is counted, in words ("Products with outcomes"). */
  label: ReactNode
  /** The figure as shown; "—" when suppressed. Doto numerals (the only hero numbers in Proof). */
  value: string
  unit?: string
  /** The denominator or source, always present ("473 of 505 people"). */
  note: ReactNode
}

/**
 * The Overview KPI strip: one surface split by hairlines (not a row of separate cards), Doto hero numerals,
 * unit beside, the n underneath. Wraps to two columns on tablets and one on phones.
 */
export function KpiStrip({ items, label = 'Key figures' }: { items: Kpi[]; label?: string }) {
  return (
    <section aria-label={label} className="grid grid-cols-2 overflow-hidden rounded-sm border border-line bg-surface xl:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ ['--n' as string]: items.length }}>
      {items.map((k) => (
        <div key={k.id} className="flex min-w-0 flex-col gap-2.5 border-line px-3.5 py-3 sm:px-4 sm:py-3.5 [&:not(:last-child)]:border-b [&:nth-child(odd):not(:last-child)]:border-r [&:last-child:nth-child(odd)]:col-span-2 xl:border-b-0 xl:[&:last-child:nth-child(odd)]:col-span-1 xl:[&:not(:last-child)]:border-r">
          <span className="truncate text-proof-small text-ink-2">{k.label}</span>
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-dot text-proof-kpi text-ink">{k.value}</span>
            {k.unit ? <span className="text-proof-body text-ink-2">{k.unit}</span> : null}
          </span>
          <span className="font-mono text-[11px] text-ink-2 xl:truncate">{k.note}</span>
        </div>
      ))}
    </section>
  )
}
