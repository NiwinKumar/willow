import type { ReactNode } from 'react'

import { feltText } from '../feel'
import type { ProductRow } from '../types'
import { int, interval, pct, Suppressed, useTooltip } from '../ui'

/*
 * Small pieces shared by Products and Compare: a column header that carries its definition in a tooltip, and
 * the visible-change rate with a light interval bar (rate dot, 95% whisker, non-users tick).
 */

/** A column or row label whose definition shows on hover or focus (never in running text). */
export function HeadTip({ label, tip }: { label: string; tip: ReactNode }) {
  const t = useTooltip(tip)
  return (
    <>
      <span {...t.trigger} tabIndex={0} className="cursor-help underline decoration-line-strong decoration-dotted underline-offset-4">
        {label}
      </span>
      {t.node}
    </>
  )
}

/**
 * A visible-change rate as "77%" beside a 0–100% track: the rate as a leaf dot, its 95% interval as a soft
 * bar, non-users as a grey tick. Interval, n and non-users are in the tooltip and the accessible name.
 * `strong` sets the figure semibold (Compare's leader); `wide` gives the bar more room.
 */
export function RateInterval({ rate, lo, hi, base, n, weeks, strong = false, wide = false }: { rate: number; lo: number | null; hi: number | null; base: number | null; n: number | null; weeks: number; strong?: boolean; wide?: boolean }) {
  const ci = interval(lo, hi)
  const text = `${pct(rate)}${n ? ` of ${int(n)} people` : ''} saw a visible change by week ${weeks}${ci ? ` (95% interval ${ci})` : ''}.${base !== null ? ` Non-users with the same goals: ${pct(base)}.` : ''}`
  const tip = useTooltip(text)
  const x = (v: number) => `${Math.max(0, Math.min(100, v * 100))}%`
  return (
    <>
      <span {...tip.trigger} tabIndex={0} className="flex cursor-help items-center gap-3">
        <span className={`w-9 shrink-0 text-right tnum text-ink ${strong ? 'font-semibold' : ''}`}>{pct(rate)}</span>
        <span aria-hidden className={`relative block h-3 min-w-12 flex-1 ${wide ? 'max-w-[220px]' : 'max-w-[112px]'}`}>
          <span className="absolute inset-x-0 top-1/2 block h-px -translate-y-1/2 bg-line" />
          {lo !== null && hi !== null ? <span className="absolute top-1/2 block h-1 -translate-y-1/2 rounded-pill bg-proof-leaf-line" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} /> : null}
          {base !== null ? <span className="absolute top-0 block h-3 w-px -translate-x-1/2 bg-[var(--pf-base)]" style={{ left: x(base) }} /> : null}
          <span className="absolute top-1/2 block size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-proof-leaf" style={{ left: x(rate) }} />
        </span>
      </span>
      {tip.node}
    </>
  )
}

/** "Feels it works" (self-reported) in a table cell: the whole percent, its n on hover or focus; n<10 when suppressed. */
export function FeltCell({ r }: { r: Pick<ProductRow, 'felt' | 'felt_n'> }) {
  const t = feltText(r)
  const tip = useTooltip(t?.tip ?? '')
  if (!t) return <Suppressed short />
  return (
    <>
      <span {...tip.trigger} tabIndex={0} className="cursor-help tnum text-ink">
        {t.value}
      </span>
      {tip.node}
    </>
  )
}
