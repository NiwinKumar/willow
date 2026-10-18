import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { retailerBrand, retailerBrands } from '../../../../lib/api'
import { useRetailData } from '../../context'
import { csvMeta, csvName } from '../../data'
import { useRetailState } from '../../state'
import type { BrandDetail, BrandSummary, Insights } from '../../types'
import { Button, DataTable, EmptyState, ErrorState, EvidenceBar, int, interval, MIN_GROUP, Panel, pct, PositioningChart, ShareBar, SidePanel, slugOf, Stat, Suppressed, type Column } from '../../ui'
import { brandLeaders, brandRank, niceDomain } from '../../ui/insight'
import { useView } from '../../useView'
import { HeroBone, MarketFrame, PanelBone } from './Frame'
import { byGap, NOTE, type VsRow } from './model'
import { SwitchingPanel } from './Switching'
import { VsLegend, VsMarketRows } from './VsMarket'

/*
 * Market › Brands, on GET /v1/retailer/brands and /brands/{brand}.
 * Brand workspace (?as=brand:<slug>): you against the market by goal (with the best competitor per goal) and
 * the positioning chart above the fold; switching, share of category routines and skin types below. `?goal=`
 * (a brief card) marks a goal row; `#switching` scrolls to Switching.
 * Retailer workspace: the brand leaderboard and positioning; a row or bubble opens that brand's goal profile
 * in a side panel (`?brand=<slug>`), from where the viewer can switch to the brand's workspace.
 */

type Goal = BrandDetail['goals'][number]

export function BrandsView({ d }: { d: Insights }) {
  const { filters, workspace } = useRetailData()
  const list = useView(`brands|${filters.cohort}|${filters.range}`, () => retailerBrands(filters))
  if (list.status === 'loading')
    return (
      <MarketFrame view="brands">
        <HeroBone />
      </MarketFrame>
    )
  if (list.status === 'failed')
    return (
      <MarketFrame view="brands" description="Brand comparisons are unavailable right now.">
        <ErrorState title="Brand comparisons couldn’t load" body="The brand aggregates didn’t answer. No partial numbers are shown." onRetry={list.retry} />
      </MarketFrame>
    )
  const brands = list.data.brands
  const note = list.data.note ?? NOTE
  if (workspace.kind === 'brand') {
    const mine = brands.find((b) => slugOf(b.brand) === workspace.slug)
    return mine ? <BrandWorkspace key={mine.brand} brand={mine.brand} brands={brands} d={d} /> : <UnknownBrand slug={workspace.slug} />
  }
  return <Leaderboard brands={brands} d={d} note={note} />
}

function UnknownBrand({ slug }: { slug: string }) {
  const { setWorkspace } = useRetailState()
  return (
    <MarketFrame view="brands" description="This workspace doesn’t match a catalogue brand.">
      <EmptyState title="No brand by that name" body={`“${slug}” isn’t one of the catalogue brands in this filter.`} action={{ label: 'View as retailer', onClick: () => setWorkspace({ kind: 'retailer' }) }} />
    </MarketFrame>
  )
}

/* ───────────────────────────── retailer: the leaderboard ───────────────────────────── */

