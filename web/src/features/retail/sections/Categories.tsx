import { useNavigate, useParams } from 'react-router-dom'

import { useRetailData } from '../context'
import { csvMeta, csvName, type Category, type Flow, type Insights } from '../data'
import { sectionPath, useRetailState } from '../state'
import { CurveChart, DataTable, EmptyState, EvidenceBar, int, MIN_GROUP, Panel, pct, pts, SectionHeader, SimBadge, SkeletonHeader, SkeletonPanel, Tabs, Term, weeks, type Column } from '../ui'
import { InsightsGate, useWorkspaceLabel, YoursTag } from './shared'

/*
 * Categories (/retail/categories/:category?goal=): per product group and goal, how many users reach a real
 * change by week 2, 4 and 8 and how many keep using the category's products (the existing category flows),
 * against non-users with the same goal; and each brand's real-change rate in the category with its interval.
 * TODO(slice D): brand share of routines vs share of outcomes, price-tier gaps per category.
 */
export default function Categories() {
  return (
    <InsightsGate
      skeleton={
        <div className="flex flex-col gap-4">
          <SkeletonHeader />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <SkeletonPanel height={240} className="xl:col-span-7" />
            <SkeletonPanel height={240} className="xl:col-span-5" />
          </div>
        </div>
      }
    >
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function Body({ d }: { d: Insights }) {
  const { category: catParam } = useParams()
  const navigate = useNavigate()
  const { param, setParam, carry } = useRetailState()
  const { workspace } = useRetailData()
  const eyebrow = useWorkspaceLabel()
  const brandView = workspace.kind === 'brand' ? workspace.brand : null
  const cats = (d.categories ?? []).filter((c) => c.flows.length)
  const cat = cats.find((c) => c.category === catParam) ?? cats.find((c) => c.category === 'serum') ?? cats[0]
  const flow = cat ? (cat.flows.find((f) => f.goal_id === param('goal')) ?? [...cat.flows].sort((a, b) => b.n - a.n)[0]) : undefined

  if (!cat || !flow) {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader eyebrow={eyebrow} title="Categories" />
        <EmptyState title="No category has enough people yet" body={`No category has ${MIN_GROUP} or more users for one goal at week ${d.cohort.weeks} in this filter.`} />
      </div>
    )
  }
  const pick = (c: string) => navigate(`${sectionPath('categories', c)}${carry}`)
  const last = flow.changed.length - 1
  const lift = flow.base ? flow.rate - flow.base.rate : null
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow={eyebrow}
        title="Categories"
        answer={
          <>
            {cat.label} for <strong>{flow.goal.toLowerCase()}</strong>: <strong>{pct(flow.rate)}</strong> of {int(flow.n)} users had a <Term id="real_change">real change</Term> by week {d.cohort.weeks}
            {flow.base ? (
              <>
                , against {pct(flow.base.rate)} of {int(flow.base.n)} <Term id="base_rate">non-users</Term> with the goal
              </>
            ) : null}
            . {pct(flow.using[flow.using.length - 1] / flow.n)} still use {cat.label.toLowerCase()} for it at week {flow.weeks[flow.weeks.length - 1]}.
          </>
        }
      />
      <Tabs label="Category" tabs={cats.map((c) => ({ id: c.category, label: c.label }))} value={cat.category} onChange={pick} panelId="category-panel" />
      <div id="category-panel" role="tabpanel" className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel
            title={`${cat.label} · ${flow.goal} goal`}
            id="flow-h"
            meta={<SimBadge cohort={d.cohort} />}
            className="xl:col-span-7"
            footnote={`${cat.label} users with the ${flow.goal.toLowerCase()} goal at week ${d.cohort.weeks} (n=${flow.n}). Ember: share whose real change (held to week ${d.cohort.weeks}) had begun by that week. Dashed: share still using a ${cat.label.toLowerCase()} product for the goal.`}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Goal">
                {[...cat.flows]
                  .sort((a, b) => b.n - a.n)
                  .map((f) => (
                    <button
                      key={f.goal_id}
                      type="button"
                      aria-pressed={f.goal_id === flow.goal_id}
                      onClick={() => setParam({ goal: f.goal_id })}
                      className={`inline-flex h-7 items-center gap-1.5 rounded-pill border px-2.5 text-proof-small ${f.goal_id === flow.goal_id ? 'border-transparent bg-selected text-inverse' : 'border-line-strong text-ink hover:bg-glass'}`}
                    >
                      {f.goal}
                      <span className={`font-mono text-[11px] ${f.goal_id === flow.goal_id ? 'text-inverse/70' : 'text-ink-2'}`}>{f.n}</span>
                    </button>
                  ))}
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_200px]">
                <CurveChart
                  title={`${cat.label}, ${flow.goal}: share with a real change begun and share still using, by week`}
                  weeks={flow.weeks}
                  height={210}
                  series={[
                    { id: 'changed', label: 'Real change', values: flow.changed.map((k) => k / flow.n), tone: 'signal', n: flow.n },
                    { id: 'using', label: 'Still using', values: flow.using.map((k) => k / flow.n), tone: 'muted' },
                  ]}
                />
                <dl className="m-0 grid grid-cols-2 content-start gap-x-4 gap-y-3 lg:grid-cols-1">
                  <Stat k={`Real change by wk ${d.cohort.weeks}`} v={pct(flow.rate)} n={`${int(flow.changed[last])} of ${int(flow.n)} users`} />
                  <Stat k="Non-users, same goal" v={flow.base ? pct(flow.base.rate) : '—'} n={flow.base ? `${int(flow.base.k)} of ${int(flow.base.n)} · lift ${pts(lift)}` : `Fewer than ${MIN_GROUP} people`} />
                  <Stat k="Median time to change" v={weeks(flow.median_weeks)} n={flow.median_weeks === null ? `Fewer than ${MIN_GROUP} changed` : 'among those who changed'} />
                </dl>
              </div>
            </div>
          </Panel>
          <BrandsPanel cat={cat} d={d} brandView={brandView} className="xl:col-span-5" />
        </div>
        <GoalsTable cat={cat} d={d} selected={flow.goal_id} onPick={(g) => setParam({ goal: g })} />
      </div>
    </div>
  )
}

