import { ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { retailerBrands } from '../../../../lib/api'
import { useRetailData } from '../../context'
import { csvMeta, csvName, type Category, type Flow, type Insights } from '../../data'
import { useProducts } from '../../productData'
import { TIER_ORDER } from '../../productModel'
import { sectionPath, useRetailState } from '../../state'
import type { ProductRow } from '../../types'
import { Button, DataTable, EmptyState, EvidenceBar, int, LiftValue, MIN_GROUP, Panel, pct, ProductCell, ProofTierChip, pts, RateCell, Select, Suppressed, TIERS, useTooltip, type Column } from '../../ui'
import { useView } from '../../useView'
import { YoursTag } from '../shared'
import { MarketFrame, PanelBone } from './Frame'
import { NOTE } from './model'

/*
 * Market › Categories (?view=categories&category=&goal=), on the insights' category flows and
 * GET /v1/retailer/products. Per goal in the category: the share of its users with a visible change begun by
 * week 2, 4 and 8, against non-users with the same goal at week 8 (small multiples on one 0–100% scale);
 * the category's brands ranked by visible change with their intervals; and its top products.
 */

const TOP = 8

export function CategoriesView({ d }: { d: Insights }) {
  const { param, setParam } = useRetailState()
  const { workspace } = useRetailData()
  const mine = workspace.kind === 'brand' ? workspace.brand : null
  const cats = (d.categories ?? []).filter((c) => c.flows.length)
  const cat = cats.find((c) => c.category === param('category')) ?? cats.find((c) => c.category === 'serum') ?? cats[0]

  if (!cat) {
    return (
      <MarketFrame view="categories" description={`No category has ${MIN_GROUP} or more people for one goal in this filter.`}>
        <EmptyState title="No category has enough people yet" body={`Categories appear once ${MIN_GROUP} or more people use one for a goal through week ${d.cohort.weeks}.`} />
      </MarketFrame>
    )
  }

  const flows = [...cat.flows].sort((a, b) => b.n - a.n)
  const top = flows.find((f) => f.goal_id === param('goal')) ?? flows[0]
  const ranked = [...cat.brands].sort((a, b) => b.rate - a.rate || b.n - a.n)
  const myIdx = mine ? ranked.findIndex((b) => b.brand === mine) : -1

  const description =
    myIdx >= 0 ? (
      <>
        In {cat.label.toLowerCase()}, <strong>{mine}</strong> ranks{' '}
        <strong>
          {myIdx + 1} of {ranked.length}
        </strong>{' '}
        brands on visible change ({pct(ranked[myIdx].rate)}, n={int(ranked[myIdx].n)}).
      </>
    ) : (
      <>
        In {cat.label.toLowerCase()} for {top.goal.toLowerCase()}, <strong>{pct(top.rate)}</strong> of {int(top.n)} people saw a visible change by week {top.weeks.at(-1)}
        {top.base ? <>, against {pct(top.base.rate)} of non-users with the goal</> : null}.
      </>
    )

  return (
    <MarketFrame
      view="categories"
      description={description}
      actions={<Select label="Category" value={cat.category} onChange={(c) => setParam({ category: c, goal: null })} options={cats.map((c) => ({ value: c.category, label: c.label }))} />}
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 xl:items-start">
        <Panel title="Visible change by goal" id="flows-h" description={<FlowLegend />} className="xl:col-span-7" footnote={`Share of ${cat.label.toLowerCase()} users with the goal whose visible change (held to week ${top.weeks.at(-1)}) had begun by each week; non-users are people with the goal not using the category, at week ${top.weeks.at(-1)}.`}>
          <ul className="-mx-3 my-0 grid list-none grid-cols-1 gap-x-2 gap-y-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {flows.map((f) => (
              <FlowCell key={f.goal_id} f={f} on={f.goal_id === param('goal')} />
            ))}
          </ul>
        </Panel>
        <BrandsInCategory cat={cat} ranked={ranked} mine={mine} className="xl:col-span-5" />
      </div>
      <TopProducts cat={cat} d={d} mine={mine} />
    </MarketFrame>
  )
}

function FlowLegend() {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-2.5 rounded-[2px] bg-proof-leaf" />
        Users, by week
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-ink-2" />
        Non-users at week 8
      </span>
    </span>
  )
}

