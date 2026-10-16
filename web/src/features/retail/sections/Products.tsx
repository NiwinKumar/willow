import { ArrowRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { retailerProducts } from '../../../lib/api'
import { GOALS } from '../../../lib/metrics'
import { useRetailData } from '../context'
import { csvMeta, csvName, outcomes } from '../data'
import { sectionPath, useRetailState } from '../state'
import type { Insights, ProductRow, ProofTier } from '../types'
import { DataTable, EvidenceBar, int, LiftValue, MIN_GROUP, Panel, pct, pts, ProofTierChip, RateCell, SearchField, SectionHeader, Select, SidePanel, SimBadge, SkeletonHeader, SkeletonTable, Suppressed, Term, ToolButton, weeks, type Column, type Sort } from '../ui'
import { InsightsGate, useWorkspaceLabel, YoursTag } from './shared'

/*
 * Products: every product's measured outcome as a scoreboard. Reads GET /v1/retailer/products when this api
 * build has it (Proof tier, 95% intervals, products with too few people); until then it falls back to the
 * insights' product_outcomes (every product with 10+ people), and says so.
 * TODO(slice D): product detail page (/retail/products/:id), compare, and the "what would it take" hint.
 */

/** One table row, from either source. Nulls are suppressed values. */
type Row = {
  product_id: string
  product: string
  brand: string
  category: string
  category_label: string
  goal_ids: string[]
  n: number | null
  rate: number | null
  lo: number | null
  hi: number | null
  base: number | null
  lift: number | null
  lift_lo: number | null
  lift_hi: number | null
  weeks: number | null
  cont8: number | null
  tier: ProofTier | null
  reason?: ProductRow['reason']
}

const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function fromProducts(rows: ProductRow[]): Row[] {
  return rows.map((p) => ({ ...p, lo: p.rate_lo, hi: p.rate_hi, base: p.base_rate }))
}
function fromInsights(d: Insights): Row[] {
  const goalsOf = new Map(d.products.map((p) => [p.product_id, p.goal_ids ?? []]))
  return outcomes(d).map((o) => ({
    product_id: o.product_id,
    product: o.product,
    brand: o.brand,
    category: o.category ?? '',
    category_label: label(o.category ?? ''),
    goal_ids: goalsOf.get(o.product_id) ?? [],
    n: o.n,
    rate: o.rate,
    lo: null,
    hi: null,
    base: o.lift === null || o.lift === undefined ? null : Math.max(0, Math.round((o.rate - o.lift) * 100) / 100),
    lift: o.lift ?? null,
    lift_lo: null,
    lift_hi: null,
    weeks: o.weeks,
    cont8: o.cont8 ?? o.cont,
    tier: null,
  }))
}

type Source = { key: string; status: 'loading' | 'products' | 'insights'; rows: ProductRow[] | null; counts?: { too_few: number; unused: number; not_measured: number } }

export default function Products() {
  return (
    <InsightsGate
      skeleton={
        <div className="flex flex-col gap-4">
          <SkeletonHeader />
          <SkeletonTable rows={12} />
        </div>
      }
    >
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

const SORTS = ['rate', 'lift', 'n', 'weeks', 'cont8', 'product', 'brand', 'tier'] as const
const TIER_ORDER: Record<ProofTier, number> = { proven: 3, promising: 2, unclear: 1, too_few: 0 }

function Body({ d }: { d: Insights }) {
  const { filters, workspace } = useRetailData()
  const { param, setParam, carry } = useRetailState()
  const eyebrow = useWorkspaceLabel()
  const brandView = workspace.kind === 'brand' ? workspace.brand : null

  // Prefer the products endpoint; fall back to the insights' outcomes.
  const fkey = `${filters.cohort}|${filters.range}`
  const [src, setSrc] = useState<Source>({ key: '', status: 'loading', rows: null })
  useEffect(() => {
    let alive = true
    retailerProducts(filters).then(
      (r) => alive && setSrc({ key: fkey, status: 'products', rows: r.products, counts: r.counts }),
      () => alive && setSrc({ key: fkey, status: 'insights', rows: null }),
    )
    return () => {
      alive = false
    }
  }, [fkey]) // eslint-disable-line react-hooks/exhaustive-deps
  const source = src.key === fkey ? src : { status: 'loading' as const, rows: null, counts: undefined }
  const rich = source.status === 'products'
  const all = useMemo(() => (source.status === 'products' && source.rows ? fromProducts(source.rows) : fromInsights(d)), [source.status, source.rows, d])

  // Filters and selection live in the URL.
  const q = param('q') ?? ''
  const brand = param('brand') ?? ''
  const category = param('category') ?? ''
  const goal = param('goal') ?? ''
  const mineOnly = param('mine') === '1' && brandView !== null
  const selected = param('product')
  const sortParam = param('sort')
  const sort: Sort | null = (() => {
    const [id, dir] = (sortParam ?? '').split('.')
    return (SORTS as readonly string[]).includes(id) && (dir === 'asc' || dir === 'desc') ? { id, dir } : null
  })()

  const brands = [...new Set(all.map((r) => r.brand))].sort()
  const categories = [...new Map(all.map((r) => [r.category, r.category_label])).entries()].filter(([c]) => c).sort((a, b) => a[1].localeCompare(b[1]))
  const goalIds = new Set(all.flatMap((r) => r.goal_ids))
  const goals = GOALS.filter((g) => goalIds.has(g.id))
  const rows = all.filter(
    (r) =>
      (!q || `${r.product} ${r.brand}`.toLowerCase().includes(q.toLowerCase())) &&
      (!brand || r.brand === brand) &&
      (!mineOnly || r.brand === brandView) &&
      (!category || r.category === category) &&
      (!goal || r.goal_ids.includes(goal)),
  )
  const measured = all.filter((r) => r.rate !== null)
  const best = [...measured].filter((r) => r.lift !== null).sort((a, b) => b.lift! - a.lift!)[0]
  const proven = rich ? all.filter((r) => r.tier === 'proven').length : null
  const sel = selected ? all.find((r) => r.product_id === selected) ?? null : null

  const columns: Column<Row>[] = [
    {
      id: 'product',
      header: 'Product',
      rowHeader: true,
      width: '34%',
      sortValue: (r) => r.product,
      cell: (r) => (
        <span className="flex min-w-0 items-baseline gap-2" title={`${r.product} · ${r.brand}`}>
          <span className="min-w-0 truncate text-ink">{r.product}</span>
          <span className="shrink-0 whitespace-nowrap text-proof-small text-ink-2">
            {r.brand}
            {brandView === r.brand ? <YoursTag /> : null}
          </span>
        </span>
      ),
      headerText: 'Product (brand)',
      csv: (r) => `${r.product} (${r.brand})`,
    },
    { id: 'category', header: 'Category', width: '11%', sortValue: (r) => r.category_label, cell: (r) => <span className="text-ink-2">{r.category_label}</span> },
    ...(rich
      ? [
          {
            id: 'tier',
            header: <Term id="proof_tier">Proof tier</Term>,
            headerText: 'Proof tier',
            width: '150px',
            sortValue: (r: Row) => (r.tier ? TIER_ORDER[r.tier] : null),
            firstDir: 'desc' as const,
            cell: (r: Row) => (r.tier ? <ProofTierChip tier={r.tier} size="sm" /> : null),
            csv: (r: Row) => r.tier ?? '',
          },
        ]
      : []),
    {
      id: 'rate',
      header: <Term id="real_change">Real change</Term>,
      headerText: 'Real change rate',
      width: '22%',
      sortValue: (r) => r.rate,
      firstDir: 'desc',
      cell: (r) =>
        r.rate === null ? (
          <Suppressed short />
        ) : (
          <span className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-right font-mono tnum">{pct(r.rate)}</span>
            <EvidenceBar rate={r.rate} lo={r.lo} hi={r.hi} base={r.base} n={r.n} className="min-w-0 flex-1" />
          </span>
        ),
      csv: (r) => (r.rate === null ? 'suppressed' : Math.round(r.rate * 100)),
    },
    {
      id: 'lift',
      header: <Term id="lift">Lift</Term>,
      headerText: 'Lift vs non-users (pts)',
      align: 'right',
      width: '96px',
      sortValue: (r) => r.lift,
      cell: (r) => <LiftValue lift={r.lift} lo={r.lift_lo} hi={r.lift_hi} />,
      csv: (r) => (r.lift === null ? 'suppressed' : Math.round(r.lift * 100)),
    },
    { id: 'weeks', header: 'Time to change', align: 'right', width: '128px', sortValue: (r) => r.weeks, firstDir: 'asc', cell: (r) => <span className="font-mono tnum">{weeks(r.weeks)}</span>, csv: (r) => r.weeks ?? 'suppressed' },
    {
      id: 'cont8',
      header: <Term id="continuation">Still using</Term>,
      headerText: `Still using at week ${d.cohort.weeks} (%)`,
      align: 'right',
      width: '112px',
      sortValue: (r) => r.cont8,
      cell: (r) => (r.cont8 === null ? <Suppressed short /> : <span className="font-mono tnum">{pct(r.cont8)}</span>),
      csv: (r) => (r.cont8 === null ? 'suppressed' : Math.round(r.cont8 * 100)),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow={eyebrow}
        title="Products"
        answer={
          measured.length ? (
            <>
              <strong>{measured.length}</strong> products have a measured outcome
              {proven !== null ? (
                <>
                  , <strong>{proven}</strong> of them Proven
                </>
              ) : null}
              .{' '}
              {best ? (
                <>
                  The largest <Term id="lift">lift</Term> over non-users: <strong>{best.product}</strong> ({best.brand}), {pct(best.rate)} vs {pct(best.base)} ({pts(best.lift)}, n={int(best.n)}).
                </>
              ) : null}
            </>
          ) : (
            `No product has ${MIN_GROUP} or more people at week ${d.cohort.weeks} in this filter.`
          )
        }
      />
      <Panel
        flush
        footnote={
          <>
            {source.status === 'insights' ? 'Proof tiers and rate intervals appear when the products service is live. ' : ''}Ember dot: real-change rate by week {d.cohort.weeks}; bar: its <Term id="interval">95% interval</Term>; tick: <Term id="base_rate">non-users</Term> with an overlapping goal. <Term id="suppression">Groups under {MIN_GROUP}</Term> show as “n&lt;{MIN_GROUP}”.
            {source.counts ? ` ${source.counts.too_few} products have too few people, ${source.counts.not_measured} target a goal that isn’t measured, ${source.counts.unused} are unused.` : ''}
          </>
        }
      >
        <DataTable
          caption="Products scoreboard"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.product_id}
          onRowClick={(r) => setParam({ product: r.product_id }, { push: true })}
          rowLabel={(r) => `${r.product}, ${r.brand}: open quick look`}
          selectedKey={selected}
          sort={sort}
          onSortChange={(s) => setParam({ sort: s ? `${s.id}.${s.dir}` : null })}
          defaultSort={{ id: 'rate', dir: 'desc' }}
          maxHeight="calc(100dvh - var(--proof-head) - 230px)"
          minWidth={rich ? 980 : 860}
          csv={{ name: csvName('products', d), meta: csvMeta(d, [brand && `brand ${brand}`, category && `category ${category}`, goal && `goal ${goal}`, q && `search "${q}"`].filter(Boolean).join(' · ') || undefined) }}
          empty={
            <span className="flex flex-col items-center gap-2">
              No product matches these filters.
              <ToolButton onClick={() => setParam({ q: null, brand: null, category: null, goal: null, mine: null })}>Clear filters</ToolButton>
            </span>
          }
          heading={
            <>
              <h2 className="m-0 text-proof-h font-medium text-ink">Scoreboard</h2>
              <SimBadge cohort={d.cohort} />
            </>
          }
          toolbar={
            <>
              <SearchField label="Search products" value={q} onChange={(v) => setParam({ q: v })} placeholder="Search product or brand" />
              {brandView ? (
                <ToolButton pressed={mineOnly} onClick={() => setParam({ mine: mineOnly ? null : '1', brand: null })}>
                  Only {brandView}
                </ToolButton>
              ) : (
                <Select label="Brand" hideLabel value={brand} onChange={(v) => setParam({ brand: v })} options={[{ value: '', label: 'All brands' }, ...brands.map((b) => ({ value: b, label: b }))]} />
              )}
              <Select label="Category" hideLabel value={category} onChange={(v) => setParam({ category: v })} options={[{ value: '', label: 'All categories' }, ...categories.map(([value, l]) => ({ value, label: l }))]} />
              {goals.length ? <Select label="Goal" hideLabel value={goal} onChange={(v) => setParam({ goal: v })} options={[{ value: '', label: 'All goals' }, ...goals.map((g) => ({ value: g.id, label: g.label }))]} /> : null}
              <span aria-live="polite" className="font-mono text-[11px] text-ink-2 tnum">
                {rows.length} of {all.length}
              </span>
            </>
          }
        />
      </Panel>
      <QuickLook row={sel} d={d} onClose={() => setParam({ product: null })} carry={carry} />
    </div>
  )
}

/** Row → side panel: the product's figures at a glance, with the way to its full page. */
function QuickLook({ row, d, onClose, carry }: { row: Row | null; d: Insights; onClose: () => void; carry: string }) {
  // Keep the last row while the panel slides out (state adjusted during render, not in an effect).
  const [last, setLast] = useState<Row | null>(row)
  if (row && row !== last) setLast(row)
  const r = row ?? last
  return (
    <SidePanel open={Boolean(row)} onClose={onClose} title={r?.product ?? 'Product'} subtitle={r ? `${r.brand} · ${r.category_label}` : undefined} labelledBy="quick-look-title">
      {r ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {r.tier ? <ProofTierChip tier={r.tier} /> : null}
            <SimBadge cohort={d.cohort} />
          </div>
          <div className="flex flex-col gap-2 rounded-sm border border-line bg-sunken p-3.5">
            <span className="text-proof-small text-ink-2">
              <Term id="real_change">Real change</Term> by week {d.cohort.weeks}
            </span>
            {r.rate === null ? (
              <Suppressed />
            ) : (
              <>
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-[28px] leading-none text-ink tnum">{pct(r.rate)}</span>
                  <span className="text-proof-small text-ink-2">of {int(r.n)} users</span>
                </span>
                <EvidenceBar rate={r.rate} lo={r.lo} hi={r.hi} base={r.base} n={r.n} />
              </>
            )}
          </div>
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3">
            {[
              { k: <Term id="base_rate">Non-users</Term>, v: r.base === null ? <Suppressed short /> : <span className="font-mono tnum">{pct(r.base)}</span> },
              { k: <Term id="lift">Lift</Term>, v: <LiftValue lift={r.lift} lo={r.lift_lo} hi={r.lift_hi} /> },
              { k: 'Median time to change', v: <span className="font-mono tnum">{weeks(r.weeks)}</span> },
              { k: <Term id="continuation">Still using wk {d.cohort.weeks}</Term>, v: r.cont8 === null ? <Suppressed short /> : <span className="font-mono tnum">{pct(r.cont8)}</span> },
              { k: 'Rate with interval', v: <RateCell rate={r.rate} n={r.n} lo={r.lo} hi={r.hi} /> },
            ].map((x, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <dt className="text-proof-small text-ink-2">{x.k}</dt>
                <dd className="m-0 text-proof-body text-ink">{x.v}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 text-proof-small text-ink-2">An association with use, not proof of effect: people chose their own products. Cosmetic measurements only.</p>
          <Link to={`${sectionPath('products', r.product_id)}${carry}`} className="inline-flex h-8 items-center gap-1.5 self-start rounded-xs bg-selected px-3 text-proof-small font-medium text-inverse no-underline hover:bg-ink/85">
            Open product page <ArrowRight size={13} strokeWidth={1.8} aria-hidden />
          </Link>
        </div>
      ) : null}
    </SidePanel>
  )
}
