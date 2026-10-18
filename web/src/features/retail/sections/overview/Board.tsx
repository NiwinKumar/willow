import type { ReactNode } from 'react'

import { sectionPath, useRetailState } from '../../state'
import type { BrandSummary, Insights, ProductRow, Products } from '../../types'
import { cohortKind, int, MIN_GROUP, pct, pts, SkeletonPanel } from '../../ui'
import { DotMatrix, GlowStat, BrandBars, PillColumns, PillStack, TickGauge, type GlowPoint, type StackSegment, type StackTone } from '../../ui/widgets'

/*
 * The overview's widget board, laid out to fit one screen: the spotlight beside the market curve, a row of three
 * small tiles, then the goals beside the top brands. Every card is over the live aggregates. Every figure is derived here from what
 * the api sends (insights, the product rows, the brand summary); a card whose numbers are under 10 people is left
 * out rather than drawn from nothing.
 *   Spotlight · Goals with a visible change (curve)
 *   Products by proof level (stack) · Still using at week 8 (gauge) · People with / without a visible change (dots)
 *   Visible change by goal (columns) · Brands by visible change (bars)
 */

/** Short names for the goals under the capsule columns (the full name is in the tooltip and the table). */
const GOAL_SHORT: Record<string, string> = { oil_glow: 'Shine', blemishes: 'Blemish', pores_texture: 'Pores', even_tone: 'Tone', dark_spots: 'Spots', redness: 'Redness', under_eye: 'Eyes', lines: 'Lines' }

type Curve = { weeks: number[]; share: number[]; people: number; base: number | null; baseN: number }

/**
 * The market curve: across every goal people pursue with a product of a category, the share who had a visible
 * change by each reading week (flows' `changed` over `n`), plus the same goals' non-users at the last week.
 */
function marketCurve(d: Insights): Curve | null {
  const flows = (d.categories ?? []).flatMap((c) => c.flows)
  const weeks = flows[0]?.weeks
  if (!weeks?.length) return null
  const same = flows.filter((f) => f.weeks.length === weeks.length && f.weeks.every((w, i) => w === weeks[i]))
  const people = same.reduce((s, f) => s + f.n, 0)
  if (people < MIN_GROUP) return null
  const share = weeks.map((_, i) => same.reduce((s, f) => s + f.changed[i], 0) / people)
  const bases = same.flatMap((f) => (f.base ? [f.base] : []))
  const baseN = bases.reduce((s, b) => s + b.n, 0)
  return { weeks, share, people, base: baseN >= MIN_GROUP ? bases.reduce((s, b) => s + b.k, 0) / baseN : null, baseN }
}

/** People-weighted rate over measured rows (null under 10 people in all). */
function weighted(rows: ProductRow[], key: 'rate' | 'cont8'): { value: number; n: number } | null {
  let s = 0
  let n = 0
  for (const r of rows) {
    const v = r[key]
    if (v === null || r.n === null) continue
    s += v * r.n
    n += r.n
  }
  return n >= MIN_GROUP ? { value: s / n, n } : null
}

type Cont = { value: number; n: number | null }

/** Still using at week 8: a brand's own figure, else the api's whole-cohort count, else the people-weighted rows. */
function contOf(d: Insights, all: Products, rows: ProductRow[], brand: string | null, summary: BrandSummary | null): Cont | null {
  if (brand) {
    if (summary) return summary.cont8 !== null ? { value: summary.cont8, n: null } : null
    const w = weighted(rows, 'cont8')
    return w ? { value: w.value, n: w.n } : null
  }
  const k = d.kpis?.continuation_wk8
  if (k) return { value: k.rate, n: k.n }
  const w = weighted(all.products, 'cont8')
  return w ? { value: w.value, n: w.n } : null
}

const STACK: { id: string; label: string; tone: StackTone; match: (r: ProductRow) => boolean }[] = [
  { id: 'proven', tone: 'green', label: 'Proven', match: (r) => r.tier === 'proven' },
  { id: 'promising', tone: 'amber', label: 'Promising', match: (r) => r.tier === 'promising' },
  { id: 'unclear', tone: 'grey', label: 'No clear effect yet', match: (r) => r.tier === 'unclear' },
  { id: 'few', tone: 'hollow', label: 'Under 10 people', match: (r) => r.tier === 'too_few' && r.reason === 'few' },
  { id: 'unmeasured', tone: 'hollow', label: 'Goal not measured yet', match: (r) => r.tier === 'too_few' && r.reason === 'not_measured' },
  { id: 'unused', tone: 'hollow', label: 'Not used by anyone', match: (r) => r.tier === 'too_few' && (r.reason === 'unused' || r.reason === undefined) },
]

