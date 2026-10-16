import { Columns3 } from 'lucide-react'
import { useMemo } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { GOALS } from '../../../lib/metrics'
import { useRetailData } from '../context'
import { csvMeta, csvName } from '../data'
import { useProducts } from '../productData'
import { filterRows, hintOf, MAX_COMPARE, noDataReason, parseIds, TIER_ORDER, TIER_TABS, toggleId } from '../productModel'
import { sectionPath, useRetailState } from '../state'
import type { Insights, ProductRow, ProofTier } from '../types'
import { Bone, Button, DataTable, ErrorState, int, LiftValue, MIN_GROUP, PageHeader, pct, ProductCell, ProofTierChip, SearchField, Segmented, Select, Suppressed, Tabs, TIERS, weeks, type Column, type Sort } from '../ui'
import { HeadTip, RateInterval } from './productParts'
import { InsightsGate, YoursTag } from './shared'

/*
 * Products (/retail/products): every catalog product's measured outcome on GET /v1/retailer/products, one row
 * each. Status tab (?tier=), search and filters (?q= &brand= &category= &goal=), sort (?sort=lift.desc), the
 * rows picked for Compare (?sel=a,b) and, in a brand workspace, "All products" (?scope=all) live in the URL.
 * A row opens the product page; two or three ticked rows open Compare.
 */