function Leaderboard({ brands, d, note }: { brands: BrandSummary[]; d: Insights; note: string }) {
  const { param, setParam } = useRetailState()
  const { leader, tied, measured } = brandLeaders(brands)
  const open = (brand: string) => setParam({ brand: slugOf(brand) }, { push: true })
  const sortParam = param('sort')
  const sort = (() => {
    const [id, dir] = (sortParam ?? '').split('.')
    return ['brand', 'products', 'users', 'rate', 'cont8', 'share', 'n'].includes(id) && (dir === 'asc' || dir === 'desc') ? { id, dir: dir as 'asc' | 'desc' } : null
  })()
  const selected = brands.find((b) => slugOf(b.brand) === param('brand')) ?? null

  const columns: Column<BrandSummary>[] = [
    { id: 'brand', header: 'Brand', rowHeader: true, width: '26%', sortValue: (r) => r.brand, cell: (r) => <span className="block truncate text-ink">{r.brand}</span> },
    {
      id: 'rate',
      header: 'Visible change',
      headerText: 'Visible change by week 8 (%)',
      sortValue: (r) => r.rate,
      firstDir: 'desc',
      cell: (r) =>
        r.rate === null ? (
          <Suppressed />
        ) : (
          <span className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-right tnum">{pct(r.rate)}</span>
            <EvidenceBar rate={r.rate} lo={r.lo} hi={r.hi} n={r.n} showN={false} className="min-w-0 flex-1" />
          </span>
        ),
      csv: (r) => (r.rate === null ? 'suppressed' : Math.round(r.rate * 100)),
    },
    { id: 'users', header: 'People', headerText: 'People using any of its products', align: 'right', width: '80px', sortValue: (r) => r.users, firstDir: 'desc', cell: (r) => (r.users === null ? <Suppressed short /> : <span className="tnum">{int(r.users)}</span>), csv: (r) => r.users ?? 'suppressed' },
    { id: 'cont8', header: 'Still using', headerText: 'Still using at week 8 (%)', align: 'right', width: '92px', sortValue: (r) => r.cont8, firstDir: 'desc', cell: (r) => (r.cont8 === null ? <Suppressed short /> : <span className="tnum">{pct(r.cont8)}</span>), csv: (r) => (r.cont8 === null ? 'suppressed' : Math.round(r.cont8 * 100)), optional: true },
    { id: 'share', header: 'Routines', headerText: 'Share of routines (%)', align: 'right', width: '88px', sortValue: (r) => r.routine_share, firstDir: 'desc', cell: (r) => (r.routine_share === null ? <Suppressed short /> : <span className="tnum">{pct(r.routine_share)}</span>), csv: (r) => (r.routine_share === null ? 'suppressed' : Math.round(r.routine_share * 100)), optional: true },
    { id: 'products', header: 'Products', headerText: 'Catalogue products', align: 'right', width: '84px', sortValue: (r) => r.products, firstDir: 'desc', cell: (r) => <span className="tnum text-ink-2">{r.products}</span>, optional: true, hidden: true },
    { id: 'n', header: 'n at wk 8', headerText: 'People with 8 weeks of readings', align: 'right', width: '88px', sortValue: (r) => r.n, firstDir: 'desc', cell: (r) => (r.n === null ? <Suppressed short /> : <span className="tnum text-ink-2">{int(r.n)}</span>), csv: (r) => r.n ?? 'suppressed', optional: true, hidden: true },
    { id: 'ci', header: '95% interval', headerText: 'Visible change 95% interval', align: 'right', width: '100px', cell: (r) => <span className="tnum text-ink-2">{interval(r.lo, r.hi) ?? '—'}</span>, csv: (r) => interval(r.lo, r.hi) ?? '', optional: true, hidden: true },
  ]

  const description = leader ? (
    <>
      <strong>{leader.brand}</strong> leads on visible change ({pct(leader.rate)}, n={int(leader.n)});{' '}
      {tied.length === 0 ? 'no other brand’s interval reaches it.' : (
        <>
          <strong>{tied.length}</strong> more {tied.length === 1 ? 'brand overlaps' : 'brands overlap'} its interval.
        </>
      )}
    </>
  ) : (
    `No brand has ${MIN_GROUP} or more people with 8 weeks of readings in this filter.`
  )

  return (
    <MarketFrame view="brands" description={description}>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 xl:items-start">
        <Panel flush className="xl:col-span-7" footnote={note}>
          <DataTable
            caption="Brands ranked by visible change"
            heading={<h2 className="m-0 text-proof-h text-ink">Brands</h2>}
            columns={columns}
            rows={brands}
            rowKey={(r) => r.brand}
            onRowClick={(r) => open(r.brand)}
            rowLabel={(r) => `${r.brand}: open its goal profile`}
            selectedKey={selected?.brand ?? null}
            sort={sort}
            onSortChange={(s) => setParam({ sort: s ? `${s.id}.${s.dir}` : null })}
            defaultSort={{ id: 'rate', dir: 'desc' }}
            minWidth={600}
            columnsKey="market-brands"
            csv={{ name: csvName('brands', d), meta: csvMeta(d, note) }}
          />
        </Panel>
        <Panel title="Positioning" id="positioning-h" description="Each dot is a brand. Further up: more of its people saw a visible change. Further right: more kept using it." className="xl:col-span-5">
          <PositioningChart
            caption="Brands: visible change against still using at week 8"
            points={measured.filter((b) => b.cont8 !== null).map((b) => ({ id: b.brand, label: b.brand, rate: b.rate, lo: b.lo, hi: b.hi, cont: b.cont8!, users: b.users, n: b.n, emphasis: b === leader }))}
            onSelect={open}
            height={360}
          />
        </Panel>
      </div>
      <BrandPanel brand={selected} brands={brands} />
    </MarketFrame>
  )
}

