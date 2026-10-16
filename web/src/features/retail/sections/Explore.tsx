import { Download, Link2 } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { GOALS } from '../../../lib/metrics'
import { useRetailData } from '../context'
import { csvMeta, csvName, TIER_LABEL } from '../data'
import { fetchProducts } from '../productData'
import { sectionPath, useRetailState } from '../state'
import type { Products, ProofTier } from '../types'
import { Bone, Button, DataTable, downloadCsv, EmptyState, ErrorState, int, interval, PageHeader, Panel, pct, pts, SkeletonHeader, SkeletonPanel, TIERS, weeks, type Column, type CsvValue } from '../ui'
import { useView } from '../useView'
import { BarChart, type BarFormat } from './explore/BarChart'
import type { Option } from './explore/MultiSelect'
import { aggregate, brandKey, DEFAULT_QUERY, FILTERS, filterCount, groupOf, measureOf, parseQuery, PRESETS, queryParams, sameQuery, type FilterId, type Group, type Labels, type MeasureKind, type Query } from './explore/query'
import { QueryPanel } from './explore/QueryPanel'
import { YoursTag } from './shared'

/*
 * Explore (/retail/explore): build your own view of the product outcomes (GET /v1/retailer/products), after
 * Vercel Observability's query view: chart and table on the left, the query (Measure, Group by, Filters,
 * Minimum people, Sort, Limit) on the right. The whole query lives in the URL, so every view is a link.
 * Grouping and weighting are in explore/query.ts.
 */

const STATUS_ORDER: ProofTier[] = ['proven', 'promising', 'unclear', 'too_few']
const LABELS: Labels = {
  goal: Object.fromEntries(GOALS.map((g) => [g.id, g.label])),
  status: Object.fromEntries(STATUS_ORDER.map((t) => [t, TIERS[t].label])),
  price: TIER_LABEL,
}

const FORMATS: Record<MeasureKind, BarFormat> = {
  rate: { value: pct, tick: (v) => `${Math.round(v * 100)}%` },
  points: { value: pts, tick: (v) => (v === 0 ? '0' : pts(v).replace(' pts', '')) },
  count: { value: int, tick: (v) => int(v) },
  weeks: { value: weeks, tick: (v) => `${v}` },
}

/** A CSV cell for a measure: whole percents and points, counts, weeks to one decimal. */
const csvValue = (kind: MeasureKind, v: number | null): CsvValue => (v === null ? '' : kind === 'rate' || kind === 'points' ? Math.round(v * 100) : kind === 'weeks' ? Math.round(v * 10) / 10 : v)

export default function Explore() {
  const { filters } = useRetailData()
  const view = useView<Products>(`products|${filters.cohort}|${filters.range}`, () => fetchProducts(filters))
  return (
    <div className="flex flex-col gap-8">
      {view.status === 'ready' ? <Body d={view.data} /> : view.status === 'failed' ? <Failed retry={view.retry} /> : <ExploreSkeleton />}
    </div>
  )
}

function Failed({ retry }: { retry: () => void }) {
  return (
    <>
      <PageHeader title="Explore" />
      <ErrorState title="The products couldn’t load" body="The warehouse didn’t respond. No partial numbers are shown." onRetry={retry} />
    </>
  )
}

function ExploreSkeleton() {
  return (
    <div role="status" aria-label="Loading products" aria-busy="true" className="flex flex-col gap-8">
      <SkeletonHeader />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-4">
          <Bone className="h-8 w-full max-w-[640px]" />
          <SkeletonPanel height={380} />
        </div>
        <SkeletonPanel height={520} className="max-lg:hidden" />
      </div>
    </div>
  )
}

