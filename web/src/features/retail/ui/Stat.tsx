import type { ReactNode } from 'react'

/**
 * A figure on a detail page: label, the value (20 px semibold, tabular), and the denominator or interval under
 * it. A <dt>/<dd> pair: wrap a list of them in <dl>.
 */
export function Stat({ label, value, sub, className = '' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <dt className="truncate text-proof-small text-ink-2">{label}</dt>
      <dd className="m-0 flex flex-col gap-0.5">
        <span className="text-[20px] font-semibold leading-7 tracking-[-0.02em] text-ink tnum">{value}</span>
        {sub ? <span className="truncate text-proof-label text-ink-2 tnum">{sub}</span> : null}
      </dd>
    </div>
  )
}
