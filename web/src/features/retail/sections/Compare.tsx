import { ArrowLeft, Download, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useRetailData } from '../context'
import { csvMeta } from '../data'
import { useProductDetails, useProducts, type Load } from '../productData'
import { MAX_COMPARE, money, parseIds, segInterval } from '../productModel'
import { sectionPath, useRetailState } from '../state'
import type { Insights, ProductDetail as Detail, Seg } from '../types'
import { Bone, Combobox, CurveChart, downloadCsv, EmptyState, EvidenceBar, int, interval, LiftValue, MIN_GROUP, Panel, pct, ProductCell, ProofTierChip, pts, SectionHeader, SimBadge, SkeletonHeader, Term, ToolButton, weeks, type CsvValue } from '../ui'
import { InsightsGate, useWorkspaceLabel, YoursTag } from './shared'

/*
 * Compare (/retail/compare?ids=a,b,c): two or three products side by side on GET /v1/retailer/products/{id}:
 * tier, real-change rate and lift with their 95% intervals, time to change, continuation, share of routines,
 * category rank, the outcome curves overlaid (one hue, told apart by line pattern and letter), and skin types
 * cell by cell. Reached from the scoreboard's multi-select, the quick look and the product page.
 */

export default function Compare() {
  return (
    <InsightsGate skeleton={<CompareSkeleton />}>
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function CompareSkeleton() {
  return (
    <div role="status" aria-label="Loading comparison" className="flex flex-col gap-4">
      <SkeletonHeader />
      <Bone className="h-[420px] w-full rounded-sm" />
      <Bone className="h-[260px] w-full rounded-sm" />
    </div>
  )
}

const LETTERS = ['A', 'B', 'C'] as const
/** Same ember (every line is a real-change share), told apart by pattern: solid, dashed, dotted. */
const DASH = [undefined, '7 4', '1.5 3.5'] as const

function Body({ d }: { d: Insights }) {
  const { filters, workspace } = useRetailData()
  const { param, setParam, carry } = useRetailState()
  const eyebrow = useWorkspaceLabel()
  const brandView = workspace.kind === 'brand' ? workspace.brand : null
  const ids = parseIds(param('ids'))
  const states = useProductDetails(ids, filters)
  const list = useProducts(filters).state
  const rows = list.status === 'ready' ? list.d.products : []
  const setIds = (next: string[]) => setParam({ ids: next.join(',') || null })
  const ready = states.map((s, i) => ({ s, id: ids[i] })).filter((x): x is { s: Extract<Load<Detail>, { status: 'ready' }>; id: string } => x.s.status === 'ready')
  const xs = ready.map((x) => x.s.d)
  const missing = ids.filter((_, i) => states[i]?.status === 'missing' || states[i]?.status === 'failed')
  const loading = states.some((s) => s.status === 'loading')

  const picker = (
    <Combobox
      label="Add product"
      value=""
      emptyText={ids.length >= MAX_COMPARE ? `Up to ${MAX_COMPARE}` : 'Search'}
      searchPlaceholder="Search products or brands"
      width={380}
      disabled={ids.length >= MAX_COMPARE || !rows.length}
      options={rows
        .filter((r) => !ids.includes(r.product_id))
        .sort((a, b) => a.category_label.localeCompare(b.category_label) || a.product.localeCompare(b.product))
        .map((r) => ({ value: r.product_id, label: `${r.product} · ${r.brand}`, hint: r.rate === null ? 'no data' : pct(r.rate), group: r.category_label }))}
      onChange={(v) => setIds([...ids, v])}
    />
  )
  const back = (
    <Link to={`${sectionPath('products')}${carry}`} className="hit44 inline-flex h-8 items-center gap-1.5 rounded-xs px-1 text-proof-small text-ink-2 no-underline hover:text-ink">
      <ArrowLeft size={13} strokeWidth={1.6} aria-hidden /> All products
    </Link>
  )

  if (ids.length < 2) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <SectionHeader eyebrow={`${eyebrow} · Compare`} title="Compare products" answer="Pick two or three products to see their measured outcomes side by side, with intervals." />
        <EmptyState glyph="A·B" title={ids.length ? 'Add one more product' : 'Pick two or three products'} body="Tick rows on the scoreboard, or search the catalog here." action={{ label: 'Open the scoreboard', to: `${sectionPath('products')}${carry}` }}>
          <div className="mt-1">{picker}</div>
        </EmptyState>
      </div>
    )
  }

  const exportCsv = () => {
    const metrics: [string, (x: Detail) => CsvValue][] = [
      ['Brand', (x) => x.product.brand],
      ['Category', (x) => x.product.category_label],
      ['Proof tier', (x) => x.product.tier_label ?? x.product.tier],
      ['People at week 8 (n)', (x) => x.product.n],
      ['Real change by week 8 (%)', (x) => (x.product.rate === null ? 'suppressed' : Math.round(x.product.rate * 100))],
      ['Real change 95% interval', (x) => interval(x.product.rate_lo, x.product.rate_hi) ?? ''],
      ['Non-users (%)', (x) => (x.product.base_rate === null ? '' : Math.round(x.product.base_rate * 100))],
      ['Lift (pts)', (x) => (x.product.lift === null ? '' : Math.round(x.product.lift * 100))],
      ['Lift 95% interval (pts)', (x) => (x.product.lift_lo === null || x.product.lift_hi === null ? '' : `${Math.round(x.product.lift_lo * 100)} to ${Math.round(x.product.lift_hi * 100)}`)],
      ['Median weeks to change', (x) => x.product.weeks],
      ['Still using at week 8 (%)', (x) => (x.product.cont8 === null ? '' : Math.round(x.product.cont8 * 100))],
      ['Share of category routines (%)', (x) => (x.product.routine_share === null ? 'suppressed' : Math.round(x.product.routine_share * 100))],
      ['Rank in category', (x) => (x.competitors.rank ? `${x.competitors.rank} of ${x.competitors.of}` : '')],
    ]
    downloadCsv(
      `willow-proof-compare-${xs.map((x) => x.product.product_id).join('-vs-')}.csv`.slice(0, 180),
      csvMeta(xs[0], 'compare'),
      ['Measure', ...xs.map((x) => x.product.product)],
      metrics.map(([k, f]) => [k, ...xs.map(f)]),
    )
  }

  const answer = (() => {
    const m = xs.filter((x) => x.product.rate !== null).sort((a, b) => b.product.rate! - a.product.rate!)
    if (m.length < 2) return 'At most one of these has 10 or more people at week 8, so there is no measured comparison yet.'
    const [a, b] = m
    const clear = a.product.rate_lo !== null && b.product.rate_hi !== null && a.product.rate_lo > b.product.rate_hi
    return (
      <>
        <strong>{a.product.product}</strong> has the highest real-change rate here ({pct(a.product.rate)}, n={int(a.product.n)}), against {pct(b.product.rate)} for {b.product.product} (n={int(b.product.n)}). {clear ? 'Their 95% intervals don’t overlap.' : 'Their 95% intervals overlap, so the difference may be chance.'}
      </>
    )
  })()

  return (
    <div className="flex flex-col gap-4">
      {back}
      <SectionHeader
        eyebrow={`${eyebrow} · Compare`}
        title="Compare products"
        answer={loading && xs.length < 2 ? 'Loading the products…' : answer}
        actions={
          <>
            {picker}
            <ToolButton onClick={exportCsv} disabled={!xs.length} label="Export this comparison as CSV">
              <Download size={14} strokeWidth={1.6} aria-hidden /> Export CSV
            </ToolButton>
          </>
        }
      />
      {missing.length ? (
        <p role="alert" className="m-0 rounded-xs border border-line-strong bg-sunken px-3 py-2 text-proof-small text-ink">
          {missing.length === 1 ? 'One product' : `${missing.length} products`} in this link isn’t in the catalog ({missing.join(', ')}).{' '}
          <button type="button" onClick={() => setIds(ids.filter((i) => !missing.includes(i)))} className="border-0 bg-transparent p-0 text-ink underline">
            Remove
          </button>
        </p>
      ) : null}

      <Panel flush title="Side by side" id="cmp-h" meta={<SimBadge cohort={d.cohort} />} footnote={<>{xs[0]?.competitors.note ?? 'Observational comparison under the same method; differences inside the confidence intervals are not meaningful.'} Hover a rate or lift for its <Term id="interval">95% interval</Term>.</>}>
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[560px] table-fixed border-separate border-spacing-0 text-proof-body">
            <caption className="sr-only">Products compared side by side</caption>
            <colgroup>
              <col className="w-[116px] sm:w-[168px]" />
              {ids.map((id) => (
                <col key={id} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <td className="border-b border-line px-4 py-3" />
                {ids.map((id, i) => {
                  const st = states[i]
                  const x = st?.status === 'ready' ? st.d : null
                  return (
                    <th key={id} scope="col" className="border-b border-l border-line px-4 py-3 text-left align-top font-normal">
                      {x ? (
                        <div className="flex min-w-0 flex-col gap-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="flex items-center gap-2 font-mono text-[11px] text-ink-2">
                              <Swatch i={i} /> {LETTERS[i]}
                            </span>
                            <button type="button" onClick={() => setIds(ids.filter((v) => v !== id))} aria-label={`Remove ${x.product.product}`} className="hit44 -mr-1.5 -mt-1 grid size-6 place-items-center rounded-xs border-0 bg-transparent text-ink-2 hover:bg-glass hover:text-ink">
                              <X size={13} strokeWidth={1.6} aria-hidden />
                            </button>
                          </div>
                          <ProductCell p={x.product} size={36} to={`${sectionPath('products', id)}${carry}`} tag={brandView === x.product.brand ? <YoursTag /> : null} />
                          <span>
                            <ProofTierChip tier={x.product.tier} size="sm" />
                          </span>
                        </div>
                      ) : st?.status === 'loading' ? (
                        <div className="flex flex-col gap-2">
                          <Bone className="h-3 w-6" />
                          <Bone className="h-9 w-4/5" />
                          <Bone className="h-5 w-20" />
                        </div>
                      ) : (
                        <span className="text-proof-small text-ink-2">Not in the catalog</span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              <Row label={<Term id="real_change">Real change</Term>} states={states} cell={(x) => (x.product.rate === null ? <span className="text-ink-2">Fewer than {MIN_GROUP} people</span> : <RateBlock x={x} />)} />
              <Row label={<Term id="base_rate">Non-users</Term>} states={states} cell={(x) => <Num v={pct(x.product.base_rate)} sub={x.product.base_rate === null ? 'Fewer than 10 people' : 'same goals'} />} />
              <Row label={<Term id="lift">Lift</Term>} states={states} cell={(x) => <Num v={<LiftValue lift={x.product.lift} lo={x.product.lift_lo} hi={x.product.lift_hi} />} sub={x.product.lift_lo !== null && x.product.lift_hi !== null ? `95%: ${pts(x.product.lift_lo)} to ${pts(x.product.lift_hi)}` : undefined} />} />
              <Row label="Time to change" states={states} cell={(x) => <Num v={weeks(x.product.weeks)} sub={x.product.weeks === null ? undefined : 'median'} />} />
              <Row label={<Term id="continuation">Still using wk {d.cohort.weeks}</Term>} states={states} cell={(x) => <Num v={pct(x.product.cont8)} sub={x.product.n ? `of ${int(x.product.n)}` : undefined} />} />
              <Row label={<Term id="routine_share">Share of routines</Term>} states={states} cell={(x) => <Num v={pct(x.product.routine_share)} sub={`${int(x.product.users)} users · ${x.product.category_label.toLowerCase()}`} />} />
              <Row label="Rank in category" states={states} cell={(x) => <Num v={x.competitors.rank ? `${x.competitors.rank} of ${x.competitors.of}` : '—'} sub={x.competitors.rank ? x.product.category_label.toLowerCase() : 'not ranked'} />} />
              <Row label="Price" states={states} cell={(x) => <Num v={money(x.product.price) ?? '—'} sub={`${x.product.price_tier} tier${x.product.size ? ` · ${x.product.size}` : ''}`} />} />
              <tr>
                <th scope="rowgroup" colSpan={ids.length + 1} className="border-b border-line bg-sunken px-4 py-1.5 text-left text-proof-small font-normal text-ink-2">
                  Real change by skin type <span className="text-ink-2">· rate, n and 95% interval</span>
                </th>
              </tr>
              {skinIds(xs).map((s) => (
                <Row key={s.id} label={s.label} states={states} cell={(x) => <SegCell seg={x.segments.skin.find((g) => g.id === s.id)} />} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {xs.length >= 2 ? (
        <Panel title="When the lasting change began" id="cmp-curve-h" meta={<SimBadge cohort={d.cohort} />} footnote={<>Cumulative share of each product’s users whose real change (held to week {d.cohort.weeks}) had begun by that week. Lines: {ready.map((r) => `${LETTERS[ids.indexOf(r.id)]} ${r.s.d.product.product}`).join('; ')}.</>}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <CurveChart
              title="Cumulative share with a real change by week, per product"
              weeks={xs[0].curve.weeks}
              height={230}
              series={ready.map((r) => {
                const i = ids.indexOf(r.id)
                return { id: r.id, label: LETTERS[i], values: r.s.d.curve.users, tone: 'signal' as const, n: r.s.d.product.n, dash: DASH[i] }
              })}
            />
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Legend">
              {ready.map((r) => {
                const i = ids.indexOf(r.id)
                return (
                  <li key={r.id} className="flex items-center gap-2.5">
                    <Swatch i={i} />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-proof-body text-ink" title={r.s.d.product.product}>
                        {LETTERS[i]} · {r.s.d.product.product}
                      </span>
                      <span className="font-mono text-[11px] text-ink-2 tnum">
                        {pct(r.s.d.product.rate)} by wk {d.cohort.weeks} · n={int(r.s.d.product.n)}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

/** The line pattern of product i as a legend key. */
function Swatch({ i }: { i: number }) {
  return (
    <svg width="26" height="8" aria-hidden className="shrink-0">
      <line x1="1" x2="25" y1="4" y2="4" stroke="var(--signal-change)" strokeWidth="2" strokeDasharray={DASH[i]} strokeLinecap="round" />
    </svg>
  )
}

function Row({ label, states, cell }: { label: ReactNode; states: Load<Detail>[]; cell: (x: Detail) => ReactNode }) {
  return (
    <tr>
      <th scope="row" className="border-b border-line px-4 py-2 text-left align-middle text-proof-small font-normal text-ink-2">
        {label}
      </th>
      {states.map((s, i) => (
        <td key={i} className="border-b border-l border-line px-4 py-2 align-middle">
          {s.status === 'ready' ? cell(s.d) : s.status === 'loading' ? <Bone className="h-4 w-24" /> : <span className="text-ink-2">—</span>}
        </td>
      ))}
    </tr>
  )
}

function Num({ v, sub }: { v: ReactNode; sub?: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-mono text-proof-body text-ink tnum">{v}</span>
      {sub ? <span className="truncate text-[11px] text-ink-2">{sub}</span> : null}
    </span>
  )
}

function RateBlock({ x }: { x: Detail }) {
  const p = x.product
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-baseline gap-2">
        <span className="font-mono text-[18px] leading-none text-ink tnum">{pct(p.rate)}</span>
        <span className="font-mono text-[11px] text-ink-2 tnum">95% {interval(p.rate_lo, p.rate_hi)}</span>
      </span>
      <EvidenceBar rate={p.rate} lo={p.rate_lo} hi={p.rate_hi} base={p.base_rate} n={p.n} />
    </span>
  )
}

function SegCell({ seg }: { seg: Seg | undefined }) {
  if (!seg || seg.suppressed || seg.rate === null) return <span className="text-proof-small text-ink-2">Fewer than {MIN_GROUP} people</span>
  const ci = segInterval(seg)
  return (
    <span className="flex items-baseline gap-2 whitespace-nowrap">
      <span className="font-mono text-ink tnum">{pct(seg.rate)}</span>
      <span className="font-mono text-[11px] text-ink-2 tnum">
        n={int(seg.n)}
        {ci ? ` · ${interval(ci.lo, ci.hi)}` : ''}
      </span>
    </span>
  )
}

/** The skin types in the order the api lists them (the first loaded product's), every id once. */
function skinIds(xs: Detail[]): { id: string; label: string }[] {
  const out = new Map<string, string>()
  for (const x of xs) for (const s of x.segments.skin) if (!out.has(s.id)) out.set(s.id, s.label)
  return [...out].map(([id, label]) => ({ id, label }))
}