/** One goal: bars for weeks 2, 4 and 8 (users) on a shared 0–100% scale; dashed: non-users at week 8. */
function FlowCell({ f, on }: { f: Flow; on: boolean }) {
  const last = f.weeks.length - 1
  const bars = f.weeks.map((w, i) => ({ w, v: f.n ? f.changed[i] / f.n : 0 }))
  const lift = f.base ? f.rate - f.base.rate : null
  const H = 96
  return (
    <li className={`flex min-w-0 flex-col gap-3 rounded-ctl p-3 ${on ? 'bg-pf-bg2' : ''}`} aria-current={on ? 'true' : undefined}>
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate text-proof-body font-medium text-ink" title={f.goal}>
          {f.goal}
        </span>
        <span className="shrink-0 text-proof-label text-ink-2 tnum">{int(f.n)} people</span>
      </div>
      <figure className="m-0">
        <div aria-hidden className="relative grid grid-cols-3 items-end gap-3 border-b border-line-strong" style={{ height: H }}>
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--line-subtle)]" />
          <span className="pointer-events-none absolute inset-x-0 h-px bg-[var(--line-subtle)]" style={{ bottom: H / 2 }} />
          {bars.map((b, i) => (
            <span key={b.w} className="block rounded-t-[3px] bg-proof-leaf" style={{ height: Math.max(1, b.v * H), opacity: i === last ? 1 : 0.45 }} />
          ))}
          {f.base ? <span className="pointer-events-none absolute -inset-x-1 border-t-2 border-dashed border-ink-2" style={{ bottom: f.base.rate * H - 1 }} /> : null}
        </div>
        <div aria-hidden className="mt-1.5 grid grid-cols-3 gap-3 text-center">
          {bars.map((b, i) => (
            <span key={b.w} className="flex flex-col">
              <span className={`text-proof-small tnum ${i === last ? 'font-medium text-ink' : 'text-ink-2'}`}>{pct(b.v)}</span>
              <span className="text-proof-label text-ink-2">Wk {b.w}</span>
            </span>
          ))}
        </div>
        <figcaption className="sr-only">
          {f.goal}, {int(f.n)} people: {bars.map((b) => `${pct(b.v)} by week ${b.w}`).join(', ')}
          {f.base ? `; non-users ${pct(f.base.rate)} of ${int(f.base.n)}` : `; non-users: fewer than ${MIN_GROUP}`}.
        </figcaption>
      </figure>
      <div className="flex items-baseline justify-between gap-2 border-t border-line pt-2 text-proof-small">
        <span className="text-ink-2">{f.base ? <>Non-users {pct(f.base.rate)}</> : <>Non-users</>}</span>
        {lift === null ? <Suppressed short /> : <span className={`tnum ${Math.round(lift * 100) > 0 ? 'text-proof-leaf' : 'text-ink-2'}`}>{pts(lift)}</span>}
      </div>
    </li>
  )
}

function BrandsInCategory({ cat, ranked, mine, className }: { cat: Category; ranked: Category['brands']; mine: string | null; className?: string }) {
  const { filters } = useRetailData()
  // The api's comparison note rides on /brands (shared, cached with the Brands view).
  const list = useView(`brands|${filters.cohort}|${filters.range}`, () => retailerBrands(filters))
  const note = (list.status === 'ready' ? list.data.note : null) ?? NOTE
  const max = Math.min(1, Math.max(0.5, ...ranked.map((b) => b.hi)) + 0.05)
  return (
    <Panel title={`Brands in ${cat.label.toLowerCase()}`} id="cat-brands-h" description="Visible change by week 8, with the 95% interval." className={className} footnote={note}>
      {ranked.length === 0 ? (
        <EmptyState compact title="No brand has enough people" body={`No brand in ${cat.label.toLowerCase()} has ${MIN_GROUP} or more people${cat.brands_hidden ? `; ${cat.brands_hidden} more are under ${MIN_GROUP}` : ''}.`} />
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {ranked.map((b, i) => (
            <BrandRow key={b.brand} b={b} i={i} max={max} mine={mine === b.brand} />
          ))}
          {cat.brands_hidden ? (
            <li className="flex min-h-11 items-center pt-2 text-proof-small text-ink-2">
              {cat.brands_hidden} more {cat.brands_hidden === 1 ? 'brand has' : 'brands have'} fewer than {MIN_GROUP} people
            </li>
          ) : null}
        </ol>
      )}
    </Panel>
  )
}