function Stat({ k, v, n }: { k: string; v: string; n: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-proof-small text-ink-2">{k}</dt>
      <dd className="m-0 flex flex-col">
        <span className="font-mono text-[22px] leading-tight text-ink tnum">{v}</span>
        <span className="text-[11px] text-ink-2">{n}</span>
      </dd>
    </div>
  )
}

function BrandsPanel({ cat, d, brandView, className }: { cat: Category; d: Insights; brandView: string | null; className?: string }) {
  const brands = [...cat.brands].sort((a, b) => b.rate - a.rate)
  const max = Math.min(1, Math.max(0.2, ...brands.map((b) => b.hi)) + 0.05)
  return (
    <Panel
      title={`Brands in ${cat.label.toLowerCase()}`}
      id="brands-h"
      meta={<SimBadge cohort={d.cohort} />}
      className={className}
      footnote={
        <>
          Real-change rate by week {d.cohort.weeks} for each brand’s users in this category, with its <Term id="interval">95% interval</Term>. Overlapping intervals: no clear difference.
        </>
      }
      flush
    >
      {brands.length === 0 && !cat.brands_hidden ? (
        <div className="px-4">
          <EmptyState compact title="No brand has enough people" body={`No brand in this category has ${MIN_GROUP} or more people.`} />
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {brands.map((b) => (
            <li key={b.brand} className={`grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_44px] items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 ${brandView === b.brand ? 'bg-proof-leaf-soft' : ''}`}>
              <span className="truncate text-proof-body text-ink" title={b.brand}>
                {b.brand}
                {brandView === b.brand ? <YoursTag /> : null}
              </span>
              <EvidenceBar rate={b.rate} lo={b.lo} hi={b.hi} n={b.n} max={max} />
              <span className="text-right font-mono text-proof-body tnum">{pct(b.rate)}</span>
            </li>
          ))}
          {cat.brands_hidden ? (
            <li className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] items-center gap-3 px-4 py-2 text-proof-small text-ink-2">
              <span>
                {cat.brands_hidden} more {cat.brands_hidden === 1 ? 'brand' : 'brands'}
              </span>
              <EvidenceBar rate={null} />
            </li>
          ) : null}
        </ul>
      )}
    </Panel>
  )
}