/** One brand's goal profile in a side panel (`?brand=<slug>`), with the way into its workspace. */
function BrandPanel({ brand, brands }: { brand: BrandSummary | null; brands: BrandSummary[] }) {
  const { filters, workspace } = useRetailData()
  const { setParam } = useRetailState()
  const close = () => setParam({ brand: null })
  const detail = useView<BrandDetail>(brand ? `brand|${brand.brand}|${filters.cohort}|${filters.range}` : null, () => retailerBrand(brand!.brand, filters))
  const rank = brand ? brandRank(brands, brand.brand) : null
  return (
    <SidePanel
      open={brand !== null}
      onClose={close}
      title={brand?.brand ?? ''}
      subtitle={rank ? `${rank.rank} of ${rank.of} brands on visible change` : brand ? `Fewer than ${MIN_GROUP} people with 8 weeks of readings` : undefined}
      width={520}
      labelledBy="market-brand-panel"
      footer={
        brand && workspace.kind === 'retailer' ? (
          <Button
            onClick={() => {
              setParam({ as: `brand:${slugOf(brand.brand)}`, brand: null, sort: null }, { push: true })
              window.scrollTo({ top: 0 })
            }}
          >
            View as {brand.brand}
          </Button>
        ) : undefined
      }
    >
      {brand ? (
        <div className="flex flex-col gap-6">
          <dl className="m-0 grid grid-cols-3 gap-4">
            <Stat label="Visible change" value={pct(brand.rate)} sub={brand.n ? `n=${int(brand.n)}${interval(brand.lo, brand.hi) ? ` · ${interval(brand.lo, brand.hi)}` : ''}` : `n<${MIN_GROUP}`} />
            <Stat label="Still using wk 8" value={pct(brand.cont8)} />
            <Stat label="Share of routines" value={pct(brand.routine_share)} sub={`${int(brand.users)} people`} />
          </dl>
          <section aria-labelledby="market-brand-goals" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 id="market-brand-goals" className="m-0 text-proof-h text-ink">
                By goal, against the market
              </h3>
              <p className="m-0 text-proof-small text-ink-2">
                <VsLegend you={brand.brand} rival />
              </p>
            </div>
            {detail.status === 'loading' ? (
              <span role="status" aria-label="Loading the goal profile" className="retail-shimmer block h-64 rounded-ctl" />
            ) : detail.status === 'failed' ? (
              <ErrorState compact title="The goal profile couldn’t load" body="No partial numbers are shown." onRetry={detail.retry} />
            ) : (
              <VsMarketRows rows={goalRows(detail.data.goals)} rival youLabel="Brand" labelHeader="Goal" caption={`${brand.brand} against the market, by goal`} />
            )}
          </section>
          {detail.status === 'ready' ? <p className="m-0 text-proof-small text-ink-2">{detail.data.note ?? NOTE}</p> : null}
        </div>
      ) : null}
    </SidePanel>
  )
}

const goalRows = (goals: Goal[]): VsRow[] => byGap(goals.map((g) => ({ id: g.goal_id, label: g.label, sub: g.rank ? `${g.rank} of ${g.of} brands` : null, you: g.brand, market: g.market, rival: g.best_competitor })))

/* ───────────────────────────── brand workspace ───────────────────────────── */

function BrandWorkspace({ brand, brands, d }: { brand: string; brands: BrandSummary[]; d: Insights }) {
  const { filters } = useRetailData()
  const detail = useView<BrandDetail>(`brand|${brand}|${filters.cohort}|${filters.range}`, () => retailerBrand(brand, filters))
  if (detail.status === 'loading')
    return (
      <MarketFrame view="brands">
        <HeroBone />
        <div aria-hidden className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <PanelBone height={180} />
          <PanelBone height={180} />
          <PanelBone height={180} />
        </div>
      </MarketFrame>
    )
  if (detail.status === 'failed')
    return (
      <MarketFrame view="brands" description={`${brand}’s comparison is unavailable right now.`}>
        <ErrorState title={`${brand} couldn’t load`} body="The brand’s aggregates didn’t answer. No partial numbers are shown." onRetry={detail.retry} />
      </MarketFrame>
    )
  return <BrandBody b={detail.data} brands={brands} d={d} />
}

