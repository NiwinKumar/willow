import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { ProductImage } from '../../../components/willow/ProductImage'
import { retailerBrand, retailerBrands } from '../../../lib/api'
import { useRetailData } from '../context'
import { csvMeta, csvName } from '../data'
import { sectionPath, useRetailState } from '../state'
import type { BrandDetail, BrandSummary, Insights, ProductRow } from '../types'
import {
  DataTable,
  EmptyState,
  ErrorState,
  EvidenceBar,
  int,
  interval,
  LiftValue,
  MIN_GROUP,
  Panel,
  pct,
  PositioningChart,
  ProofTierChip,
  SectionHeader,
  Select,
  SimBadge,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonTable,
  slugOf,
  Suppressed,
  Term,
  ToolButton,
  type Column,
} from '../ui'
import { brandLeaders, brandRank, switchRows } from '../ui/insight'
import { useView } from '../useView'
import { InsightsGate, useWorkspaceLabel, YoursTag } from './shared'

/*
 * Competitors (/retail/competitors) on GET /v1/retailer/brands and /brands/{brand}. Retailer workspace: the
 * brand league (rate with 95% interval, continuation, share of routines) and positioning; `?brand=<slug>`
 * opens one brand against the market. Brand workspace (?as=brand:<slug>): that brand, always. `?goal=` (from
 * a brief card) highlights a goal row. Every comparison carries the api's `note`.
 */

const NOTE = 'Observational comparison under the same method; differences inside the confidence intervals are not meaningful.'

export default function Competitors() {
  return (
    <InsightsGate skeleton={<Skeleton />}>
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      <SkeletonHeader />
      <div className="grid grid-cols-1 gap-4 min-[1360px]:grid-cols-12">
        <div className="min-[1360px]:col-span-7">
          <SkeletonTable rows={10} toolbar={false} />
        </div>
        <SkeletonPanel height={320} className="min-[1360px]:col-span-5" />
      </div>
    </div>
  )
}

function Body({ d }: { d: Insights }) {
  const { filters, workspace } = useRetailData()
  const { param } = useRetailState()
  const list = useView(`brands|${filters.cohort}|${filters.range}`, () => retailerBrands(filters))
  const slug = workspace.kind === 'brand' ? workspace.slug : param('brand')
  if (list.status === 'loading')
    return (
      <div role="status" aria-label="Loading brands" aria-busy="true">
        <Skeleton />
      </div>
    )
  if (list.status === 'failed') return <ErrorState title="Brand comparisons couldn’t load" body="The brand aggregates didn’t answer. No partial numbers are shown." onRetry={list.retry} />
  const brands = list.data.brands
  const note = list.data.note ?? NOTE
  const chosen = slug ? (brands.find((b) => slugOf(b.brand) === slug) ?? null) : null
  if (slug && !chosen) return <UnknownBrand slug={slug} />
  return chosen ? <BrandView key={chosen.brand} brand={chosen.brand} brands={brands} d={d} /> : <League brands={brands} d={d} note={note} />
}

function UnknownBrand({ slug }: { slug: string }) {
  const { workspace } = useRetailData()
  const { setParam, setWorkspace } = useRetailState()
  const eyebrow = useWorkspaceLabel()
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader eyebrow={eyebrow} title="Competitors" />
      <EmptyState
        title="No brand by that name"
        body={`“${slug}” isn’t one of the catalogue brands. Pick a brand from the league, or switch “Viewing as” back to the retailer.`}
        action={workspace.kind === 'brand' ? { label: 'View as retailer', onClick: () => setWorkspace({ kind: 'retailer' }) } : { label: 'All brands', onClick: () => setParam({ brand: null }) }}
      />
    </div>
  )
}

/* ───────────────────────────── retailer: the league ───────────────────────────── */

