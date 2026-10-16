import { int, interval, MIN_GROUP, pct, pts, SUPPRESSED, useTooltip } from '../../ui'
import type { VsRow } from './model'

/*
 * "You against the market" rows: one line per goal (or skin type) on a shared 0–100% track. Leaf dot = the
 * brand's visible-change rate with its 95% interval as a soft band; gray tick = the market (everyone using a
 * product for that goal); a hollow ring = the best competitor. A thin line joins the brand to the market, so
 * the gap reads as a length. Numbers sit in columns beside the track; details (n, interval) on hover or focus.
 */

/** A linear scale over [lo, hi] as CSS percentages, with gridlines at quarters and labels at the ends. */
type Scale = { at: (v: number) => string; span: (a: number, b: number) => string; grid: number[]; labels: number[] }
function scaleOf([lo, hi]: [number, number]): Scale {
  const f = (v: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)))
  const q = (k: number) => Math.round((lo + (hi - lo) * k) * 1000) / 1000
  return {
    at: (v) => `${f(v) * 100}%`,
    span: (a, b) => `${Math.abs(f(b) - f(a)) * 100}%`,
    grid: [0, 0.25, 0.5, 0.75, 1].map(q),
    labels: [0, 1].map(q),
  }
}

/*
 * Layout per container width (literal classes, so Tailwind sees them): wide = one line per row (label · your
 * rate · track · gap · best competitor); narrow = label, rate and gap on one line, the track full width under
 * them. Goal rows (with a competitor) need ~512 px for one line; skin rows (no competitor) ~320 px.
 */
const LAYOUT = {
  rival: {
    grid: 'grid-cols-[minmax(0,1fr)_auto_auto] @lg:grid-cols-[minmax(96px,128px)_44px_minmax(120px,1fr)_68px_minmax(108px,148px)]',
    gap: 'order-3 @lg:order-4',
    axis: 'order-4 hidden @lg:order-3 @lg:block',
    track: 'order-4 col-span-3 @lg:order-3 @lg:col-span-1',
    rival: 'order-5 col-span-3 @lg:col-span-1',
    rivalHead: 'order-5 hidden @lg:block',
    rivalWord: '@lg:hidden',
  },
  plain: {
    grid: 'grid-cols-[minmax(0,1fr)_auto_auto] @xs:grid-cols-[minmax(72px,96px)_40px_minmax(80px,1fr)_56px]',
    gap: 'order-3 @xs:order-4',
    axis: 'order-4 hidden @xs:order-3 @xs:block',
    track: 'order-4 col-span-3 @xs:order-3 @xs:col-span-1',
    rival: '',
    rivalHead: '',
    rivalWord: '',
  },
} as const

export function VsMarketRows({ rows, rival = false, youLabel, labelHeader, selected, caption, domain = [0, 1] }: { rows: VsRow[]; rival?: boolean; youLabel: string; labelHeader: string; selected?: string | null; caption: string; domain?: [number, number] }) {
  const L = LAYOUT[rival ? 'rival' : 'plain']
  const sc = scaleOf(domain)
  return (
    <div role="table" aria-label={caption} className="@container flex flex-col">
      <div role="rowgroup">
        <div role="row" className={`grid items-end gap-x-4 border-b border-line pb-2 text-proof-label text-ink-2 ${L.grid}`}>
          <span role="columnheader" className="order-1">
            {labelHeader}
          </span>
          <span role="columnheader" className="order-2 text-right">
            {youLabel}
          </span>
          <span role="columnheader" className={`text-right ${L.gap}`}>
            vs market
          </span>
          <span role="columnheader" aria-label={`Scale, ${Math.round(domain[0] * 100)} to ${Math.round(domain[1] * 100)}%`} className={`relative h-4 ${L.axis}`}>
            {sc.labels.map((t, i) => (
              <span key={t} aria-hidden className="absolute bottom-0 tnum" style={{ left: sc.at(t), transform: i === 0 ? 'none' : 'translateX(-100%)' }}>
                {Math.round(t * 100)}%
              </span>
            ))}
          </span>
          {rival ? (
            <span role="columnheader" className={L.rivalHead}>
              Best competitor
            </span>
          ) : null}
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((r) => (
          <Row key={r.id} r={r} L={L} sc={sc} rival={rival} youLabel={youLabel} on={selected === r.id} />
        ))}
      </div>
    </div>
  )
}