function BrandBody({ b, brands }: { b: BrandDetail; brands: BrandSummary[]; d: Insights }) {
  const { param, setParam } = useRetailState()
  const { hash } = useLocation()
  const note = b.note ?? NOTE
  const me = brands.find((x) => x.brand === b.brand) ?? null
  const rank = brandRank(brands, b.brand)
  const compared = b.goals.filter((g): g is Goal & { brand: NonNullable<Goal['brand']>; market: NonNullable<Goal['market']> } => g.brand !== null && g.market !== null)
  const ahead = compared.filter((g) => Math.round((g.brand.rate - g.market.rate) * 100) > 0)
  const best = [...compared].sort((x, y) => y.brand.rate - y.market.rate - (x.brand.rate - x.market.rate))[0]
  const selected = brands.find((x) => slugOf(x.brand) === param('brand')) ?? null

  // Brief cards link here with #switching; the panel exists only once the data is in, so scroll then.
  useEffect(() => {
    if (hash === '#switching') document.getElementById('switching')?.scrollIntoView({ block: 'start' })
  }, [hash])

  const description = (
    <>
      <strong>{b.brand}</strong>{' '}
      {me?.rate !== null && me?.rate !== undefined && rank ? (
        <>
          ranks{' '}
          <strong>
            {rank.rank} of {rank.of}
          </strong>{' '}
          brands on visible change
        </>
      ) : (
        <>has fewer than {MIN_GROUP} people with 8 weeks of readings overall</>
      )}
      {compared.length ? (
        <>
          {' '}
          and is ahead of the market in{' '}
          <strong>
            {ahead.length} of {compared.length}
          </strong>{' '}
          goals{best && ahead.includes(best) ? <>; strongest in {best.label}</> : null}.
        </>
      ) : (
        '.'
      )}
    </>
  )

  const skinRows: VsRow[] = b.skin.map((s) => ({ id: s.skin, label: s.label, you: s.brand_rate === null ? null : { rate: s.brand_rate, n: s.n }, market: s.market_rate === null ? null : { rate: s.market_rate } }))
  const points = b.positioning.map((p) => {
    const s = brands.find((x) => x.brand === p.brand)
    return { id: p.brand, label: p.brand, rate: p.rate, cont: p.cont8, users: p.users, lo: s?.lo, hi: s?.hi, n: s?.n, emphasis: p.is_self }
  })

  return (
    <MarketFrame view="brands" description={description}>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 xl:items-start">
        <Panel title="You vs the market by goal" id="goals-h" description={<VsLegend you="You" rival />} className="xl:col-span-7" footnote={`Visible change by week 8 among people with the goal who use a product for it; sorted by your gap to the market. ${note}`}>
          {b.goals.length === 0 ? <EmptyState compact title="No measured goal yet" body={`${b.brand} has no product for a measured goal in this filter.`} /> : <VsMarketRows rows={goalRows(b.goals)} rival youLabel="You" labelHeader="Goal" selected={param('goal')} caption={`${b.brand} against the market, by goal`} />}
        </Panel>
        <Panel title="Positioning" id="positioning-h" description="Each dot is a brand. Further up: more of its people saw a visible change. Further right: more kept using it." className="xl:col-span-5">
          <PositioningChart caption={`${b.brand} among brands: visible change against still using at week 8`} points={points} onSelect={(id) => id !== b.brand && setParam({ brand: slugOf(id) }, { push: true })} height={360} />
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SwitchingPanel b={b} />
        <SharePanel b={b} />
        <Panel title="By skin type" id="skin-h" description={<VsLegend you="You" interval={false} />} className="h-full">
          <VsMarketRows
            rows={skinRows}
            domain={niceDomain(skinRows.flatMap((r) => [r.you?.rate, r.market?.rate].filter((v): v is number => v !== undefined)), 0.1, 0.4)}
            youLabel="You"
            labelHeader="Skin type"
            caption={`${b.brand} against the market, by skin type`}
          />
        </Panel>
      </div>
      <BrandPanel brand={selected && selected.brand !== b.brand ? selected : null} brands={brands} />
    </MarketFrame>
  )
}

function SharePanel({ b }: { b: BrandDetail }) {
  const { setParam } = useRetailState()
  const max = Math.max(0.01, ...b.share.map((s) => s.brand_share ?? 0))
  return (
    <Panel title="Share of category routines" id="share-h" description="Of everyone using a product in the category, the share using yours." className="h-full">
      {b.share.length === 0 ? (
        <EmptyState compact title="No categories yet" body={`${b.brand} has no catalogue products in a category with users.`} />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {b.share.map((s) => (
            <li key={s.category} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => setParam({ view: 'categories', category: s.category, goal: null }, { push: true })}
                aria-label={`${s.label}: ${s.brand_share === null ? `fewer than ${MIN_GROUP} people` : `${pct(s.brand_share)} of routines, ${int(s.users)} people`}. Open the category`}
                className="-mx-2 grid min-h-11 w-[calc(100%+16px)] grid-cols-[minmax(0,104px)_minmax(0,1fr)_auto] items-center gap-3 rounded-ctl border-0 bg-transparent px-2 text-left hover:bg-pf-hover"
              >
                <span className="truncate text-proof-body text-ink">{s.label}</span>
                {s.brand_share === null ? <span aria-hidden className="retail-hatch block h-1.5 rounded-pill" /> : <ShareBar value={s.brand_share} max={max} />}
                <span className="text-right text-proof-body tnum text-ink">
                  {s.brand_share === null ? (
                    <Suppressed short />
                  ) : (
                    <>
                      {pct(s.brand_share)} <span className="text-proof-label text-ink-2">n={int(s.users)}</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