export default function Products() {
  return (
    <InsightsGate skeleton={<ProductsSkeleton />}>
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

/** Drawn to the final layout: header, status tabs, the table card with its toolbar and rows. */
function ProductsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Bone className="h-7 w-32" />
        <Bone className="h-4 w-[420px] max-w-full" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex h-11 items-center gap-6 border-b border-line">
          {['w-8', 'w-16', 'w-20', 'w-24', 'w-28'].map((w) => (
            <Bone key={w} className={`h-3.5 ${w}`} />
          ))}
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex h-[60px] items-center gap-2 px-5">
            <Bone className="h-9 w-60" />
            <Bone className="ml-auto h-9 w-36" />
            <Bone className="h-9 w-32" />
          </div>
          <div className="h-10 border-y border-line bg-pf-bg2" />
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="flex h-12 items-center gap-6 border-b border-line px-5 last:border-b-0">
              <Bone className="size-4" />
              <Bone className="h-3.5 w-[28%]" />
              <Bone className="h-5 w-20" />
              <Bone className="h-3 w-40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const SORTS = ['product', 'tier', 'rate', 'base', 'lift', 'n', 'category', 'weeks', 'cont8', 'share', 'price'] as const
const DEFAULT_SORT: Sort = { id: 'lift', dir: 'desc' }
const TIER_IDS = Object.keys(TIERS) as ProofTier[]
const PRICE_ORDER = { budget: 0, mid: 1, premium: 2 } as const
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`

function Body({ d }: { d: Insights }) {
  const { filters, workspace } = useRetailData()
  const { param, setParam, carry } = useRetailState()
  const navigate = useNavigate()
  const { state, retry } = useProducts(filters)
  const all = useMemo(() => (state.status === 'ready' ? state.d.products : []), [state])
  const wk = d.cohort.weeks

  const brandName = workspace.kind === 'brand' ? workspace.brand : null
  const mine = brandName ? all.filter((r) => r.brand === brandName) : []
  // A brand workspace opens on its own products (when it has any in the catalog); ?scope=all widens to everyone.
  const brandView = brandName && mine.length ? brandName : null
  const yoursOnly = brandView !== null && param('scope') !== 'all'

  const q = param('q') ?? ''
  const brand = brandView ? '' : (param('brand') ?? '')
  const category = param('category') ?? ''
  const goal = param('goal') ?? ''
  const tier = TIER_IDS.find((t) => t === param('tier')) ?? ''
  const sel = parseIds(param('sel')).filter((id) => all.some((r) => r.product_id === id))
  const sort: Sort = (() => {
    const [id, dir] = (param('sort') ?? '').split('.')
    return (SORTS as readonly string[]).includes(id) && (dir === 'asc' || dir === 'desc') ? { id, dir } : DEFAULT_SORT
  })()

  // Round-1 links (?product=<id> opened a quick look) now land on the product page.
  const legacy = param('product')
  if (legacy) return <Navigate to={`${sectionPath('products', legacy)}${carry}`} replace />
  if (state.status === 'loading') return <ProductsSkeleton />
  if (state.status !== 'ready') return <ErrorState title="Products couldn’t load" body="The products service didn’t answer. No partial numbers are shown." onRetry={retry} />

  const res = state.d
  const brands = [...new Set(all.map((r) => r.brand))].sort((a, b) => a.localeCompare(b))
  const categories = [...new Map(all.map((r) => [r.category, r.category_label])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const goalIds = new Set(all.flatMap((r) => r.goal_ids))
  const goals = GOALS.filter((g) => goalIds.has(g.id))

  // Tab counts follow every other filter, so each tab says how many rows it would show.
  const scoped = filterRows(all, { q, brand, category, goal, mineOf: yoursOnly ? brandView : null })
  const rows = tier ? scoped.filter((r) => r.tier === tier) : scoped
  const count = (t: 'all' | ProofTier) => (t === 'all' ? scoped.length : scoped.filter((r) => r.tier === t).length)
  const filtered = Boolean(q || brand || category || goal)
  const clearFilters = () => setParam({ q: null, brand: null, category: null, goal: null, tier: null })

  const pool = brandView ? mine : all
  const proven = pool.filter((r) => r.tier === 'proven').length
  const measured = all.filter((r) => r.rate !== null).length
  const description = !measured ? (
    `No product has ${MIN_GROUP} or more people at week ${wk} in this range yet.`
  ) : brandView ? (
    <>
      <strong>
        {proven} of {mine.length}
      </strong>{' '}
      of your products are Proven.
    </>
  ) : (
    <>
      <strong>
        {proven} of {all.length}
      </strong>{' '}
      products are Proven; {measured} have a measured outcome.
    </>
  )

  const toggle = (id: string) => setParam({ sel: toggleId(sel, id).join(',') || null })
  const compareHref = `/retail/compare${carry}${carry ? '&' : '?'}ids=${sel.map(encodeURIComponent).join(',')}`
  const none = <span className="text-ink-3">—</span>

  const columns: Column<ProductRow>[] = [
    {
      id: 'pick',
      header: <span className="sr-only">Pick to compare</span>,
      headerText: 'Pick',
      width: '52px',
      noCsv: true,
      cell: (r) => {
        const on = sel.includes(r.product_id)
        const full = !on && sel.length >= MAX_COMPARE
        return (
          <input
            type="checkbox"
            checked={on}
            disabled={full}
            title={full ? `Compare holds up to ${MAX_COMPARE} products` : undefined}
            aria-label={`Compare ${r.product}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={() => toggle(r.product_id)}
            className="size-4 cursor-pointer align-middle accent-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          />
        )
      },
    },
    {
      id: 'product',
      header: 'Product',
      headerText: 'Product (brand)',
      rowHeader: true,
      sortValue: (r) => r.product,
      firstDir: 'asc',
      // "Yours" only where it tells rows apart (All products in a brand workspace).
      cell: (r) => <ProductCell p={r} tag={brandView === r.brand && !yoursOnly ? <YoursTag /> : null} />,
      csv: (r) => `${r.product} (${r.brand})`,
    },
    {
      id: 'tier',
      header: <HeadTip label="Status" tip="Proven: 30+ people and a lift over non-users that stays above zero across its 95% interval. Hover a status for its definition." />,
      headerText: 'Status',
      width: '172px',
      sortValue: (r) => TIER_ORDER[r.tier] * 1000 + (r.rate ?? 0) * 100,
      firstDir: 'desc',
      cell: (r) => <ProofTierChip tier={r.tier} size="sm" hint={hintOf(r)} />,
      csv: (r) => TIERS[r.tier].label,
    },
    {
      id: 'rate',
      header: <HeadTip label="Visible change" tip={`Share of people using it who saw a real, visible change by week ${wk}. Bar: 95% interval. Tick: non-users with the same goals.`} />,
      headerText: `Visible change by week ${wk} (%)`,
      width: '196px',
      sortValue: (r) => r.rate,
      firstDir: 'desc',
      cell: (r) => (r.rate === null ? <span className="text-proof-small text-ink-2">{noDataReason(r)}</span> : <RateInterval rate={r.rate} lo={r.rate_lo} hi={r.rate_hi} base={r.base_rate} n={r.n} weeks={wk} />),
      csv: (r) => (r.rate === null ? (noDataReason(r) ?? '') : Math.round(r.rate * 100)),
    },
    {
      id: 'base',
      header: <HeadTip label="Non-users" tip={`Share of people with the same goals who don’t use it and saw a visible change by week ${wk}.`} />,
      headerText: `Non-users with a visible change by week ${wk} (%)`,
      align: 'right',
      width: '104px',
      sortValue: (r) => r.base_rate,
      cell: (r) => (r.rate === null ? none : r.base_rate === null ? <Suppressed short /> : <span className="tnum text-ink-2">{pct(r.base_rate)}</span>),
      csv: (r) => (r.base_rate === null ? '' : Math.round(r.base_rate * 100)),
    },
    {
      id: 'lift',
      header: <HeadTip label="Lift" tip="Visible change among users minus non-users, in percentage points. Hover a value for its 95% interval." />,
      headerText: 'Lift vs non-users (pts)',
      align: 'right',
      width: '88px',
      sortValue: (r) => r.lift,
      cell: (r) => (r.rate === null ? none : <LiftValue lift={r.lift} lo={r.lift_lo} hi={r.lift_hi} />),
      csv: (r) => (r.lift === null ? '' : Math.round(r.lift * 100)),
    },
    {
      id: 'n',
      header: <HeadTip label="People" tip={`People with ${wk} weeks of photos who used it: the n behind the rate.`} />,
      headerText: `People at week ${wk} (n)`,
      align: 'right',
      width: '88px',
      sortValue: (r) => r.n,
      cell: (r) => (r.n === null ? none : <span className="tnum text-ink">{int(r.n)}</span>),
      csv: (r) => r.n ?? '',
    },
    {
      id: 'category',
      header: 'Category',
      optional: true,
      hidden: true,
      width: '128px',
      sortValue: (r) => r.category_label,
      firstDir: 'asc',
      cell: (r) => <span className="block truncate text-ink-2">{r.category_label}</span>,
    },
    {
      id: 'weeks',
      header: <HeadTip label="Weeks to change" tip="Median weeks until the lasting change began, among people who changed." />,
      headerText: 'Weeks to first change (median)',
      optional: true,
      hidden: true,
      align: 'right',
      width: '136px',
      sortValue: (r) => r.weeks,
      firstDir: 'asc',
      cell: (r) => (r.weeks === null ? none : <span className="whitespace-nowrap tnum text-ink">{weeks(r.weeks)}</span>),
      csv: (r) => r.weeks ?? '',
    },
    {
      id: 'cont8',
      header: <HeadTip label={`Still using wk ${wk}`} tip={`Share of its users who still had it in their routine at week ${wk}.`} />,
      headerText: `Still using at week ${wk} (%)`,
      optional: true,
      hidden: true,
      align: 'right',
      width: '132px',
      sortValue: (r) => r.cont8,
      cell: (r) => (r.cont8 === null ? none : <span className="tnum text-ink">{pct(r.cont8)}</span>),
      csv: (r) => (r.cont8 === null ? '' : Math.round(r.cont8 * 100)),
    },
    {
      id: 'share',
      header: <HeadTip label="Share of routines" tip="Share of the category’s routines that include it." />,
      headerText: 'Share of category routines (%)',
      optional: true,
      hidden: true,
      align: 'right',
      width: '140px',
      sortValue: (r) => r.routine_share,
      cell: (r) => (r.routine_share === null ? <Suppressed short /> : <span className="tnum text-ink">{pct(r.routine_share)}</span>),
      csv: (r) => (r.routine_share === null ? 'suppressed' : Math.round(r.routine_share * 100)),
    },
    {
      id: 'price',
      header: 'Price tier',
      optional: true,
      hidden: true,
      width: '104px',
      sortValue: (r) => PRICE_ORDER[r.price_tier],
      firstDir: 'asc',
      cell: (r) => <span className="text-ink-2">{cap(r.price_tier)}</span>,
      csv: (r) => r.price_tier,
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Products"
        description={description}
        actions={
          <>
            {sel.length ? (
              <Button kind="ghost" onClick={() => setParam({ sel: null })}>
                Clear selection
              </Button>
            ) : null}
            <Button kind="secondary" disabled={sel.length < 2} onClick={() => navigate(compareHref)} title={sel.length < 2 ? `Tick 2 or ${MAX_COMPARE} products to compare them` : undefined}>
              <Columns3 size={15} strokeWidth={1.6} aria-hidden />
              Compare
              {sel.length ? (
                <span className="tnum text-ink-2">
                  {sel.length}/{MAX_COMPARE}
                </span>
              ) : null}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <Tabs label="Status" panelId="products-table" value={tier || 'all'} onChange={(t) => setParam({ tier: t === 'all' ? null : t })} tabs={TIER_TABS.map((t) => ({ ...t, count: count(t.id) }))} />

        <div id="products-table" role="tabpanel" className="overflow-hidden rounded-card border border-line bg-surface">
          <DataTable
            caption="Products"
            columns={columns}
            columnsKey="products"
            rows={rows}
            rowKey={(r) => r.product_id}
            onRowClick={(r) => navigate(`${sectionPath('products', r.product_id)}${carry}`)}
            rowLabel={(r) => `${r.product}, ${r.brand}, ${TIERS[r.tier].label}: open product page`}
            sort={sort}
            onSortChange={(s) => setParam({ sort: s && !(s.id === DEFAULT_SORT.id && s.dir === DEFAULT_SORT.dir) ? `${s.id}.${s.dir}` : null })}
            defaultSort={DEFAULT_SORT}
            maxHeight="max(440px, calc(100dvh - 330px))"
            minWidth={880}
            csv={{ name: csvName('products', res), meta: csvMeta(res, [yoursOnly && `brand ${brandView}`, brand && `brand ${brand}`, category && `category ${category}`, goal && `goal ${goal}`, tier && `status ${TIERS[tier].label}`, q && `search "${q}"`].filter(Boolean).join(' · ') || undefined) }}
            empty={
              <span className="flex flex-col items-center gap-3">
                No product matches these filters.
                <Button kind="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              </span>
            }
            heading={<SearchField label="Search products" value={q} onChange={(v) => setParam({ q: v })} placeholder="Search product or brand" />}
            toolbar={
              <>
                {filtered ? (
                  <Button kind="ghost" size="sm" onClick={clearFilters}>
                    Clear
                  </Button>
                ) : null}
                {brandView ? (
                  <Segmented
                    label="Whose products"
                    value={yoursOnly ? 'yours' : 'all'}
                    onChange={(v) => setParam({ scope: v === 'all' ? 'all' : null })}
                    options={[
                      { value: 'yours', label: 'Your products' },
                      { value: 'all', label: 'All products' },
                    ]}
                  />
                ) : (
                  <Select label="Brand" hideLabel value={brand} onChange={(v) => setParam({ brand: v })} options={[{ value: '', label: 'All brands' }, ...brands.map((b) => ({ value: b, label: b }))]} />
                )}
                <Select label="Category" hideLabel value={category} onChange={(v) => setParam({ category: v })} options={[{ value: '', label: 'All categories' }, ...categories.map(([value, label]) => ({ value, label }))]} />
                <Select label="Goal" hideLabel value={goal} onChange={(v) => setParam({ goal: v })} options={[{ value: '', label: 'All goals' }, ...goals.map((g) => ({ value: g.id, label: g.label }))]} />
              </>
            }
          />
        </div>
      </div>
    </div>
  )
}
