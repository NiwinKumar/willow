import { ArrowRight, Columns3, Megaphone, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { GOALS } from '../../../lib/metrics'
import { ProductImage } from '../../routine/productUi'
import { useRetailData } from '../context'
import { csvMeta, csvName } from '../data'
import { useProductDetail, useProducts } from '../productData'
import { filterRows, hintOf, MAX_COMPARE, parseIds, rivalOf, TIER_ORDER, toggleId } from '../productModel'
import { sectionPath, useRetailState } from '../state'
import type { Insights, ProductRow, ProofTier } from '../types'
import { DataTable, ErrorState, EvidenceBar, int, interval, LiftValue, MIN_GROUP, Panel, pct, ProductCell, ProofTierChip, pts, SearchField, SectionHeader, Select, SidePanel, SimBadge, SkeletonHeader, SkeletonTable, Stat, Suppressed, Term, TIERS, ToolButton, weeks, type Column, type Sort } from '../ui'
import { InsightsGate, useWorkspaceLabel, YoursTag } from './shared'

/*
 * Products (/retail/products): every catalog product's measured outcome as a scoreboard on
 * GET /v1/retailer/products. Filters, sort, the quick-look row (?product=) and the rows picked for Compare
 * (?sel=a,b) all live in the URL. In a brand workspace the brand's own rows carry a leaf edge and "Yours", and
 * "Mine only" narrows to them. Row → quick look (side panel) → product page, Compare or Promote.
 */

export default function Products() {
  return (
    <InsightsGate skeleton={<ProductsSkeleton />}>
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function ProductsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <SkeletonHeader />
      <SkeletonTable rows={12} />
    </div>
  )
}

const SORTS = ['rate', 'lift', 'n', 'weeks', 'cont8', 'share', 'product', 'category', 'tier'] as const
const TIER_IDS = Object.keys(TIERS) as ProofTier[]

function Body({ d }: { d: Insights }) {
  const { filters, workspace } = useRetailData()
  const { param, setParam, carry } = useRetailState()
  const navigate = useNavigate()
  const eyebrow = useWorkspaceLabel()
  const brandView = workspace.kind === 'brand' ? workspace.brand : null
  const { state, retry } = useProducts(filters)
  const all = useMemo(() => (state.status === 'ready' ? state.d.products : []), [state])

  const q = param('q') ?? ''
  const brand = param('brand') ?? ''
  const category = param('category') ?? ''
  const goal = param('goal') ?? ''
  const tier = TIER_IDS.find((t) => t === param('tier')) ?? ''
  const mineOnly = param('mine') === '1' && brandView !== null
  const selected = param('product')
  const sel = parseIds(param('sel'))
  const sortParam = param('sort')
  const sort: Sort | null = (() => {
    const [id, dir] = (sortParam ?? '').split('.')
    return (SORTS as readonly string[]).includes(id) && (dir === 'asc' || dir === 'desc') ? { id, dir } : null
  })()

  if (state.status === 'loading') return <ProductsSkeleton />
  if (state.status !== 'ready') return <ErrorState title="The scoreboard couldn’t load" body="The products service didn’t answer. No partial numbers are shown." onRetry={retry} />

  const res = state.d
  const brands = [...new Set(all.map((r) => r.brand))].sort()
  const categories = [...new Map(all.map((r) => [r.category, r.category_label])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const goalIds = new Set(all.flatMap((r) => r.goal_ids))
  const goals = GOALS.filter((g) => goalIds.has(g.id))
  const rows = filterRows(all, { q, brand: mineOnly ? '' : brand, category, goal, tier, mineOf: mineOnly ? brandView : null })
  const measured = all.filter((r) => r.rate !== null)
  const proven = all.filter((r) => r.tier === 'proven')
  const best = [...measured].filter((r) => r.lift !== null).sort((a, b) => b.lift! - a.lift!)[0]
  const mine = brandView ? all.filter((r) => r.brand === brandView) : []
  const sel3 = sel.filter((id) => all.some((r) => r.product_id === id))
  const filtered = Boolean(q || brand || category || goal || tier || mineOnly)
  const toggle = (id: string) => setParam({ sel: toggleId(sel3, id).join(',') || null })
  const compareHref = (ids: string[]) => `/retail/compare${carry}${carry ? '&' : '?'}ids=${ids.map(encodeURIComponent).join(',')}`

  const columns: Column<ProductRow>[] = [
    {
      id: 'pick',
      header: <span className="sr-only">Pick to compare</span>,
      headerText: 'Pick',
      width: '40px',
      noCsv: true,
      cell: (r) => {
        const on = sel3.includes(r.product_id)
        const full = !on && sel3.length >= MAX_COMPARE
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
            className="size-4 cursor-pointer accent-[var(--proof-leaf)] disabled:cursor-not-allowed disabled:opacity-40"
          />
        )
      },
    },
    {
      id: 'product',
      header: 'Product',
      rowHeader: true,
      sortValue: (r) => r.product,
      cell: (r) => <ProductCell p={r} tag={brandView === r.brand ? <YoursTag /> : null} />,
      headerText: 'Product (brand)',
      csv: (r) => `${r.product} (${r.brand})`,
    },
    { id: 'category', header: 'Category', width: '96px', sortValue: (r) => r.category_label, cell: (r) => <span className="block truncate text-ink-2">{r.category_label}</span> },
    {
      id: 'tier',
      header: <Term id="proof_tier">Proof tier</Term>,
      headerText: 'Proof tier',
      width: '150px',
      sortValue: (r) => TIER_ORDER[r.tier] * 1000 + (r.rate ?? 0) * 100,
      firstDir: 'desc',
      cell: (r) => <ProofTierChip tier={r.tier} size="sm" hint={hintOf(r)} />,
      csv: (r) => TIERS[r.tier].label,
    },
    {
      id: 'rate',
      header: <Term id="real_change">Real change</Term>,
      headerText: 'Real change by week 8 (%)',
      width: '188px',
      sortValue: (r) => r.rate,
      firstDir: 'desc',
      cell: (r) =>
        r.rate === null ? (
          <span className="text-proof-small text-ink-2">{r.reason === 'not_measured' ? 'Not measured' : r.reason === 'unused' ? 'Not used yet' : <Suppressed short />}</span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-right font-mono tnum">{pct(r.rate)}</span>
            <EvidenceBar rate={r.rate} lo={r.rate_lo} hi={r.rate_hi} base={r.base_rate} n={r.n} className="min-w-0 flex-1" />
          </span>
        ),
      csv: (r) => (r.rate === null ? (r.reason ?? 'suppressed') : Math.round(r.rate * 100)),
    },
    {
      id: 'lift',
      header: <Term id="lift">Lift</Term>,
      headerText: 'Lift vs non-users (pts)',
      align: 'right',
      width: '78px',
      sortValue: (r) => r.lift,
      cell: (r) => <LiftValue lift={r.lift} lo={r.lift_lo} hi={r.lift_hi} />,
      csv: (r) => (r.lift === null ? '' : Math.round(r.lift * 100)),
    },
    {
      id: 'weeks',
      header: <span title="Median weeks until the lasting change began">Time</span>,
      headerText: 'Median weeks to change',
      align: 'right',
      width: '64px',
      sortValue: (r) => r.weeks,
      firstDir: 'asc',
      cell: (r) => <span className="whitespace-nowrap font-mono tnum">{weeks(r.weeks)}</span>,
      csv: (r) => r.weeks ?? '',
    },
    {
      id: 'cont8',
      header: <Term id="continuation">Wk 8</Term>,
      headerText: `Still using at week ${d.cohort.weeks} (%)`,
      align: 'right',
      width: '64px',
      sortValue: (r) => r.cont8,
      cell: (r) => (r.cont8 === null ? <span className="text-ink-2">—</span> : <span className="font-mono tnum">{pct(r.cont8)}</span>),
      csv: (r) => (r.cont8 === null ? '' : Math.round(r.cont8 * 100)),
    },
    {
      id: 'share',
      header: <Term id="routine_share">Share</Term>,
      headerText: 'Share of category routines (%)',
      align: 'right',
      width: '66px',
      sortValue: (r) => r.routine_share,
      cell: (r) => (r.routine_share === null ? <Suppressed short /> : <span className="font-mono tnum">{pct(r.routine_share)}</span>),
      csv: (r) => (r.routine_share === null ? 'suppressed' : Math.round(r.routine_share * 100)),
    },
  ]

  const selRows = sel3.map((id) => all.find((r) => r.product_id === id)!).filter(Boolean)

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow={eyebrow}
        title="Products"
        answer={
          measured.length ? (
            <>
              <strong>{proven.length}</strong> of {all.length} products are <Term id="proof_tier">Proven</Term>; {measured.length} have a measured outcome.{' '}
              {brandView && mine.length ? (
                <>
                  {brandView}: <strong>{mine.filter((r) => r.tier === 'proven').length}</strong> of {mine.length} Proven.{' '}
                </>
              ) : best ? (
                <>
                  Largest <Term id="lift">lift</Term>: <strong>{best.product}</strong> ({best.brand}), {pct(best.rate)} vs {pct(best.base_rate)} non-users ({pts(best.lift)}, n={int(best.n)}).
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
            Ember dot: real-change rate by week {d.cohort.weeks}; bar: its <Term id="interval">95% interval</Term>; tick: <Term id="base_rate">non-users</Term> with an overlapping goal. Time: median weeks until the change began. <Term id="suppression">Groups under {MIN_GROUP}</Term> show as “n&lt;{MIN_GROUP}”. {res.counts.not_measured ? `${res.counts.not_measured} products target a concern Willow doesn’t measure. ` : ''}
            {res.counts.too_few - res.counts.not_measured > 0 ? `${res.counts.too_few - res.counts.not_measured} have too few people. ` : ''}Tick up to {MAX_COMPARE} rows to compare.
          </>
        }
      >
        <DataTable
          caption="Products scoreboard"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.product_id}
          onRowClick={(r) => setParam({ product: r.product_id }, { push: true })}
          rowLabel={(r) => `${r.product}, ${r.brand}, ${TIERS[r.tier].label}: open quick look`}
          rowClassName={(r) => (brandView === r.brand ? '[&>*:first-child]:shadow-[inset_2px_0_0_var(--proof-leaf)]' : '')}
          selectedKey={selected}
          sort={sort}
          onSortChange={(s) => setParam({ sort: s ? `${s.id}.${s.dir}` : null })}
          defaultSort={{ id: 'tier', dir: 'desc' }}
          maxHeight="calc(100dvh - var(--proof-head) - 250px)"
          minWidth={940}
          csv={{ name: csvName('products', res), meta: csvMeta(res, [brand && `brand ${brand}`, mineOnly && `brand ${brandView}`, category && `category ${category}`, goal && `goal ${goal}`, tier && `tier ${tier}`, q && `search "${q}"`].filter(Boolean).join(' · ') || undefined) }}
          empty={
            <span className="flex flex-col items-center gap-2">
              No product matches these filters.
              <ToolButton onClick={() => setParam({ q: null, brand: null, category: null, goal: null, tier: null, mine: null })}>Clear filters</ToolButton>
            </span>
          }
          heading={
            <>
              <h2 className="m-0 text-proof-h font-medium text-ink">Scoreboard</h2>
              <SimBadge cohort={res.cohort} />
            </>
          }
          toolbar={
            <>
              <SearchField label="Search products" value={q} onChange={(v) => setParam({ q: v })} placeholder="Search product or brand" />
              {brandView ? (
                <ToolButton pressed={mineOnly} onClick={() => setParam({ mine: mineOnly ? null : '1', brand: null })} label={`Mine only: show only ${brandView}`}>
                  Mine only
                </ToolButton>
              ) : null}
              {mineOnly ? null : <Select label="Brand" hideLabel value={brand} onChange={(v) => setParam({ brand: v })} options={[{ value: '', label: 'All brands' }, ...brands.map((b) => ({ value: b, label: b }))]} />}
              <Select label="Category" hideLabel value={category} onChange={(v) => setParam({ category: v })} options={[{ value: '', label: 'All categories' }, ...categories.map(([value, l]) => ({ value, label: l }))]} />
              <Select label="Goal" hideLabel value={goal} onChange={(v) => setParam({ goal: v })} options={[{ value: '', label: 'All goals' }, ...goals.map((g) => ({ value: g.id, label: g.label }))]} />
              <Select label="Proof tier" hideLabel value={tier} onChange={(v) => setParam({ tier: v })} options={[{ value: '', label: 'All tiers' }, ...TIER_IDS.map((t) => ({ value: t, label: TIERS[t].label }))]} />
              {filtered ? (
                <button type="button" onClick={() => setParam({ q: null, brand: null, category: null, goal: null, tier: null, mine: null })} className="hit44 h-8 rounded-xs border-0 bg-transparent px-1.5 text-proof-small text-ink-2 underline decoration-dotted underline-offset-[3px] hover:text-ink">
                  Clear
                </button>
              ) : null}
              <span aria-live="polite" className="font-mono text-[11px] text-ink-2 tnum">
                {rows.length} of {all.length}
              </span>
            </>
          }
        />
      </Panel>

      {selRows.length ? (
        <div role="region" aria-label="Compare selection" className="sticky bottom-4 z-20 mx-auto flex max-w-full flex-wrap items-center gap-2 rounded-sm border border-line-strong bg-muted px-3 py-2 shadow-modal animate-[proofDrop_.2s_var(--ease-standard)_both]">
          <span className="font-mono text-[11px] text-ink-2 tnum">
            {selRows.length}/{MAX_COMPARE}
          </span>
          <ul className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0">
            {selRows.map((r) => (
              <li key={r.product_id} className="inline-flex h-7 max-w-[220px] items-center gap-1 rounded-pill border border-line bg-sunken pl-2.5 pr-1 text-proof-small text-ink">
                <span className="truncate" title={`${r.product} · ${r.brand}`}>
                  {r.product}
                </span>
                <button type="button" onClick={() => toggle(r.product_id)} aria-label={`Remove ${r.product} from compare`} className="grid size-5 shrink-0 place-items-center rounded-full border-0 bg-transparent text-ink-2 hover:bg-glass hover:text-ink">
                  <X size={12} strokeWidth={1.8} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={selRows.length < 2}
            onClick={() => navigate(compareHref(sel3))}
            title={selRows.length < 2 ? 'Pick at least 2 products' : undefined}
            className="hit44 inline-flex h-8 items-center gap-1.5 rounded-xs border-0 bg-selected px-3 text-proof-small font-medium text-inverse hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Columns3 size={14} strokeWidth={1.8} aria-hidden />
            Compare {selRows.length}
          </button>
          <button type="button" onClick={() => setParam({ sel: null })} className="hit44 h-8 rounded-xs border-0 bg-transparent px-2 text-proof-small text-ink-2 hover:text-ink">
            Clear
          </button>
        </div>
      ) : null}

      <QuickLook row={selected ? (all.find((r) => r.product_id === selected) ?? null) : null} all={all} d={d} sel={sel3} onClose={() => setParam({ product: null })} carry={carry} compareHref={compareHref} />
    </div>
  )
}

/** Row → side panel: the product's figures at a glance, its promotion eligibility, and where to go next. */
function QuickLook({ row, all, d, sel, onClose, carry, compareHref }: { row: ProductRow | null; all: ProductRow[]; d: Insights; sel: string[]; onClose: () => void; carry: string; compareHref: (ids: string[]) => string }) {
  const { filters } = useRetailData()
  // Keep the last row while the panel slides out (state adjusted during render, not in an effect).
  const [last, setLast] = useState<ProductRow | null>(row)
  if (row && row !== last) setLast(row)
  const r = row ?? last
  const detail = useProductDetail(row?.product_id ?? null, filters)
  const el = detail.status === 'ready' ? detail.d.eligibility : null
  const rival = r ? rivalOf(r, all) : null
  const ids = r ? (sel.length && !sel.includes(r.product_id) ? [...sel, r.product_id].slice(-3) : sel.includes(r.product_id) && sel.length > 1 ? sel : rival ? [r.product_id, rival.product_id] : [r.product_id]) : []
  const goalLabel = (g: string) => GOALS.find((x) => x.id === g)?.label ?? g
  const btn = 'hit44 inline-flex h-8 items-center gap-1.5 rounded-xs px-3 text-proof-small no-underline'
  return (
    <SidePanel
      open={Boolean(row)}
      onClose={onClose}
      title={r?.product ?? 'Product'}
      subtitle={r ? `${r.brand} · ${r.category_label} · ${r.price_tier[0].toUpperCase()}${r.price_tier.slice(1)} price tier` : undefined}
      labelledBy="quick-look-title"
      footer={
        r ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`${sectionPath('products', r.product_id)}${carry}`} className={`${btn} bg-selected font-medium text-inverse hover:bg-ink/85`}>
              Open product page <ArrowRight size={13} strokeWidth={1.8} aria-hidden />
            </Link>
            <Link to={compareHref(ids)} className={`${btn} border border-line-strong text-ink hover:bg-glass`} title={ids.length > 1 ? `Compare with ${ids.filter((x) => x !== r.product_id).map((x) => all.find((y) => y.product_id === x)?.product).join(', ')}` : undefined}>
              <Columns3 size={13} strokeWidth={1.8} aria-hidden /> Compare
            </Link>
            {el?.eligible ? (
              <Link to={`/retail/promote${carry}${carry ? '&' : '?'}product=${encodeURIComponent(r.product_id)}`} className={`${btn} border border-proof-leaf-line text-ink hover:bg-proof-leaf-soft`}>
                <Megaphone size={13} strokeWidth={1.8} aria-hidden /> Promote
              </Link>
            ) : (
              <span className={`${btn} cursor-not-allowed border border-line text-ink-2`} aria-disabled title="Only Proven products with a goal of their own can be promoted">
                <Megaphone size={13} strokeWidth={1.8} aria-hidden /> Promote
              </span>
            )}
          </div>
        ) : null
      }
    >
      {r ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <ProductImage product={{ image_url: r.image_url, category: r.category, name: r.product }} size={44} />
            <ProofTierChip tier={r.tier} hint={hintOf(r)} />
            <SimBadge cohort={d.cohort} />
          </div>
          <div className="flex flex-col gap-2 rounded-sm border border-line bg-sunken p-3.5">
            <span className="text-proof-small text-ink-2">
              <Term id="real_change">Real change</Term> by week {d.cohort.weeks}
            </span>
            {r.rate === null ? (
              <span className="text-proof-body text-ink-2">{r.reason === 'not_measured' ? 'Not measured: its concerns have no Willow metric.' : r.reason === 'unused' ? 'No Willow users have it in their routine yet.' : 'Fewer than 10 people'}</span>
            ) : (
              <>
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[26px] leading-none text-ink tnum">{pct(r.rate)}</span>
                  <span className="text-proof-small text-ink-2">
                    of {int(r.n)} users · 95% interval {interval(r.rate_lo, r.rate_hi)}
                  </span>
                </span>
                <EvidenceBar rate={r.rate} lo={r.rate_lo} hi={r.rate_hi} base={r.base_rate} n={r.n} />
              </>
            )}
          </div>
          {hintOf(r) ? <p className="m-0 rounded-sm border border-proof-leaf-line bg-proof-leaf-soft px-3 py-2 text-proof-small text-ink">{hintOf(r)}</p> : null}
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3.5">
            <Stat label={<Term id="base_rate">Non-users</Term>} value={pct(r.base_rate)} sub={r.base_rate === null ? 'Fewer than 10 people' : 'same goals'} />
            <Stat label={<Term id="lift">Lift</Term>} value={pts(r.lift)} sub={r.lift_lo !== null && r.lift_hi !== null ? `95%: ${pts(r.lift_lo)} to ${pts(r.lift_hi)}` : undefined} />
            <Stat label="Median time to change" value={weeks(r.weeks)} sub={r.weeks === null ? undefined : 'among those who changed'} />
            <Stat label={<Term id="continuation">Still using wk {d.cohort.weeks}</Term>} value={pct(r.cont8)} sub={r.n ? `of ${int(r.n)}` : undefined} />
            <Stat label={<Term id="routine_share">Share of routines</Term>} value={pct(r.routine_share)} sub={`in ${r.category_label.toLowerCase()}`} />
            <Stat label="People using it" value={int(r.users)} sub="any week" />
          </dl>
          <div className="flex flex-col gap-1.5 border-t border-line pt-3">
            <span className="text-proof-small text-ink-2">Promotion</span>
            {detail.status === 'loading' ? (
              <span className="retail-shimmer block h-4 w-3/4 rounded-xs" aria-label="Loading eligibility" />
            ) : el ? (
              el.eligible ? (
                <p className="m-0 text-proof-body text-ink">
                  <span aria-hidden className="text-proof-leaf">● </span>Eligible for {el.goals.map(goalLabel).join(', ').toLowerCase()}
                  {el.skin_types.length ? ` · ${el.skin_types.length} skin ${el.skin_types.length === 1 ? 'type' : 'types'}` : ''}.
                </p>
              ) : (
                <p className="m-0 text-proof-body text-ink-2">{el.reasons[0]}</p>
              )
            ) : (
              <p className="m-0 text-proof-small text-ink-2">Eligibility couldn’t load. The product page has it.</p>
            )}
          </div>
          <p className="m-0 text-proof-small text-ink-2">An association with use, not proof of effect: people chose their own products. Cosmetic measurements only.</p>
        </div>
      ) : null}
    </SidePanel>
  )
}