function League({ brands, d, note }: { brands: BrandSummary[]; d: Insights; note: string }) {
  const eyebrow = useWorkspaceLabel()
  const { param, setParam } = useRetailState()
  const { leader, tied, measured } = brandLeaders(brands)
  const last = measured[measured.length - 1]
  const select = (brand: string) => setParam({ brand: slugOf(brand), goal: null }, { push: true })
  const sortParam = param('sort')
  const sort = (() => {
    const [id, dir] = (sortParam ?? '').split('.')
    return ['brand', 'products', 'users', 'rate', 'cont8', 'share'].includes(id) && (dir === 'asc' || dir === 'desc') ? { id, dir: dir as 'asc' | 'desc' } : null
  })()

  const columns: Column<BrandSummary>[] = [
    {
      id: 'brand',
      header: 'Brand',
      rowHeader: true,
      width: '20%',
      sortValue: (r) => r.brand,
      cell: (r) => (
        <span className="block truncate text-ink" title={r.brand}>
          {r.brand}
        </span>
      ),
    },
    { id: 'products', header: 'Products', headerText: 'Catalogue products', align: 'right', width: '78px', sortValue: (r) => r.products, cell: (r) => <span className="font-mono tnum text-ink-2">{r.products}</span> },
    { id: 'users', header: 'People', headerText: 'People using any of its products', align: 'right', width: '76px', sortValue: (r) => r.users, cell: (r) => (r.users === null ? <Suppressed short /> : <span className="font-mono tnum">{int(r.users)}</span>), csv: (r) => r.users ?? 'suppressed' },
    {
      id: 'rate',
      header: <Term id="real_change">Real change</Term>,
      headerText: 'Real change (%)',
      sortValue: (r) => r.rate,
      firstDir: 'desc',
      cell: (r) =>
        r.rate === null ? (
          <Suppressed />
        ) : (
          <span className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-right font-mono tnum">{pct(r.rate)}</span>
            <EvidenceBar rate={r.rate} lo={r.lo} hi={r.hi} n={r.n} className="min-w-0 flex-1" />
          </span>
        ),
      csv: (r) => (r.rate === null ? 'suppressed' : Math.round(r.rate * 100)),
    },
    { id: 'cont8', header: <Term id="continuation">Still using</Term>, headerText: 'Still using at week 8 (%)', align: 'right', width: '92px', sortValue: (r) => r.cont8, cell: (r) => (r.cont8 === null ? <Suppressed short /> : <span className="font-mono tnum">{pct(r.cont8)}</span>), csv: (r) => (r.cont8 === null ? 'suppressed' : Math.round(r.cont8 * 100)) },
    {
      id: 'share',
      header: <Term id="routine_share">Routines</Term>,
      headerText: 'Share of routines (%)',
      align: 'right',
      width: '84px',
      sortValue: (r) => r.routine_share,
      cell: (r) => (r.routine_share === null ? <Suppressed short /> : <span className="font-mono tnum">{pct(r.routine_share)}</span>),
      csv: (r) => (r.routine_share === null ? 'suppressed' : Math.round(r.routine_share * 100)),
    },
  ]

  const answer = leader ? (
    <>
      <strong>{leader.brand}</strong> leads on measured outcomes: {pct(leader.rate)} of {int(leader.n)} users had a <Term id="real_change">real change</Term> ({interval(leader.lo, leader.hi)}).{' '}
      {tied.length ? (
        <>
          {tied.length === 1 ? (
            <>
              <strong>{tied[0].brand}</strong>’s interval overlaps it, so the two can’t be separated.
            </>
          ) : (
            <>
              The intervals of <strong>{tied.length}</strong> more brands ({tied.map((b) => b.brand).join(', ')}) overlap it, so the top of the league can’t be separated.
            </>
          )}{' '}
        </>
      ) : null}
      {last && last !== leader ? (
        <>
          Lowest: {last.brand}, {pct(last.rate)} (n={int(last.n)}).
        </>
      ) : null}
    </>
  ) : (
    `No brand has ${MIN_GROUP} or more people with 8 weeks of readings in this filter.`
  )

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow={eyebrow}
        title="Competitors"
        answer={answer}
        actions={<Select label="Open a brand" hideLabel value="" onChange={(v) => v && select(v)} options={[{ value: '', label: 'Open a brand…' }, ...[...brands].sort((a, b) => a.brand.localeCompare(b.brand)).map((b) => ({ value: b.brand, label: b.brand }))]} />}
      />
      <div className="grid grid-cols-1 gap-4 min-[1360px]:grid-cols-12">
        <Panel flush className="min-[1360px]:col-span-7" footnote={<>Real change: people using any of the brand’s measured products whose lasting change in those products’ targets held to week {d.cohort.weeks}; bar the <Term id="interval">95% interval</Term>. {note}</>}>
          <DataTable
            caption="Brand league"
            heading={
              <>
                <h2 className="m-0 text-proof-h font-medium text-ink">Brand league</h2>
                <SimBadge cohort={d.cohort} />
              </>
            }
            columns={columns}
            rows={brands}
            rowKey={(r) => r.brand}
            onRowClick={(r) => select(r.brand)}
            rowLabel={(r) => `${r.brand}: compare with the market`}
            sort={sort}
            onSortChange={(s) => setParam({ sort: s ? `${s.id}.${s.dir}` : null })}
            defaultSort={{ id: 'rate', dir: 'desc' }}
            minWidth={640}
            csv={{ name: csvName('brand-league', d), meta: csvMeta(d, note) }}
          />
        </Panel>
        <Panel title="Positioning" id="positioning-h" meta={<SimBadge cohort={d.cohort} />} className="min-[1360px]:col-span-5" footnote={<>Up: more users with a real change. Right: more still using at week {d.cohort.weeks}. Bubble area: people; whisker: the rate’s 95% interval; dashed: the median brand. Select a bubble to compare that brand. {note}</>}>
          <PositioningChart
            caption="Brand positioning: real-change rate against continuation at week 8"
            points={measured.filter((b) => b.cont8 !== null).map((b) => ({ id: b.brand, label: b.brand, rate: b.rate, lo: b.lo, hi: b.hi, cont: b.cont8!, users: b.users, n: b.n }))}
            onSelect={select}
            height={380}
          />
        </Panel>
      </div>
    </div>
  )
}