function Row({ r, L, sc, rival, youLabel, on }: { r: VsRow; sc: Scale; L: (typeof LAYOUT)[keyof typeof LAYOUT]; rival: boolean; youLabel: string; on: boolean }) {
  const ci = r.you ? interval(r.you.lo, r.you.hi) : null
  const gap = r.you && r.market ? r.you.rate - r.market.rate : null
  const detail = [
    r.you ? `${youLabel} ${pct(r.you.rate)}${r.you.n ? ` of ${int(r.you.n)} people` : ''}${ci ? ` (95% interval ${ci})` : ''}` : `${youLabel}: ${SUPPRESSED.toLowerCase()}`,
    r.market ? `Market ${pct(r.market.rate)}${r.market.n ? ` of ${int(r.market.n)}` : ''}` : 'Market: fewer than 10 people',
    r.rival ? `Best competitor ${r.rival.brand} ${pct(r.rival.rate)} of ${int(r.rival.n)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const tip = useTooltip(detail)
  return (
    <div role="row" className={`grid min-h-[52px] items-center gap-x-4 gap-y-1.5 border-b border-line py-2 last:border-b-0 ${L.grid} ${on ? 'bg-pf-bg2 shadow-[inset_2px_0_0_var(--text-primary)] -mx-5 px-5' : ''}`}>
      <span role="rowheader" className="order-1 flex min-w-0 flex-col">
        <span className="truncate text-proof-body text-ink" title={r.label}>
          {r.label}
        </span>
        {r.sub ? <span className="truncate text-proof-label text-ink-2 tnum">{r.sub}</span> : null}
      </span>
      <span role="cell" className="order-2 text-right text-proof-body text-ink tnum">
        {r.you ? (
          <span {...tip.trigger} tabIndex={0} className="cursor-help">
            {pct(r.you.rate)}
          </span>
        ) : (
          <span className="text-proof-small text-ink-2">
            <span aria-hidden>n&lt;{MIN_GROUP}</span>
            <span className="sr-only">{SUPPRESSED}</span>
          </span>
        )}
        {r.you ? tip.node : null}
      </span>
      <span role="cell" className={`text-right text-proof-body tnum ${L.gap} ${gap !== null && Math.round(gap * 100) > 0 ? 'text-proof-leaf' : 'text-ink-2'}`}>
        {gap === null ? '—' : pts(gap)}
      </span>
      <span role="cell" aria-label={detail} className={`relative block h-5 ${L.track}`}>
        {sc.grid.map((t) => (
          <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-[var(--line-subtle)]" style={{ left: sc.at(t) }} />
        ))}
        {r.you && r.market ? <span aria-hidden className="absolute top-1/2 h-px -translate-y-1/2 bg-ink-3" style={{ left: sc.at(Math.min(r.you.rate, r.market.rate)), width: sc.span(r.you.rate, r.market.rate) }} /> : null}
        {r.you && r.you.lo !== null && r.you.lo !== undefined && r.you.hi !== null && r.you.hi !== undefined ? (
          <span aria-hidden className="absolute top-1/2 h-2 -translate-y-1/2 rounded-pill border border-proof-leaf-line bg-proof-leaf-soft" style={{ left: sc.at(r.you.lo), width: sc.span(r.you.lo, r.you.hi) }} />
        ) : null}
        {r.market ? <span aria-hidden className="absolute top-0.5 bottom-0.5 w-0.5 -translate-x-1/2 rounded-pill bg-[var(--pf-base)]" style={{ left: sc.at(r.market.rate) }} /> : null}
        {r.rival ? <span aria-hidden className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-ink-2 bg-surface" style={{ left: sc.at(r.rival.rate) }} /> : null}
        {r.you ? <span aria-hidden className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-proof-leaf ring-2 ring-surface" style={{ left: sc.at(r.you.rate) }} /> : <span aria-hidden className="retail-hatch absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-pill" />}
      </span>
      {rival ? (
        <span role="cell" className={`flex min-w-0 items-baseline gap-1.5 text-proof-small ${L.rival}`}>
          {r.rival ? (
            <>
              <span className={`text-ink-2 ${L.rivalWord}`}>Best competitor</span>
              <span className="truncate text-ink" title={r.rival.brand}>
                {r.rival.brand}
              </span>
              <span className="shrink-0 text-ink-2 tnum">{pct(r.rival.rate)}</span>
            </>
          ) : (
            <span className="text-ink-2">No competitor with {MIN_GROUP}+</span>
          )}
        </span>
      ) : null}
    </div>
  )
}

/** The legend for the rows, as one quiet line (Panel description). */
export function VsLegend({ you, rival = false, interval: band = true }: { you: string; rival?: boolean; interval?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        {band ? (
          <span aria-hidden className="relative inline-block h-2 w-5 rounded-pill border border-proof-leaf-line bg-proof-leaf-soft">
            <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-proof-leaf" />
          </span>
        ) : (
          <span aria-hidden className="inline-block size-2.5 rounded-full bg-proof-leaf" />
        )}
        {band ? `${you}, with 95% interval` : you}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3 w-0.5 rounded-pill bg-[var(--pf-base)]" />
        Market
      </span>
      {rival ? (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-full border-[1.5px] border-ink-2" />
          Best competitor
        </span>
      ) : null}
    </span>
  )
}
