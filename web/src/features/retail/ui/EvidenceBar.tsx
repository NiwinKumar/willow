import { int, interval, pct, SUPPRESSED } from './format'

/**
 * A visible-change rate on a 0–`max` track: ember dot at the rate (ember = visible change), its 95% interval as a
 * whisker, a tick at the base rate (non-users), and the n. Null rate: a hatched track and "Fewer than 10
 * people". `baseLabel` names the tick ("market" on Competitors). The visible n keeps the denominator next to every rate; the accessible name says it all in words.
 */
export function EvidenceBar({ rate, lo, hi, base, n, max = 1, showN = true, className = '', baseLabel = 'non-users' }: { rate: number | null; lo?: number | null; hi?: number | null; base?: number | null; n?: number | null; max?: number; showN?: boolean; className?: string; baseLabel?: string }) {
  if (rate === null) {
    return (
      <span className={`flex items-center gap-2.5 ${className}`}>
        <span aria-hidden className="retail-hatch block h-1.5 min-w-16 flex-1 rounded-pill" />
        <span className="whitespace-nowrap text-proof-small text-ink-2">{SUPPRESSED}</span>
      </span>
    )
  }
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  const ci = interval(lo, hi)
  const label = `${pct(rate)} had a visible change${ci ? `, 95% interval ${ci}` : ''}${base !== null && base !== undefined ? `; ${baseLabel} ${pct(base)}` : ''}${n ? `; ${int(n)} people` : ''}`
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span role="img" aria-label={label} className="relative block h-3 min-w-16 flex-1">
        <span aria-hidden className="absolute inset-x-0 top-1/2 block h-1 -translate-y-1/2 rounded-pill bg-muted" />
        {lo !== null && lo !== undefined && hi !== null && hi !== undefined ? (
          <span aria-hidden className="absolute top-1/2 block h-1 -translate-y-1/2 rounded-pill bg-ink/35" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
        ) : null}
        {base !== null && base !== undefined ? <span aria-hidden className="absolute top-0 block h-3 w-px bg-ink-2" style={{ left: x(base) }} /> : null}
        <span aria-hidden className="absolute top-1/2 block size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal ring-2 ring-surface" style={{ left: x(rate) }} />
      </span>
      {showN && n ? <span className="w-[52px] shrink-0 whitespace-nowrap text-right text-proof-label text-ink-2 tnum">n={int(n)}</span> : null}
    </span>
  )
}
