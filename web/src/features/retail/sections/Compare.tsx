import { ArrowLeft, Download, Plus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { ProductImage } from '../../routine/productUi'
import { useRetailData } from '../context'
import { csvMeta } from '../data'
import { useProductDetails, useProducts, type Load } from '../productData'
import { hintOf, leaderOf, MAX_COMPARE, noDataReason, parseIds, segInterval } from '../productModel'
import { sectionPath, useRetailState } from '../state'
import type { Insights, ProductDetail as Detail, ProductRow, Seg } from '../types'
import { Bone, Combobox, CurveChart, downloadCsv, EmptyState, int, interval, LiftValue, PageHeader, Panel, pct, ProofTierChip, pts, Suppressed, ToolButton, useTooltip, weeks, type CsvValue } from '../ui'
import { HeadTip, RateInterval } from './productParts'
import { InsightsGate, YoursTag } from './shared'

/*
 * Compare (/retail/compare?ids=a,b,c): two or three products side by side on GET /v1/retailer/products/{id}.
 * One column per product (image, name, status), the same figures as rows with the leader of each row set
 * semibold, then when the lasting change began (curves overlaid) and where it works by skin type. Reached from
 * the ticked rows on Products; "Products" goes back with the same ticks.
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
    <div aria-hidden className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Bone className="h-4 w-20" />
        <Bone className="h-7 w-32" />
        <Bone className="h-4 w-[520px] max-w-full" />
      </div>
      <Bone className="h-[460px] w-full rounded-card" />
    </div>
  )
}

const LETTERS = ['A', 'B', 'C'] as const
/** Every line is a visible-change share (one hue), told apart by pattern: solid, dashed, dotted. */
const DASH = [undefined, '7 4', '1.5 3.5'] as const

type Ready = Extract<Load<Detail>, { status: 'ready' }>

/** A figure row: its label and definition, the value that picks the leader, and how a cell draws. */
type Figure = {
  id: string
  label: string
  tip: string
  value: (p: ProductRow) => number | null
  better?: 'high' | 'low'
  cell: (p: ProductRow, lead: boolean) => ReactNode
}

function Body({ d }: { d: Insights }) {
  const { filters, workspace } = useRetailData()
  const { param, setParam, carry } = useRetailState()
  const brandView = workspace.kind === 'brand' ? workspace.brand : null
  const wk = d.cohort.weeks
  const ids = parseIds(param('ids'))
  const states = useProductDetails(ids, filters)
  const list = useProducts(filters).state
  const rows = list.status === 'ready' ? list.d.products : []
  const setIds = (next: string[]) => setParam({ ids: next.join(',') || null })
  const xs = states.filter((s): s is Ready => s.status === 'ready').map((s) => s.d)
  const missing = ids.filter((_, i) => states[i]?.status === 'missing' || states[i]?.status === 'failed')
  const loading = states.some((s) => s.status === 'loading')
  const backHref = `${sectionPath('products')}${carry}${ids.length ? `${carry ? '&' : '?'}sel=${ids.map(encodeURIComponent).join(',')}` : ''}`

  const back = (
    <Link to={backHref} className="inline-flex h-6 w-fit items-center gap-1.5 text-proof-small text-ink-2 no-underline hover:text-ink">
      <ArrowLeft size={14} strokeWidth={1.6} aria-hidden /> Products
    </Link>
  )
  const picker = (
    <div className="w-fit rounded-ctl border border-line bg-surface hover:border-line-strong">
      <Combobox
        label="Add product"
        value=""
        prefix={<Plus size={15} strokeWidth={1.6} aria-hidden className="shrink-0 text-ink-2" />}
        emptyText={ids.length >= MAX_COMPARE ? `${MAX_COMPARE} of ${MAX_COMPARE} products` : 'Add product'}
        searchPlaceholder="Search products or brands"
        width={380}
        disabled={ids.length >= MAX_COMPARE || !rows.length}
        options={rows
          .filter((r) => !ids.includes(r.product_id))
          .sort((a, b) => a.category_label.localeCompare(b.category_label) || a.product.localeCompare(b.product))
          .map((r) => ({ value: r.product_id, label: `${r.product} · ${r.brand}`, hint: r.rate === null ? 'No data' : pct(r.rate), group: r.category_label }))}
        onChange={(v) => setIds([...ids, v])}
      />
    </div>
  )

  if (ids.length < 2) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          {back}
          <PageHeader title="Compare" description="Pick two or three products to see their outcomes side by side." />
        </div>
        <EmptyState title={ids.length ? 'Add one more product' : 'Pick two or three products'} body="Tick rows on Products, or search the catalog here." secondary={{ label: 'Go to Products', to: backHref }}>
          <div className="mt-1">{picker}</div>
        </EmptyState>
      </div>
    )
  }

  const exportCsv = () => {
    const metrics: [string, (x: Detail) => CsvValue][] = [
      ['Brand', (x) => x.product.brand],
      ['Category', (x) => x.product.category_label],
      ['Status', (x) => x.product.tier_label ?? x.product.tier],
      [`People at week ${wk} (n)`, (x) => x.product.n],
      [`Visible change by week ${wk} (%)`, (x) => (x.product.rate === null ? (noDataReason(x.product) ?? '') : Math.round(x.product.rate * 100))],
      ['Visible change 95% interval', (x) => interval(x.product.rate_lo, x.product.rate_hi) ?? ''],
      ['Non-users (%)', (x) => (x.product.base_rate === null ? '' : Math.round(x.product.base_rate * 100))],
      ['Lift (pts)', (x) => (x.product.lift === null ? '' : Math.round(x.product.lift * 100))],
      ['Lift 95% interval (pts)', (x) => (x.product.lift_lo === null || x.product.lift_hi === null ? '' : `${Math.round(x.product.lift_lo * 100)} to ${Math.round(x.product.lift_hi * 100)}`)],
      ['Weeks to first change (median)', (x) => x.product.weeks],
      [`Still using at week ${wk} (%)`, (x) => (x.product.cont8 === null ? '' : Math.round(x.product.cont8 * 100))],
      ...skinIds(xs).map((s): [string, (x: Detail) => CsvValue] => [`Visible change, ${s.label} skin (%)`, (x) => cellCsv(x.segments.skin.find((g) => g.id === s.id))]),
    ]
    downloadCsv(
      `willow-proof-compare-${xs.map((x) => x.product.product_id).join('-vs-')}.csv`.slice(0, 180),
      csvMeta(xs[0], 'compare'),
      ['Measure', ...xs.map((x) => x.product.product)],
      metrics.map(([k, f]) => [k, ...xs.map(f)]),
    )
  }

  const answer = (() => {
    if (loading && xs.length < 2) return 'Loading the products…'
    const m = xs.filter((x) => x.product.rate !== null).sort((a, b) => b.product.rate! - a.product.rate!)
    if (m.length < 2) return `At most one of these has 10 or more people at week ${wk}, so there’s no measured comparison yet.`
    const [a, b] = m.map((x) => x.product)
    const clear = a.rate_lo !== null && b.rate_hi !== null && a.rate_lo > b.rate_hi
    return (
      <>
        <strong>{a.product}</strong> leads on visible change, {pct(a.rate)} against {pct(b.rate)}. {clear ? 'The 95% intervals don’t overlap.' : 'The 95% intervals overlap, so the gap may be chance.'}
      </>
    )
  })()

  const none = <span className="text-ink-3">—</span>
  const figures: Figure[] = [
    {
      id: 'rate',
      label: 'Visible change',
      tip: `Share of people using it who saw a real, visible change by week ${wk}. Bar: 95% interval. Tick: non-users with the same goals.`,
      value: (p) => p.rate,
      better: 'high',
      cell: (p, lead) => (p.rate === null ? <span className="text-proof-small text-ink-2">{noDataReason(p)}</span> : <RateInterval rate={p.rate} lo={p.rate_lo} hi={p.rate_hi} base={p.base_rate} n={p.n} weeks={wk} strong={lead} wide />),
    },
    {
      id: 'base',
      label: 'Non-users',
      tip: `Share of people with the same goals who don’t use it and saw a visible change by week ${wk}.`,
      value: (p) => p.base_rate,
      cell: (p) => (p.rate === null ? none : p.base_rate === null ? <Suppressed short /> : <span className="tnum text-ink-2">{pct(p.base_rate)}</span>),
    },
    {
      id: 'lift',
      label: 'Lift',
      tip: 'Visible change among users minus non-users, in percentage points. Hover a value for its 95% interval.',
      value: (p) => p.lift,
      better: 'high',
      cell: (p) => (p.rate === null ? none : <LiftValue lift={p.lift} lo={p.lift_lo} hi={p.lift_hi} />),
    },
    {
      id: 'n',
      label: 'People',
      tip: `People with ${wk} weeks of photos who used it: the n behind the rate.`,
      value: (p) => p.n,
      better: 'high',
      cell: (p) => (p.n === null ? none : <span className="tnum">{int(p.n)}</span>),
    },
    {
      id: 'weeks',
      label: 'Weeks to change',
      tip: 'Median weeks until the lasting change began, among people who changed.',
      value: (p) => p.weeks,
      better: 'low',
      cell: (p) => (p.weeks === null ? none : <span className="tnum">{weeks(p.weeks)}</span>),
    },
    {
      id: 'cont8',
      label: `Still using wk ${wk}`,
      tip: `Share of its users who still had it in their routine at week ${wk}.`,
      value: (p) => p.cont8,
      better: 'high',
      cell: (p) => (p.cont8 === null ? none : <span className="tnum">{pct(p.cont8)}</span>),
    },
  ]
  const valueAt = (i: number, f: (p: ProductRow) => number | null) => {
    const s = states[i]
    return s?.status === 'ready' ? f(s.d.product) : null
  }

  const skins = skinIds(xs)
  const cols = (
    <colgroup>
      <col className="w-[132px] md:w-[200px]" />
      {ids.map((id) => (
        <col key={id} />
      ))}
    </colgroup>
  )
  const ready = ids.map((id, i) => ({ id, i, s: states[i] })).filter((x): x is { id: string; i: number; s: Ready } => x.s?.status === 'ready')

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        {back}
        <PageHeader title="Compare" description={answer} />
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {picker}
          <ToolButton onClick={exportCsv} disabled={!xs.length} label="Export this comparison as CSV">
            <Download size={15} strokeWidth={1.6} aria-hidden /> Export
          </ToolButton>
        </div>

        {missing.length ? (
          <p role="alert" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-line bg-surface px-4 py-3 text-proof-small text-ink-2">
            {missing.length === 1 ? 'One product in this link isn’t in the catalog' : `${missing.length} products in this link aren’t in the catalog`} ({missing.join(', ')}).
            <button type="button" onClick={() => setIds(ids.filter((i) => !missing.includes(i)))} className="border-0 bg-transparent p-0 font-medium text-ink underline underline-offset-4">
              Remove {missing.length === 1 ? 'it' : 'them'}
            </button>
          </p>
        ) : null}

        <section aria-label="Products side by side" className="relative overflow-hidden rounded-card border border-line bg-surface">
          <div className="relative overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[600px] table-fixed border-separate border-spacing-0 text-proof-body">
              <caption className="sr-only">Products compared side by side</caption>
              {cols}
              <thead>
                <tr>
                  <td className="border-b border-line" />
                  {ids.map((id, i) => (
                    <ProductHead key={id} st={states[i]} id={id} carry={carry} own={brandView} onRemove={() => setIds(ids.filter((v) => v !== id))} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {figures.map((f) => {
                  const lead = f.better ? leaderOf(ids.map((_, i) => valueAt(i, f.value)), f.better) : null
                  return (
                    <tr key={f.id}>
                      <th scope="row" className="h-14 border-b border-line px-5 text-left align-middle text-proof-small font-normal text-ink-2 [tr:last-child>&]:border-b-0">
                        <HeadTip label={f.label} tip={f.tip} />
                      </th>
                      {ids.map((id, i) => {
                        const s = states[i]
                        return (
                          <td key={id} className={`h-14 border-b border-l border-line px-5 align-middle text-ink [tr:last-child>&]:border-b-0 ${lead === i ? 'font-semibold' : ''}`}>
                            {s?.status === 'ready' ? f.cell(s.d.product, lead === i) : s?.status === 'loading' ? <Bone className="h-4 w-24" /> : none}
                            {lead === i ? <span className="sr-only"> (leads this row)</span> : null}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {ready.length >= 2 ? (
        <Panel title="When the change began" id="cmp-curve" description={`Share of each product’s users whose lasting visible change had begun, by week ${wk}.`}>
          <div className="flex flex-col gap-4">
            {/* Clips the chart's first paint (drawn at a default width until it measures its box) on phones. */}
            <div className="relative min-w-0 overflow-hidden">
              <CurveChart
                title="Share of users whose lasting visible change had begun, by week, per product"
                weeks={ready[0].s.d.curve.weeks}
                height={240}
                series={ready.map(({ id, i, s }) => ({ id, label: LETTERS[i], values: s.d.curve.users, tone: 'signal' as const, n: s.d.product.n, dash: DASH[i] }))}
              />
            </div>
            <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0">
              {ready.map(({ id, i, s }) => (
                <li key={id} className="flex min-w-0 max-w-full items-center gap-2 text-proof-small text-ink-2">
                  <Swatch i={i} />
                  <span className="font-medium text-ink">{LETTERS[i]}</span>
                  <span className="truncate" title={s.d.product.product}>
                    {s.d.product.product}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      ) : null}

      {skins.length ? (
        <Panel flush title="Where it works" id="cmp-skin" description={`Visible change by week ${wk}, by skin type.`}>
          <div className="relative overflow-x-auto overscroll-x-contain border-t border-line">
            <table className="w-full min-w-[600px] table-fixed border-separate border-spacing-0 text-proof-body">
              <caption className="sr-only">Visible change by skin type, per product</caption>
              {cols}
              <thead>
                <tr>
                  <th scope="col" className="h-10 border-b border-line bg-pf-bg2 px-5 text-left text-proof-small font-medium text-ink-2">
                    Skin type
                  </th>
                  {ids.map((id, i) => {
                    const s = states[i]
                    return (
                      <th key={id} scope="col" className="h-10 border-b border-l border-line bg-pf-bg2 px-5 text-left text-proof-small font-medium text-ink-2">
                        <span className="block truncate">{s?.status === 'ready' ? s.d.product.product : LETTERS[i]}</span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {skins.map((sk) => {
                  const segs = ids.map((_, i) => {
                    const s = states[i]
                    return s?.status === 'ready' ? s.d.segments.skin.find((g) => g.id === sk.id) : undefined
                  })
                  const lead = leaderOf(segs.map((g) => (g && !g.suppressed ? g.rate : null)))
                  return (
                    <tr key={sk.id}>
                      <th scope="row" className="h-12 border-b border-line px-5 text-left align-middle font-normal text-ink [tr:last-child>&]:border-b-0">
                        {sk.label}
                      </th>
                      {segs.map((g, i) => (
                        <td key={ids[i]} className={`h-12 border-b border-l border-line px-5 align-middle [tr:last-child>&]:border-b-0 ${lead === i ? 'font-semibold' : ''}`}>
                          <SegRate seg={g} />
                          {lead === i ? <span className="sr-only"> (leads this row)</span> : null}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

/** A product's column head: image, name (to its page), brand, status; × removes it from the comparison. */
function ProductHead({ st, id, carry, own, onRemove }: { st: Load<Detail> | undefined; id: string; carry: string; own: string | null; onRemove: () => void }) {
  const p = st?.status === 'ready' ? st.d.product : null
  return (
    <th scope="col" className="border-b border-l border-line px-5 pb-5 pt-4 text-left align-top font-normal">
      {p ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <ProductImage product={{ image_url: p.image_url, category: p.category, name: p.product }} size={48} decorative />
            <button type="button" onClick={onRemove} aria-label={`Remove ${p.product} from the comparison`} className="hit44 -mr-2 grid size-7 place-items-center rounded-ctl border-0 bg-transparent text-ink-2 hover:bg-pf-hover hover:text-ink">
              <X size={15} strokeWidth={1.6} aria-hidden />
            </button>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link to={`${sectionPath('products', id)}${carry}`} title={p.product} className="line-clamp-2 text-proof-body font-medium text-ink no-underline hover:underline">
              {p.product}
            </Link>
            <span className="flex min-w-0 items-center text-proof-small text-ink-2">
              <span className="truncate">{p.brand}</span>
              {own === p.brand ? <YoursTag /> : null}
            </span>
          </div>
          <span>
            <ProofTierChip tier={p.tier} size="sm" hint={hintOf(p)} />
          </span>
        </div>
      ) : st?.status === 'loading' || !st ? (
        <div className="flex flex-col gap-3">
          <Bone className="size-12 rounded-full" />
          <Bone className="h-4 w-4/5" />
          <Bone className="h-5 w-20" />
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <span className="text-proof-small text-ink-2">Not in the catalog</span>
          <button type="button" onClick={onRemove} aria-label={`Remove ${id} from the comparison`} className="hit44 -mr-2 grid size-7 place-items-center rounded-ctl border-0 bg-transparent text-ink-2 hover:bg-pf-hover hover:text-ink">
            <X size={15} strokeWidth={1.6} aria-hidden />
          </button>
        </div>
      )}
    </th>
  )
}

/** The line pattern of product i, as a legend key. */
function Swatch({ i }: { i: number }) {
  return (
    <svg width="24" height="8" aria-hidden className="shrink-0">
      <line x1="1" x2="23" y1="4" y2="4" stroke="var(--signal-change)" strokeWidth="2" strokeDasharray={DASH[i]} strokeLinecap="round" />
    </svg>
  )
}

/** A skin-type cell: the rate, with n and the 95% interval on hover or focus; suppressed groups say so. */
function SegRate({ seg }: { seg: Seg | undefined }) {
  const ci = seg ? segInterval(seg) : null
  const ok = seg && !seg.suppressed && seg.rate !== null
  const tip = useTooltip(ok ? `${pct(seg.rate)} of ${int(seg.n)} people${ci ? ` · 95% interval ${interval(ci.lo, ci.hi)}` : ''}${seg.base_rate !== null ? ` · non-users ${pct(seg.base_rate)} (${pts(seg.rate! - seg.base_rate)})` : ''}` : '')
  if (!ok) return <Suppressed short />
  return (
    <>
      <span {...tip.trigger} tabIndex={0} className="cursor-help tnum text-ink">
        {pct(seg.rate)}
      </span>
      {tip.node}
    </>
  )
}

const cellCsv = (s: Seg | undefined): CsvValue => (!s || s.suppressed || s.rate === null ? 'suppressed' : Math.round(s.rate * 100))

/** The skin types in the order the api lists them (the first loaded product's), every id once. */
function skinIds(xs: Detail[]): { id: string; label: string }[] {
  const out = new Map<string, string>()
  for (const x of xs) for (const s of x.segments.skin) if (!out.has(s.id)) out.set(s.id, s.label)
  return [...out].map(([id, label]) => ({ id, label }))
}