/* ───────────────────────────── one brand against the market ───────────────────────────── */

function BrandView({ brand, brands, d }: { brand: string; brands: BrandSummary[]; d: Insights }) {
  const { filters, workspace } = useRetailData()
  const { setParam } = useRetailState()
  const eyebrow = useWorkspaceLabel()
  const detail = useView<BrandDetail>(`brand|${brand}|${filters.cohort}|${filters.range}`, () => retailerBrand(brand, filters))
  const inBrandWorkspace = workspace.kind === 'brand'
  const actions = inBrandWorkspace ? undefined : (
    <>
      <ToolButton onClick={() => setParam({ brand: null, goal: null }, { push: true })}>
        <ArrowLeft size={14} strokeWidth={1.6} aria-hidden />
        All brands
      </ToolButton>
      <Select label="Brand" hideLabel value={brand} onChange={(v) => setParam({ brand: slugOf(v), goal: null })} options={[...brands].sort((a, b) => a.brand.localeCompare(b.brand)).map((b) => ({ value: b.brand, label: b.brand }))} />
    </>
  )
  if (detail.status === 'loading')
    return (
      <div role="status" aria-label={`Loading ${brand}`} aria-busy="true" className="flex flex-col gap-4">
        <SectionHeader eyebrow={eyebrow} title={`Competitors · ${brand}`} actions={actions} />
        <div className="grid grid-cols-1 gap-4 min-[1360px]:grid-cols-12">
          <div className="min-[1360px]:col-span-7">
            <SkeletonTable rows={6} toolbar={false} />
          </div>
          <SkeletonPanel height={300} className="min-[1360px]:col-span-5" />
        </div>
      </div>
    )
  if (detail.status === 'failed')
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader eyebrow={eyebrow} title={`Competitors · ${brand}`} actions={actions} />
        <ErrorState title={`${brand} couldn’t load`} body="The brand’s aggregates didn’t answer. No partial numbers are shown." onRetry={detail.retry} />
      </div>
    )
  return <BrandBody b={detail.data} brands={brands} d={d} actions={actions} />
}

type Goal = BrandDetail['goals'][number]