function BrandRow({ b, i, max, mine }: { b: Category['brands'][number]; i: number; max: number; mine: boolean }) {
  const tip = useTooltip(`${b.brand}: ${pct(b.rate)} of ${int(b.n)} people · 95% interval ${pct(b.lo).replace('%', '')}–${pct(b.hi)} · ${pct(b.cont)} still using`)
  return (
    <li className={`grid min-h-12 grid-cols-[16px_minmax(0,172px)_minmax(0,1fr)_auto] items-center gap-3 border-b border-line last:border-b-0 ${mine ? '-mx-5 bg-proof-leaf-soft px-5' : ''}`}>
      <span className="text-proof-small text-ink-2 tnum">{i + 1}</span>
      <span className="flex min-w-0 items-center">
        <span className="truncate text-proof-body text-ink" title={b.brand}>
          {b.brand}
        </span>
        {mine ? <YoursTag /> : null}
      </span>
      <EvidenceBar rate={b.rate} lo={b.lo} hi={b.hi} max={max} showN={false} />
      <span className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
        <span {...tip.trigger} tabIndex={0} className="cursor-help text-proof-body text-ink tnum">
          {pct(b.rate)}
        </span>
        <span className="w-12 text-proof-label text-ink-2 tnum">n={int(b.n)}</span>
        {tip.node}
      </span>
    </li>
  )
}

function TopProducts({ cat, d, mine }: { cat: Category; d: Insights; mine: string | null }) {
  const { filters } = useRetailData()
  const { carry } = useRetailState()
  const navigate = useNavigate()
  const { state, retry } = useProducts(filters)
  if (state.status === 'loading') return <PanelBone height={TOP * 48} />
  if (state.status !== 'ready')
    return (
      <Panel title={`Top products in ${cat.label.toLowerCase()}`}>
        <EmptyState compact title="Products couldn’t load" body="No partial numbers are shown." action={{ label: 'Retry', onClick: retry }} />
      </Panel>
    )
  const all = state.d.products.filter((r) => r.category === cat.category)
  const rows = [...all].sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier] || (b.rate ?? -1) - (a.rate ?? -1) || (b.n ?? 0) - (a.n ?? 0)).slice(0, TOP)
  const allHref = `${sectionPath('products')}${carry ? `${carry}&` : '?'}category=${encodeURIComponent(cat.category)}`
  const cols: Column<ProductRow>[] = [
    { id: 'product', header: 'Product', rowHeader: true, cell: (r) => <ProductCell p={r} size={28} tag={mine === r.brand ? <YoursTag /> : null} />, csv: (r) => `${r.product} (${r.brand})` },
    { id: 'tier', header: 'Proof', headerText: 'Proof status', width: '150px', cell: (r) => <ProofTierChip tier={r.tier} size="sm" />, csv: (r) => TIERS[r.tier].label },
    { id: 'rate', header: 'Visible change', headerText: 'Visible change by week 8 (%)', align: 'right', width: '140px', cell: (r) => (r.rate === null ? <span className="text-proof-small text-ink-2">{r.reason === 'not_measured' ? 'Not measured' : r.reason === 'unused' ? 'No users yet' : `n<${MIN_GROUP}`}</span> : <RateCell rate={r.rate} n={r.n} lo={r.rate_lo} hi={r.rate_hi} />), csv: (r) => (r.rate === null ? (r.reason ?? 'suppressed') : Math.round(r.rate * 100)) },
    { id: 'lift', header: 'vs non-users', headerText: 'Lift vs non-users (pts)', align: 'right', width: '110px', cell: (r) => <LiftValue lift={r.lift} lo={r.lift_lo} hi={r.lift_hi} />, csv: (r) => (r.lift === null ? '' : Math.round(r.lift * 100)) },
    { id: 'cont8', header: 'Still using', headerText: 'Still using at week 8 (%)', align: 'right', width: '96px', cell: (r) => (r.cont8 === null ? <Suppressed short /> : <span className="tnum">{pct(r.cont8)}</span>), csv: (r) => (r.cont8 === null ? 'suppressed' : Math.round(r.cont8 * 100)) },
  ]
  return (
    <Panel flush>
      <DataTable
        caption={`Top ${rows.length} ${cat.label.toLowerCase()} by Proof status and visible change`}
        heading={<h2 className="m-0 text-proof-h text-ink">Top products in {cat.label.toLowerCase()}</h2>}
        toolbar={
          all.length > rows.length ? (
            <Button kind="ghost" to={allHref}>
              All {all.length} in Products
              <ArrowRight size={14} strokeWidth={1.6} aria-hidden />
            </Button>
          ) : null
        }
        columns={cols}
        rows={rows}
        rowKey={(r) => r.product_id}
        onRowClick={(r) => navigate(`${sectionPath('products', r.product_id)}${carry}`)}
        rowLabel={(r) => `Open ${r.product}, ${r.brand}`}
        rowClassName={(r) => (mine === r.brand ? '[&>*:first-child]:shadow-[inset_2px_0_0_var(--proof-leaf)]' : '')}
        minWidth={640}
        csv={{ name: csvName(`category-${cat.category}-products`, d), meta: csvMeta(d, cat.label) }}
        empty={`No ${cat.label.toLowerCase()} in the catalogue.`}
      />
    </Panel>
  )
}