function GoalsTable({ cat, d, selected, onPick }: { cat: Category; d: Insights; selected: string; onPick: (goal: string) => void }) {
  const wk = cat.flows[0]?.weeks ?? [2, 4, 8]
  const columns: Column<Flow>[] = [
    { id: 'goal', header: 'Goal', rowHeader: true, sortValue: (f) => f.goal, cell: (f) => <span className="block truncate text-ink">{f.goal}</span> },
    { id: 'n', header: 'Users', align: 'right', width: '84px', sortValue: (f) => f.n, cell: (f) => <span className="font-mono tnum">{int(f.n)}</span> },
    ...wk.map<Column<Flow>>((w, i) => ({
      id: `changed${w}`,
      header: `Wk ${w} change`,
      headerText: `Real change by week ${w} (people)`,
      align: 'right',
      width: '120px',
      sortValue: (f) => f.changed[i] / f.n,
      cell: (f) => (
        <span className="font-mono tnum">
          {pct(f.changed[i] / f.n)} <span className="text-[11px] text-ink-2">{f.changed[i]}</span>
        </span>
      ),
      csv: (f) => f.changed[i],
    })),
    { id: 'using', header: `Using wk ${wk[wk.length - 1]}`, headerText: `Still using at week ${wk[wk.length - 1]} (people)`, align: 'right', width: '112px', sortValue: (f) => f.using[f.using.length - 1] / f.n, cell: (f) => <span className="font-mono tnum">{pct(f.using[f.using.length - 1] / f.n)}</span>, csv: (f) => f.using[f.using.length - 1] },
    { id: 'base', header: 'Non-users', align: 'right', width: '128px', sortValue: (f) => f.base?.rate ?? null, cell: (f) => (f.base ? <span className="font-mono tnum text-ink-2">{pct(f.base.rate)} <span className="text-[11px]">n={f.base.n}</span></span> : <span className="text-proof-small text-ink-2">n&lt;{MIN_GROUP}</span>), csv: (f) => (f.base ? `${f.base.k}/${f.base.n}` : 'suppressed') },
    { id: 'median', header: 'Median', headerText: 'Median weeks to change', align: 'right', width: '96px', sortValue: (f) => f.median_weeks, firstDir: 'asc', cell: (f) => <span className="font-mono tnum">{weeks(f.median_weeks)}</span>, csv: (f) => f.median_weeks ?? 'suppressed' },
  ]
  return (
    <Panel flush>
      <DataTable
        heading={
          <>
            <h2 className="m-0 text-proof-h font-medium text-ink">Every goal in {cat.label.toLowerCase()}</h2>
            <SimBadge cohort={d.cohort} />
          </>
        }
        caption={`${cat.label}: users, real change by week and continuation per goal`}
        columns={columns}
        rows={cat.flows}
        rowKey={(f) => f.goal_id}
        onRowClick={(f) => onPick(f.goal_id)}
        rowLabel={(f) => `Show ${f.goal}`}
        selectedKey={selected}
        defaultSort={{ id: 'n', dir: 'desc' }}
        csv={{ name: csvName(`category-${cat.category}`, d), meta: csvMeta(d, cat.label) }}
        minWidth={880}
      />
    </Panel>
  )
}