function BrandBody({ b, brands, d, actions }: { b: BrandDetail; brands: BrandSummary[]; d: Insights; actions?: ReactNode }) {
  const eyebrow = useWorkspaceLabel()
  const { param, setParam } = useRetailState()
  const { workspace } = useRetailData()
  const note = b.note ?? NOTE
  const me = brands.find((x) => x.brand === b.brand) ?? null
  const rank = brandRank(brands, b.brand)
  const compared = b.goals.filter((g): g is Goal & { brand: NonNullable<Goal['brand']>; market: NonNullable<Goal['market']> } => g.brand !== null && g.market !== null)
  const above = compared.filter((g) => g.brand.rate > g.market.rate)
  const inside = compared.filter((g) => g.market.rate >= g.brand.lo && g.market.rate <= g.brand.hi)
  const diff = (g: (typeof compared)[number]) => g.brand.rate - g.market.rate
  const best = [...compared].sort((x, y) => diff(y) - diff(x))[0]
  const worst = [...compared].sort((x, y) => diff(x) - diff(y))[0]
  const select = (name: string) => setParam({ brand: slugOf(name), goal: null }, { push: true })

  const answer = (
    <>
      {me && me.rate !== null ? (
        <>
          <strong>{b.brand}</strong>: {pct(me.rate)} of {int(me.n)} users had a <Term id="real_change">real change</Term> ({interval(me.lo, me.hi)}){rank ? `, ${rank.rank} of ${rank.of} brands` : ''}.{' '}
        </>
      ) : (
        <>
          <strong>{b.brand}</strong> has fewer than {MIN_GROUP} users with 8 weeks of readings in this filter.{' '}
        </>
      )}
      {compared.length ? (
        <>
          Above the market rate in <strong>{above.length}</strong> of {compared.length} goals{inside.length ? `; in ${inside.length} the market sits inside the brand’s interval` : ''}.{' '}
          {best && worst && best !== worst ? (
            <>
              Strongest: {best.label.toLowerCase()} ({pct(best.brand.rate)} vs {pct(best.market.rate)}); weakest: {worst.label.toLowerCase()} ({pct(worst.brand.rate)} vs {pct(worst.market.rate)}).
            </>
          ) : null}
        </>
      ) : null}
    </>
  )

  const goalCols: Column<Goal>[] = [
    { id: 'goal', header: 'Goal', rowHeader: true, width: '17%', sortValue: (r) => r.label, cell: (r) => <span className="block truncate text-ink">{r.label}</span> },
    {
      id: 'brand',
      header: b.brand,
      headerText: `${b.brand} real change (%)`,
      sortValue: (r) => r.brand?.rate ?? null,
      firstDir: 'desc',
      cell: (r) =>
        r.brand === null ? (
          <Suppressed />
        ) : (
          <span className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-right font-mono tnum">{pct(r.brand.rate)}</span>
            <EvidenceBar rate={r.brand.rate} lo={r.brand.lo} hi={r.brand.hi} base={r.market?.rate} baseLabel="market" n={r.brand.n} className="min-w-0 flex-1" />
          </span>
        ),
      csv: (r) => (r.brand === null ? 'suppressed' : Math.round(r.brand.rate * 100)),
    },
    {
      id: 'market',
      header: 'Market',
      headerText: 'Market real change (%)',
      align: 'right',
      width: '96px',
      sortValue: (r) => r.market?.rate ?? null,
      cell: (r) =>
        r.market === null ? (
          <Suppressed short />
        ) : (
          <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="font-mono tnum">{pct(r.market.rate)}</span>
            <span className="font-mono text-[11px] text-ink-2 tnum">n={int(r.market.n)}</span>
          </span>
        ),
      csv: (r) => (r.market === null ? 'suppressed' : Math.round(r.market.rate * 100)),
    },
    {
      id: 'rival',
      header: 'Best competitor',
      headerText: 'Best competitor (real change %, n)',
      width: '27%',
      sortValue: (r) => r.best_competitor?.rate ?? null,
      cell: (r) =>
        r.best_competitor === null ? (
          <span className="text-ink-2">None with {MIN_GROUP}+ users</span>
        ) : (
          <span className="flex min-w-0 items-baseline justify-between gap-2" title={r.best_competitor.brand}>
            <span className="truncate text-ink">{r.best_competitor.brand}</span>
            <span className="shrink-0 whitespace-nowrap font-mono tnum">
              {pct(r.best_competitor.rate)} <span className="text-[11px] text-ink-2">n={int(r.best_competitor.n)}</span>
            </span>
          </span>
        ),
      csv: (r) => (r.best_competitor ? `${r.best_competitor.brand} ${Math.round(r.best_competitor.rate * 100)}% n=${r.best_competitor.n}` : ''),
    },
    { id: 'rank', header: 'Rank', headerText: 'Rank among brands', align: 'right', width: '84px', sortValue: (r) => r.rank, firstDir: 'asc', cell: (r) => (r.rank === null ? <Suppressed short /> : <span className="whitespace-nowrap font-mono tnum">{r.rank} of {r.of}</span>), csv: (r) => (r.rank === null ? 'suppressed' : `${r.rank} of ${r.of}`) },
  ]

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader eyebrow={eyebrow} title={`Competitors · ${b.brand}`} answer={answer} actions={actions} />
      <div className="grid grid-cols-1 gap-4 min-[1360px]:grid-cols-12 min-[1360px]:items-start">
        <div className="flex min-w-0 flex-col gap-4 min-[1360px]:col-span-8">
          <Panel flush footnote={<>People with the goal using a product for it, on that goal’s metrics, by week {d.cohort.weeks}. Bar: the brand’s <Term id="interval">95% interval</Term>; tick: the market (everyone using a product for the goal). Ranked among brands with {MIN_GROUP}+ such people. {note}</>}>
            <DataTable
              caption={`${b.brand} against the market, by goal`}
              heading={
                <>
                  <h2 className="m-0 text-proof-h font-medium text-ink">Against the market, by goal</h2>
                  <SimBadge cohort={b.cohort} />
                </>
              }
              columns={goalCols}
              rows={b.goals}
              rowKey={(r) => r.goal_id}
              selectedKey={param('goal')}
              defaultSort={{ id: 'brand', dir: 'desc' }}
              minWidth={700}
              csv={{ name: csvName(`${slugOf(b.brand)}-vs-market-by-goal`, d), meta: csvMeta(b, `${b.brand} · ${note}`) }}
              empty={`${b.brand} has no product for a measured goal.`}
            />
          </Panel>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SharePanel b={b} />
            <SwitchPanel b={b} d={d} note={note} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4 min-[1360px]:col-span-4">
          <Panel title="Positioning" id="positioning-h" meta={<SimBadge cohort={b.cohort} />} footnote={<>Up: more users with a real change. Right: more still using at week {d.cohort.weeks}. Bubble area: people; dashed: the median brand. {note}</>}>
            <PositioningChart
              caption={`Positioning: ${b.brand} among brands, real-change rate against continuation`}
              points={b.positioning.map((p) => {
                const s = brands.find((x) => x.brand === p.brand)
                return { id: p.brand, label: p.brand, rate: p.rate, cont: p.cont8, users: p.users, lo: s?.lo, hi: s?.hi, n: s?.n, emphasis: p.is_self }
              })}
              onSelect={workspace.kind === 'brand' ? undefined : select}
            />
          </Panel>
          <SkinPanel b={b} d={d} note={note} />
        </div>
      </div>
      <BrandProducts b={b} d={d} />
    </div>
  )
}

