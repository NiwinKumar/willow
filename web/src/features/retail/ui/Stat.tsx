import type { ReactNode } from 'react'

/**
 * A compact figure for detail pages (not a hero KPI): label above, the value in tabular mono at 20 px, and the
 * denominator or interval under it. A <dt>/<dd> pair: wrap a list of them in <dl>.
 */
export function Stat({ label, value, sub, className = '' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <dt className="truncate text-proof-small text-ink-2">{label}</dt>
      <dd className="m-0 flex flex-col gap-1">
        <span className="font-mono text-[20px] leading-none text-ink tnum">{value}</span>
        {sub ? <span className="truncate font-mono text-[11px] text-ink-2 tnum">{sub}</span> : null}
      </dd>
    </div>
  )
}
