import { int, interval, MIN_GROUP, pct, pts, SUPPRESSED } from './format'
import { useTooltip } from './Tooltip'

/** A suppressed value: the words, never 0 or a blank. `short` for tight cells ("n<10", full words to readers). */
export function Suppressed({ short = false }: { short?: boolean }) {
  return short ? (
    <span className="whitespace-nowrap text-proof-small text-ink-2">
      <span aria-hidden>n&lt;{MIN_GROUP}</span>
      <span className="sr-only">{SUPPRESSED}</span>
    </span>
  ) : (
    <span className="whitespace-nowrap text-proof-small text-ink-2">{SUPPRESSED}</span>
  )
}

/**
 * A rate in a table cell: "48%" in tabular mono with "n=212" beside it; the 95% interval and k of n on hover
 * or focus. Null rate → Suppressed.
 */
export function RateCell({ rate, n, lo, hi, k, showN = true }: { rate: number | null | undefined; n: number | null | undefined; lo?: number | null; hi?: number | null; k?: number | null; showN?: boolean }) {
  const ci = interval(lo, hi)
  const detail = [ci ? `95% interval ${ci}` : null, k !== null && k !== undefined && n ? `${int(k)} of ${int(n)} people` : n ? `${int(n)} people` : null].filter(Boolean).join(' · ')
  const tip = useTooltip(detail)
  if (rate === null || rate === undefined) return <Suppressed short />
  return (
    <span className="inline-flex items-baseline justify-end gap-1.5 whitespace-nowrap">
      <span {...tip.trigger} tabIndex={detail ? 0 : undefined} className={`text-proof-body tnum text-ink ${detail ? 'cursor-help' : ''}`}>
        {pct(rate)}
      </span>
      {showN && n ? <span className="text-proof-label text-ink-2 tnum">n={int(n)}</span> : null}
      {detail ? tip.node : null}
    </span>
  )
}

/**
 * A difference against non-users in points with a true minus sign (+17 pts, −4 pts); its 95% interval on hover
 * or focus. A lift at or below zero is drawn secondary, never red. Null → an em dash that says why to readers.
 */
export function LiftValue({ lift, lo, hi }: { lift: number | null | undefined; lo?: number | null; hi?: number | null }) {
  const ci = lo !== null && lo !== undefined && hi !== null && hi !== undefined ? `95% interval ${pts(lo)} to ${pts(hi)}` : ''
  const tip = useTooltip(ci)
  if (lift === null || lift === undefined)
    return (
      <span className="text-proof-body text-ink-2">
        <span aria-hidden>—</span>
        <span className="sr-only">No comparison: fewer than {MIN_GROUP} non-users</span>
      </span>
    )
  return (
    <>
      <span {...tip.trigger} tabIndex={ci ? 0 : undefined} className={`whitespace-nowrap text-proof-body tnum ${lift > 0 ? 'text-proof-leaf' : 'text-ink-2'} ${ci ? 'cursor-help' : ''}`}>
        {pts(lift)}
      </span>
      {ci ? tip.node : null}
    </>
  )
}
