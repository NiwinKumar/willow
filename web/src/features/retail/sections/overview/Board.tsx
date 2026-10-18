import type { ReactNode } from 'react'

import { sectionPath, useRetailState } from '../../state'
import type { BrandSummary, Insights, ProductRow, Products } from '../../types'
import { cohortKind, int, MIN_GROUP, pct, pts, SkeletonPanel } from '../../ui'
import { DotMatrix, GlowStat, PillColumns, PillStack, RankList, TickGauge, type GlowPoint, type StackSegment } from '../../ui/widgets'

/*
 * The overview's widget board, laid out to fit one screen: the spotlight beside the market curve, a row of three
 * small tiles, then the goals beside the top brands. Every card is over the live aggregates. Every figure is derived here from what
 * the api sends (insights, the product rows, the brand summary); a card whose numbers are under 10 people is left
 * out rather than drawn from nothing.
 *   Spotlight · Visible change by week 8 (curve)
 *   Catalog by proof (stack) · Still using (gauge) · No visible change / own rate (dots)
 *   Goals people chose (columns) · Top brands
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

const STACK: { id: string; label: string; match: (r: ProductRow) => boolean }[] = [
  { id: 'proven', label: 'Proven', match: (r) => r.tier === 'proven' },
  { id: 'promising', label: 'Promising', match: (r) => r.tier === 'promising' },
  { id: 'unclear', label: 'No clear effect yet', match: (r) => r.tier === 'unclear' },
  { id: 'few', label: 'Under 10 people', match: (r) => r.tier === 'too_few' && r.reason === 'few' },
  { id: 'unmeasured', label: 'Goal not measured yet', match: (r) => r.tier === 'too_few' && r.reason === 'not_measured' },
  { id: 'unused', label: 'Not used by anyone', match: (r) => r.tier === 'too_few' && (r.reason === 'unused' || r.reason === undefined) },
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

  /* ── goals people chose ── */
  const needs = [...d.needs].sort((a, b) => b.n - a.n)
  const needTotal = needs.reduce((s, r) => s + r.n, 0)
  const PHRASE = { real: 'have a visible change', none: 'have no clear change', early: 'are too early to tell' } as const
  const columns = needs.map((r) => ({ id: r.goal_id ?? r.goal, label: GOAL_SHORT[r.goal_id ?? ''] ?? r.goal.split(' ')[0], name: r.goal, n: r.n, shares: { real: r.real / 100, none: r.none / 100, early: r.early / 100 } }))

  /* ── still using at the last week ── */
  const cont = contOf(d, all, rows, brand, summary)

  /* ── brands (list) ── */
  const brands = d.brands.slice(0, 5)

  /* ── catalog by proof  ── */
  const segments: StackSegment[] = STACK.map((s) => ({ id: s.id, label: s.label, value: rows.filter(s.match).length, display: String(rows.filter(s.match).length) })).filter((s) => s.value > 0)

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
              title="Visible change by week 8"
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
              title={brand ? 'Your catalog by proof' : 'Catalog by proof'}
              segments={segments}
              defaultId="proven"
              caption={(s) => `${s.label} · ${pct(s.value / rows.length)} of ${rows.length} products`}
              ariaLabel={`Catalog by proof: ${segments.map((s) => `${s.label} ${s.display}`).join(', ')}`}
            />
          </div>
        ) : null}
        {cont ? (
          <div className="flex min-w-0">
            <TickGauge
              title={brand ? 'Your users still using' : 'Still using'}
              value={cont.value}
              display={pct(cont.value)}
              chip={`Week ${d.cohort.weeks}`}
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
              title="Visible change"
              value={pct(own.value)}
              share={own.value}
              caption={market ? `${pts(own.value - market.value)} against the market’s ${pct(market.value)}, ${int(own.n)} people` : `${int(own.n)} people`}
              ariaLabel={`Your visible change by week ${d.cohort.weeks}: ${pct(own.value)}`}
            />
          </div>
        ) : !brand && unmetShare !== null && unmet ? (
          <div className="flex min-w-0 sm:col-span-2 lg:col-span-1">
            <DotMatrix
              title="No visible change yet"
              tone="amber"
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
              title="Goals people chose"
              options={[
                { key: 'real', label: 'Visible change' },
                { key: 'none', label: 'No clear change' },
                { key: 'early', label: 'Too early to tell' },
              ]}
              columns={columns}
              format={(v) => pct(v)}
              headline={(key) => {
                const k = key as keyof typeof PHRASE
                const share = needTotal ? needs.reduce((s, r) => s + r.n * (r[k] / 100), 0) / needTotal : 0
                return { value: pct(share), caption: `of ${int(needTotal)} goals people chose ${PHRASE[k]} so far, including people not yet at week ${d.cohort.weeks}.` }
              }}
              readout={(c, key) => `${c.name}: ${pct(c.shares[key])} ${PHRASE[key as keyof typeof PHRASE]} so far · ${int(c.n)} people`}
              ariaLabel={`Goals people chose: ${needs.map((r) => `${r.goal} ${int(r.n)} people`).join(', ')}`}
            />
          </div>
        ) : null}
        {brands.length ? (
          <div className={`flex min-w-0 ${columns.length >= 2 ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
            <RankList
              title="Top brands"
              rows={brands.map((b) => ({ id: b.brand, label: b.brand, value: pct(b.rate), to: to('market'), current: b.brand === brand, title: `${b.brand}: ${pct(b.rate)} saw a visible change, ${int(b.n)} people` }))}
              foot={`By week ${d.cohort.weeks} · brands under ${MIN_GROUP} people left out`}
              menu={{ label: 'Open the market view', to: to('market') }}
              ariaLabel={`Top brands by visible change: ${brands.map((b) => `${b.brand} ${pct(b.rate)}`).join(', ')}`}
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