export function WidgetBoard({ d, all, rows, brand, summary, spotlight }: { d: Insights; all: Products | null; rows: ProductRow[]; brand: string | null; summary: BrandSummary | null; spotlight: ReactNode }) {
  const { carry } = useRetailState()
  if (!all) return <SkeletonPanel height={560} />
  const kind = cohortKind(d.cohort)
  const people = d.cohort.synthetic + d.cohort.real
  const to = (section: Parameters<typeof sectionPath>[0]) => `${sectionPath(section)}${carry}`

  /* ── visible change over time (glow) ── */
  const curve = marketCurve(d)
  const last = curve ? curve.share.at(-1)! : null
  const points: GlowPoint[] = curve ? [{ x: 0, y: 0, label: 'Start' }, ...curve.weeks.map((w, i) => ({ x: w, y: curve.share[i], label: `Week ${w}` }))] : []
  const lift = curve && last !== null && curve.base !== null ? last - curve.base : null

  /* ── visible change by goal ── */
  const needs = [...d.needs].sort((a, b) => b.n - a.n)
  /* of the people already at the last reading: how many of them saw a visible change (those still early are left out, so a young cohort doesn't drag every goal toward 0) */
  const reached = (r: (typeof needs)[number]) => (r.n * (r.real + r.none)) / 100
  const measured = needs.filter((r) => reached(r) >= MIN_GROUP)
  const measuredPeople = measured.reduce((s, r) => s + reached(r), 0)
  const columns = measured.map((r) => ({ id: r.goal_id ?? r.goal, label: GOAL_SHORT[r.goal_id ?? ''] ?? r.goal.split(' ')[0], name: r.goal, n: r.n, share: r.real / (r.real + r.none) }))

  /* ── still using at the last week ── */
  const cont = contOf(d, all, rows, brand, summary)

  /* ── brands (list) ── */
  const brands = d.brands.slice(0, 5)

  /* ── catalog by proof  ── */
  const segments: StackSegment[] = STACK.map((s) => ({ id: s.id, label: s.label, value: rows.filter(s.match).length, display: String(rows.filter(s.match).length), tone: s.tone })).filter((s) => s.value > 0)

  /* ── dots: no visible change yet (market) or the brand's own rate (brand) ── */
  const unmet = d.tiles.find((t) => t.label.startsWith('Unmet'))
  const unmetShare = unmet && unmet.value.endsWith('%') ? Number(unmet.value.replace('%', '')) / 100 : null
  const own = brand ? (summary ? (summary.rate !== null && summary.n !== null ? { value: summary.rate, n: summary.n } : null) : weighted(rows, 'rate')) : null
  const market = weighted(all.products, 'rate')

  return (
    <section aria-label="Widgets" className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className={`flex min-w-0 ${curve && last !== null ? 'lg:col-span-8' : 'lg:col-span-12'}`}>{spotlight}</div>
        {curve && last !== null ? (
          <div className="flex min-w-0 lg:col-span-4">
            <GlowStat
              title="Goals with a visible change"
              value={pct(last).replace('%', '')}
              unit="%"
              lead={lift !== null ? pts(lift) : undefined}
              sub={lift !== null ? `more than non-users with the same goals (${pct(curve.base)}), across ${int(curve.people)} goals people chose.` : `of ${int(curve.people)} goals people chose in a category, across the market.`}
              points={points}
              chipOf={(i) => ({ text: i === 0 ? 'Start · 0%' : `Week ${points[i].x} · ${pct(points[i].y)}`, tone: i === 0 ? 'flat' : 'up' })}
              ariaLabel={`Visible change by week ${points.at(-1)!.x}: ${pct(last)} of ${int(curve.people)} goals${lift !== null ? `, ${pts(lift)} against non-users` : ''}`}
              menu={{ label: 'Open the market view', to: to('market') }}
            />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {segments.length ? (
          <div className="flex min-w-0">
            <PillStack
              title={brand ? 'Your products by proof level' : 'Products by proof level'}
              segments={segments}
              defaultId="proven"
              caption={(s) => `${s.label} · ${pct(s.value / rows.length)} of ${rows.length} products`}
              ariaLabel={`Products by proof level: ${segments.map((s) => `${s.label} ${s.display}`).join(', ')}`}
            />
          </div>
        ) : null}
        {cont ? (
          <div className="flex min-w-0">
            <TickGauge
              title={brand ? 'Your customer retention' : 'Customer retention'}
              caption={`Share of users still using their product at week ${d.cohort.weeks}`}
              value={cont.value}
              display={pct(cont.value)}
              callout={cont.n ? `n=${int(cont.n)}` : `week ${d.cohort.weeks}`}
              legend={[
                { label: 'Still using', display: pct(cont.value) },
                { label: 'Stopped', display: pct(1 - cont.value) },
              ]}
              ariaLabel={`${pct(cont.value)} are still using their products at week ${d.cohort.weeks}`}
            />
          </div>
        ) : null}
        {brand && own ? (
          <div className="flex min-w-0 sm:col-span-2 lg:col-span-1">
            <DotMatrix
              title="People with a visible change"
              value={pct(own.value)}
              share={own.value}
              caption={market ? `${pts(own.value - market.value)} against the market’s ${pct(market.value)}, ${int(own.n)} people` : `${int(own.n)} people`}
              ariaLabel={`Your visible change by week ${d.cohort.weeks}: ${pct(own.value)}`}
            />
          </div>
        ) : !brand && unmetShare !== null && unmet ? (
          <div className="flex min-w-0 sm:col-span-2 lg:col-span-1">
            <DotMatrix
              title="People with no visible change yet"
              value={unmet.value}
              share={unmetShare}
              caption={`of ${int(unmet.n)} people at week ${d.cohort.weeks} have a goal without one`}
              ariaLabel={`${unmet.value} of ${int(unmet.n)} people at week ${d.cohort.weeks} have a goal without a visible change`}
            />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {columns.length >= 2 ? (
          <div className={`flex min-w-0 ${brands.length ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
            <PillColumns
              title="Visible change by goal"
              columns={columns}
              format={(v) => pct(v)}
              headline={{
                value: pct(measuredPeople ? measured.reduce((t, r) => t + r.n * (r.real / 100), 0) / measuredPeople : 0),
                caption: `of ${int(Math.round(measuredPeople))} goals measured at week ${d.cohort.weeks} saw a visible change. Goals are ordered by how many people chose them; people still early are left out.`,
              }}
              readout={(c) => `${c.name}: ${pct(c.share)} of those measured at week ${d.cohort.weeks} saw a visible change · ${int(c.n)} people chose it`}
              ariaLabel={`Visible change by goal, at week ${d.cohort.weeks}: ${measured.map((r) => `${r.goal} ${pct(r.real / (r.real + r.none))}`).join(', ')}`}
            />
          </div>
        ) : null}
        {brands.length ? (
          <div className={`flex min-w-0 ${columns.length >= 2 ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
            <BrandBars
              title="Brands by visible change"
              rows={brands.map((b) => ({
                id: b.brand,
                label: b.brand,
                value: b.rate,
                display: pct(b.rate),
                delta: market ? pts(b.rate - market.value) : undefined,
                to: to('market'),
                current: b.brand === brand,
                title: `${b.brand}: ${pct(b.rate)} saw a visible change (95% interval ${pct(b.lo)} to ${pct(b.hi)}), ${pct(b.cont)} still using at week ${d.cohort.weeks}, ${int(b.n)} people`,
              }))}
              reference={market?.value ?? null}
              referenceLabel={market ? `Average across products ${pct(market.value)}` : undefined}
              foot={`By week ${d.cohort.weeks} · brands under ${MIN_GROUP} people left out`}
              menu={{ label: 'Open the market view', to: to('market') }}
              ariaLabel={`Brands by visible change: ${brands.map((b) => `${b.brand} ${pct(b.rate)}`).join(', ')}`}
            />
          </div>
        ) : null}
      </div>

      <p className="m-0 text-proof-small text-ink-2">
        {int(people)} people measured · {kind === 'simulated' ? 'a simulated cohort' : kind === 'mixed' ? `${int(d.cohort.real)} real, the rest simulated` : 'consented users'}. Cards show aggregates; groups under {MIN_GROUP} people are hidden.
      </p>
    </section>
  )
}