function SharePanel({ b }: { b: BrandDetail }) {
  const max = Math.max(0.01, ...b.share.map((s) => s.brand_share ?? 0))
  return (
    <Panel title={<Term id="routine_share">Share of routines</Term>} id="share-h" meta={<SimBadge cohort={b.cohort} />} footnote={`People using a ${b.brand} product in the category, out of everyone using any product in it (any week). Under ${MIN_GROUP} people: hidden.`}>
      {b.share.length === 0 ? (
        <EmptyState compact title="No categories" body={`${b.brand} has no catalogue products in a category with users.`} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {b.share.map((s) => (
            <li key={s.category} className="grid grid-cols-[minmax(0,96px)_minmax(0,1fr)_88px] items-center gap-3">
              <span className="truncate text-proof-body text-ink">{s.label}</span>
              {s.brand_share === null ? (
                <span aria-hidden className="retail-hatch block h-1.5 rounded-pill" />
              ) : (
                <span aria-hidden className="block h-1.5 rounded-pill bg-muted">
                  <span className="block h-full rounded-pill bg-ink/70" style={{ width: `${(s.brand_share / max) * 100}%` }} />
                </span>
              )}
              <span className="text-right">
                {s.brand_share === null ? (
                  <Suppressed short />
                ) : (
                  <span className="whitespace-nowrap font-mono text-proof-small tnum">
                    {pct(s.brand_share)} <span className="text-[11px] text-ink-2">n={int(s.users)}</span>
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function SwitchPanel({ b, d, note }: { b: BrandDetail; d: Insights; note: string }) {
  const rows = switchRows(b.switching.won, b.switching.lost)
  const max = Math.max(1, ...rows.flatMap((r) => [r.won ?? 0, r.lost ?? 0]))
  const net = b.switching.net
  return (
    <section id="switching" aria-labelledby="switch-h" className="flex min-w-0 flex-col rounded-sm border border-line bg-surface">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex items-center gap-2">
          <h2 id="switch-h" className="m-0 text-proof-h font-medium text-ink">
            Switching
          </h2>
          <SimBadge cohort={b.cohort} />
        </div>
        <span className="font-mono text-proof-small tnum text-ink">{net === null ? <span className="font-ui text-ink-2">Net: fewer than {MIN_GROUP} either way</span> : <>Net {net > 0 ? '+' : net < 0 ? '−' : '±'}{int(Math.abs(net))} people</>}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        {rows.length === 0 ? (
          <EmptyState compact title="No brand pair with 10+ switchers" body={`Nobody switched between ${b.brand} and one other brand in groups of ${MIN_GROUP} or more in this filter.`} />
        ) : (
          <table className="w-full border-collapse text-proof-body">
            <caption className="sr-only">People who switched between {b.brand} and other brands</caption>
            <thead>
              <tr className="text-proof-small text-ink-2">
                <th scope="col" className="h-7 text-left font-normal">Brand</th>
                <th scope="col" className="w-[34%] pr-1 text-right font-normal">Lost to</th>
                <th scope="col" className="w-[34%] pl-1 text-left font-normal">Won from</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.brand} className="border-t border-line">
                  <th scope="row" className="h-9 max-w-0 truncate pr-2 text-left font-normal text-ink" title={r.brand}>
                    {r.brand}
                  </th>
                  <td className="border-r border-line-strong pr-1">
                    <span className="flex items-center justify-end gap-1.5">
                      {r.lost !== null ? <span className="font-mono text-[11px] text-ink-2 tnum">{int(r.lost)}</span> : <span className="sr-only">fewer than {MIN_GROUP}</span>}
                      <span aria-hidden className="block h-2 rounded-l-[3px] bg-ink/40" style={{ width: `${((r.lost ?? 0) / max) * 70}%` }} />
                    </span>
                  </td>
                  <td className="pl-1">
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className="block h-2 rounded-r-[3px] bg-ink/80" style={{ width: `${((r.won ?? 0) / max) * 70}%` }} />
                      {r.won !== null ? <span className="font-mono text-[11px] text-ink tnum">{int(r.won)}</span> : <span className="sr-only">fewer than {MIN_GROUP}</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-line px-4 py-2.5 text-proof-small text-ink-2">
        A switch: stopped a product and started another in the same category within 2 weeks. Pairs under {MIN_GROUP} people aren’t listed; the net counts every switch. Week {d.cohort.weeks} cohort. {note}
      </div>
    </section>
  )
}

function SkinPanel({ b, d, note }: { b: BrandDetail; d: Insights; note: string }) {
  return (
    <Panel title="By skin type, against the market" id="skin-h" meta={<SimBadge cohort={b.cohort} />} footnote={<>Real change among {b.brand} users with each skin type (dot, with n; the figure after the slash and the tick are the market’s rate for that skin type), by week {d.cohort.weeks}. {note}</>}>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {b.skin.map((s) => (
          <li key={s.skin} className="grid min-h-6 grid-cols-[84px_minmax(0,1fr)] items-center gap-3">
            <span className="text-proof-body text-ink">{s.label}</span>
            {s.brand_rate === null ? (
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-proof-small text-ink-2">
                <Suppressed />
                {s.market_rate !== null ? <span className="font-mono tnum">market {pct(s.market_rate)}</span> : null}
              </span>
            ) : (
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-[74px] shrink-0 whitespace-nowrap text-right font-mono text-proof-small tnum">
                  {pct(s.brand_rate)}
                  {s.market_rate !== null ? <span className="text-ink-2"> / {pct(s.market_rate)}</span> : null}
                </span>
                <EvidenceBar rate={s.brand_rate} base={s.market_rate} baseLabel="market" n={s.n} className="min-w-0 flex-1" />
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function BrandProducts({ b, d }: { b: BrandDetail; d: Insights }) {
  const navigate = useNavigate()
  const { carry } = useRetailState()
  const { workspace } = useRetailData()
  const mine = workspace.kind === 'brand' && workspace.brand === b.brand
  const cols: Column<ProductRow>[] = [
    {
      id: 'product',
      header: 'Product',
      rowHeader: true,
      width: '32%',
      sortValue: (r) => r.product,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2.5" title={r.product}>
          <ProductImage product={{ image_url: r.image_url, category: r.category, name: r.product }} size={26} decorative />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ink">
              {r.product}
              {mine ? <YoursTag /> : null}
            </span>
            <span className="truncate text-proof-small text-ink-2">{r.category_label}</span>
          </span>
        </span>
      ),
    },
    { id: 'tier', header: <Term id="proof_tier">Proof tier</Term>, headerText: 'Proof tier', width: '150px', sortValue: (r) => ({ proven: 3, promising: 2, unclear: 1, too_few: 0 })[r.tier], firstDir: 'desc', cell: (r) => <ProofTierChip tier={r.tier} size="sm" />, csv: (r) => r.tier },
    {
      id: 'rate',
      header: <Term id="real_change">Real change</Term>,
      headerText: 'Real change (%)',
      sortValue: (r) => r.rate,
      firstDir: 'desc',
      cell: (r) =>
        r.rate === null ? (
          <Suppressed />
        ) : (
          <span className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-right font-mono tnum">{pct(r.rate)}</span>
            <EvidenceBar rate={r.rate} lo={r.rate_lo} hi={r.rate_hi} base={r.base_rate} n={r.n} className="min-w-0 flex-1" />
          </span>
        ),
      csv: (r) => (r.rate === null ? 'suppressed' : Math.round(r.rate * 100)),
    },
    { id: 'lift', header: <Term id="lift">Lift</Term>, headerText: 'Lift vs non-users (pts)', align: 'right', width: '90px', sortValue: (r) => r.lift, cell: (r) => <LiftValue lift={r.lift} lo={r.lift_lo} hi={r.lift_hi} />, csv: (r) => (r.lift === null ? 'suppressed' : Math.round(r.lift * 100)) },
    { id: 'cont8', header: <Term id="continuation">Still using</Term>, headerText: 'Still using at week 8 (%)', align: 'right', width: '92px', sortValue: (r) => r.cont8, cell: (r) => (r.cont8 === null ? <Suppressed short /> : <span className="font-mono tnum">{pct(r.cont8)}</span>), csv: (r) => (r.cont8 === null ? 'suppressed' : Math.round(r.cont8 * 100)) },
  ]
  return (
    <Panel flush footnote={<>Ember dot: real change by week {d.cohort.weeks}; bar: its <Term id="interval">95% interval</Term>; tick: <Term id="base_rate">non-users</Term> with an overlapping goal. Open a product for its curve, segments and evidence pack.</>}>
      <DataTable
        caption={`${b.brand} products`}
        heading={
          <>
            <h2 className="m-0 text-proof-h font-medium text-ink">{b.brand} products</h2>
            <SimBadge cohort={b.cohort} />
          </>
        }
        columns={cols}
        rows={b.products}
        rowKey={(r) => r.product_id}
        onRowClick={(r) => navigate(`${sectionPath('products', r.product_id)}${carry}`)}
        rowLabel={(r) => `${r.product}: open product page`}
        defaultSort={{ id: 'rate', dir: 'desc' }}
        minWidth={760}
        csv={{ name: csvName(`${slugOf(b.brand)}-products`, d), meta: csvMeta(b, b.brand) }}
      />
    </Panel>
  )
}