function Body({ d }: { d: Products }) {
  const { workspace } = useRetailData()
  const { params, setParam, carry } = useRetailState()
  const navigate = useNavigate()
  const q = useMemo(() => parseQuery((k) => params.get(k)), [params])
  const setQuery = (next: Query) => setParam(queryParams(next))
  const own = workspace.kind === 'brand' ? workspace.brand : null
  const measure = measureOf(q.measure)
  const group = groupOf(q.group)
  const fmt = FORMATS[measure.kind]

  const { groups, total } = useMemo(() => aggregate(d.products, q, { labels: LABELS, ownBrand: own }), [d.products, q, own])
  const options = useMemo(() => filterOptions(d.products), [d.products])
  const hrefOf = (g: Group) => (g.productId ? `${sectionPath('products', g.productId)}${carry}` : null)
  const title = `${measure.label} by ${group.label.toLowerCase()}`
  const single = q.group === 'product'

  const exportCsv = () => {
    const scope = FILTERS.filter((f) => q.filters[f.id].length).map((f) => `${f.label}: ${q.filters[f.id].map((v) => options[f.id].find((o) => o.value === v)?.label ?? v).join(' / ')}`)
    const unit = measure.kind === 'rate' ? ' (%)' : measure.kind === 'points' ? ' (pts)' : ''
    const header = [group.label, `${measure.label}${unit}`, ...(single && (q.measure === 'rate' || q.measure === 'lift') ? ['95% low', '95% high'] : []), ...(q.measure === 'rate' ? ['Non-users (%)'] : []), 'People (n)', 'Products']
    const rows = groups.map((g) => [g.label, csvValue(measure.kind, g.value), ...(single && (q.measure === 'rate' || q.measure === 'lift') ? [csvValue(measure.kind, g.lo), csvValue(measure.kind, g.hi)] : []), ...(q.measure === 'rate' ? [csvValue('rate', g.base)] : []), g.n, g.products])
    const note = [`Explore: ${title}`, ...scope, `products with ${q.min}+ people`, single ? '' : q.measure === 'n' ? 'groups sum their products' : 'groups are people-weighted averages of their products'].filter(Boolean).join('; ')
    downloadCsv(csvName(`explore-${q.measure}-by-${q.group}`, d), csvMeta(d, note), header, rows)
  }

  const tipOf = (g: Group) => (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium">{g.label}</span>
      <span className="tnum">
        {measure.label}: {fmt.value(g.value)}
      </span>
      {interval(g.lo, g.hi) ? <span className="tnum">95% interval {measure.kind === 'points' ? `${pts(g.lo)} to ${pts(g.hi)}` : interval(g.lo, g.hi)}</span> : null}
      {g.base !== null ? <span className="tnum">Non-users with the same goal: {pct(g.base)}</span> : null}
      <span className="tnum">
        n = {int(g.n)}
        {single ? '' : ` across ${g.products} ${g.products === 1 ? 'product' : 'products'}`}
      </span>
    </span>
  )

  const columns: Column<Group>[] = [
    {
      id: 'group',
      header: group.label,
      rowHeader: true,
      cell: (g) => (
        <span className="flex min-w-0 items-center">
          <span className="truncate">{g.label}</span>
          {g.own ? <YoursTag /> : null}
        </span>
      ),
    },
    { id: 'value', header: measure.label, align: 'right', width: '22%', cell: (g) => <span className="font-medium tnum">{fmt.value(g.value)}</span> },
    { id: 'n', header: 'People (n)', align: 'right', width: '16%', cell: (g) => <span className="tnum">{int(g.n)}</span> },
    ...(single ? [] : [{ id: 'products', header: 'Products', align: 'right', width: '14%', cell: (g: Group) => <span className="tnum">{int(g.products)}</span> } satisfies Column<Group>]),
  ]

  const nothing = groups.length === 0
  const description = single ? undefined : q.measure === 'n' ? 'Groups: people summed across their products.' : 'Groups: people-weighted average of their products.'
  const legend = (
    <Legend
      own={groups.some((g) => g.own) ? (q.group === 'brand' ? own! : `${own} products`) : null}
      base={groups.some((g) => g.base !== null)}
      whisker={groups.some((g) => g.lo !== null)}
    />
  )

  return (
    <>
      <PageHeader
        title="Explore"
        description="Pick a measure, group it and filter it. Every view is a link you can share."
        actions={
          <>
            <Button onClick={copyLink}>
              <Link2 size={15} strokeWidth={1.7} aria-hidden />
              Copy link
            </Button>
            <Button onClick={exportCsv} disabled={nothing}>
              <Download size={15} strokeWidth={1.7} aria-hidden />
              Export
            </Button>
          </>
        }
      />
      <div className="grid items-start gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_auto_1fr]">
        <div role="group" aria-label="Presets" className="no-scrollbar -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0 lg:col-start-1 lg:row-start-1">
          {PRESETS.map((p) => {
            const on = sameQuery(q, p.query)
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => setQuery(p.query)}
                className={`hit44 inline-flex h-8 items-center whitespace-nowrap rounded-pill border px-3 text-proof-small transition-colors duration-150 ${on ? 'border-ink bg-surface text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink'}`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        <div className="lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-stretch">
          <QueryPanel q={q} onChange={setQuery} options={options} />
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-2">
          {nothing ? (
            <EmptyState
              title="Nothing matches this query"
              body={`No product with ${q.min}+ people matches ${filterCount(q) ? 'these filters' : 'this minimum'}.`}
              action={{ label: 'Reset filters', onClick: () => setQuery({ ...q, filters: DEFAULT_QUERY.filters, min: DEFAULT_QUERY.min }) }}
            />
          ) : (
            <>
              <Panel
                title={title}
                id="explore-chart"
                meta={
                  <span className="text-proof-small text-ink-2 tnum">
                    {groups.length < total ? `${groups.length} of ${total} ${group.plural}` : `${total} ${total === 1 ? group.label.toLowerCase() : group.plural}`}
                  </span>
                }
                description={description}
              >
                <BarChart groups={groups} fmt={fmt} caption={`${title}, ${q.dir === 'desc' ? 'highest' : 'lowest'} first`} hrefOf={hrefOf} tipOf={tipOf} legend={legend} />
              </Panel>
              <Panel flush>
                <DataTable
                  caption={title}
                  columns={columns}
                  rows={groups}
                  rowKey={(g) => g.key}
                  onRowClick={single ? (g) => navigate(hrefOf(g)!) : undefined}
                  rowLabel={single ? (g) => `Open ${g.label}` : undefined}
                  minWidth={480}
                  rowClassName={(g) => (g.own ? 'shadow-[inset_2px_0_0_var(--proof-leaf)]' : '')}
                />
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Legend({ own, base, whisker }: { own: string | null; base: boolean; whisker: boolean }) {
  if (!own && !base && !whisker) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-proof-label text-ink-2">
      {own ? (
        <>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-proof-leaf" />
            {own}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-[var(--pf-base)]" />
            Others
          </span>
        </>
      ) : null}
      {base ? (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-0.5 rounded-full bg-ink-2" />
          Non-users with the same goal
        </span>
      ) : null}
      {whisker ? (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-px w-3 bg-ink-2" />
          95% interval
        </span>
      ) : null}
    </div>
  )
}

/** The filter choices, from every product in the response (with how many products each covers). */
function filterOptions(rows: Products['products']): Record<FilterId, Option[]> {
  const count = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())
  const hint = (n: number | undefined) => (n ? String(n) : undefined)
  const brands = count(rows.map((r) => r.brand))
  const cats = new Map(rows.map((r) => [r.category, r.category_label]))
  const catN = count(rows.map((r) => r.category))
  const goalN = count(rows.flatMap((r) => r.goal_ids))
  const statusN = count(rows.map((r) => r.tier))
  return {
    brand: [...brands.keys()].sort((a, b) => a.localeCompare(b)).map((b) => ({ value: brandKey(b), label: b, hint: hint(brands.get(b)) })),
    category: [...cats].sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => ({ value: id, label, hint: hint(catN.get(id)) })),
    goal: GOALS.filter((g) => goalN.has(g.id)).map((g) => ({ value: g.id, label: g.label, hint: hint(goalN.get(g.id)) })),
    status: STATUS_ORDER.filter((t) => statusN.has(t)).map((t) => ({ value: t, label: TIERS[t].label, hint: hint(statusN.get(t)) })),
  }
}

/** Copy this view's address; falls back to a hidden text field where the Clipboard API is blocked. */
async function copyLink() {
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    toast('Link copied')
    return
  } catch {
    /* try the fallback */
  }
  const ta = document.createElement('textarea')
  ta.value = url
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  toast(ok ? 'Link copied' : 'Copy is blocked in this browser. Copy the address bar instead.')
}
