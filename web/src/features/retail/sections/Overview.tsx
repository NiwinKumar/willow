import { ArrowRight, ArrowUpRight, ChevronRight, CircleDashed, Lightbulb, Megaphone, Sparkles, TrendingUp, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Disclaimer } from '../../../components/willow/Disclaimer'
import { retailerBrief } from '../../../lib/api'
import { useAuth } from '../../../lib/useAuth'
import { openProposals } from '../autopilot'
import { useRetailData } from '../context'
import { DATA_STUDIO } from '../data'
import { campaignFor, pipelineSteps, ProofPipeline, useCampaigns } from '../pipeline'
import { ProductImage } from '../../routine/productUi'
import { useProductDetail, useProducts } from '../productData'
import { sectionPath, useRetailState } from '../state'
import type { Brief, BriefCard, BrandSummary, Insights, ProductRow, Products } from '../types'
import { Badge, Bone, Button, cohortKind, CurveChart, EmptyState, ErrorState, int, KpiStrip, MIN_GROUP, PageHeader, Panel, pct, pts, SkeletonKpis, SkeletonPanel, TierDot, ToolButton, type Kpi } from '../ui'
import { briefHref, cardFigure } from '../ui/insight'
import { useAutopilot } from './promote/useAutopilot'
import { InsightsGate } from './shared'

/*
 * Overview (/retail): what is working and what needs attention, for the retailer or one brand.
 *   1. Spotlight: the strongest Proven product (yours, in a brand workspace) with its outcome, its curve and its
 *      Proof pipeline, and the two next steps (view the proof, promote it). The demo starts here.
 *   2. Four key figures.
 *   3. This week's brief (fixed rules over the aggregates, with Gemini's checked summary) and the top products.
 *   4. About this data (collapsed).
 */

export default function Overview() {
  return (
    <InsightsGate
      skeleton={
        <div className="flex flex-col gap-8">
          <div aria-hidden className="flex flex-col gap-2">
            <Bone className="h-7 w-56" />
            <Bone className="h-4 w-[min(520px,80%)]" />
          </div>
          <SkeletonPanel height={300} />
          <SkeletonKpis n={4} />
        </div>
      }
    >
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

/** People-weighted visible-change rate over measured rows (null under 10 people in all). */
function weighted(rows: ProductRow[], key: 'rate' | 'cont8'): { value: number; n: number } | null {
  let s = 0
  let n = 0
  for (const r of rows) {
    const v = r[key]
    if (v === null || r.n === null) continue
    s += v * r.n
    n += r.n
  }
  return n >= MIN_GROUP ? { value: s / n, n } : null
}

/** The spotlight: highest lift lower bound among Proven rows, else the Promising row closest to Proven. */
function spotlightOf(rows: ProductRow[]): ProductRow | null {
  const proven = rows.filter((r) => r.tier === 'proven' && r.lift_lo !== null).sort((a, b) => (b.lift_lo ?? 0) - (a.lift_lo ?? 0))
  if (proven[0]) return proven[0]
  const promising = rows.filter((r) => r.tier === 'promising').sort((a, b) => (a.to_proven ?? 1e9) - (b.to_proven ?? 1e9) || (b.lift ?? 0) - (a.lift ?? 0))
  return promising[0] ?? null
}

function Body({ d }: { d: Insights }) {
  const { workspace, filters, brands } = useRetailData()
  const { carry } = useRetailState()
  const brand = workspace.kind === 'brand' ? workspace.brand : null
  const summary = brand ? (brands.find((b) => b.brand === brand)?.summary ?? null) : null
  const { state, retry } = useProducts(filters)
  const all = state.status === 'ready' ? state.d : null
  const rows = useMemo(() => (all ? (brand ? all.products.filter((r) => r.brand === brand) : all.products) : []), [all, brand])
  const proven = rows.filter((r) => r.tier === 'proven').length
  const measured = rows.filter((r) => r.rate !== null).length
  const spot = spotlightOf(rows)

  if (state.status === 'failed' || state.status === 'missing')
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title={brand ?? 'Overview'} />
        <ErrorState title="Products couldn’t load" body="The products service didn’t answer. No partial numbers are shown." onRetry={retry} />
      </div>
    )

  const description = !all ? (
    <span className="inline-block h-4 w-80 animate-pulse rounded bg-sunken align-middle" />
  ) : brand ? (
    rows.length ? (
      <>
        <strong>
          {proven} of {rows.length}
        </strong>{' '}
        of your {rows.length === 1 ? 'product is' : 'products are'} Proven; {measured} {measured === 1 ? 'has' : 'have'} a measured outcome.
      </>
    ) : (
      <>No {brand} product is in the catalog for this filter.</>
    )
  ) : (
    <>
      <strong>
        {proven} of {rows.length}
      </strong>{' '}
      products are Proven across {new Set(rows.map((r) => r.brand)).size} brands; {measured} {measured === 1 ? 'has' : 'have'} a measured outcome.
    </>
  )

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={brand ?? 'Overview'}
        description={description}
        actions={
          <>
            <Button to={`${sectionPath('products')}${carry}`}>All products</Button>
            <Button to={`${sectionPath('campaigns')}${carry}${spot?.tier === 'proven' ? `${carry ? '&' : '?'}new=${encodeURIComponent(spot.product_id)}` : ''}`} kind="primary">
              <Megaphone size={15} strokeWidth={1.7} aria-hidden /> New campaign
            </Button>
          </>
        }
      />
      {state.status === 'loading' ? <SkeletonPanel height={300} /> : spot ? <Spotlight row={spot} weeksN={d.cohort.weeks} mine={Boolean(brand)} /> : <NoSpotlight brand={brand} />}
      <Kpis d={d} all={all} rows={rows} brand={brand} summary={summary} />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <BriefPanel brand={brand} className="lg:col-span-7" />
        <TopProducts rows={rows} brand={brand} className="lg:col-span-5" />
      </div>
      <About d={d} />
    </div>
  )
}

/* ───────────────────────────── spotlight ───────────────────────────── */

function Spotlight({ row, weeksN, mine }: { row: ProductRow; weeksN: number; mine: boolean }) {
  const { filters } = useRetailData()
  const { carry } = useRetailState()
  const detail = useProductDetail(row.product_id, filters)
  const x = detail.status === 'ready' ? detail.d : null
  const campaign = campaignFor(useCampaigns(), row.product_id)
  const productTo = `${sectionPath('products', row.product_id)}${carry}`
  const promoteTo = `${sectionPath('campaigns')}${carry}${carry ? '&' : '?'}new=${encodeURIComponent(row.product_id)}`
  const eligible = x ? x.eligibility.eligible : row.tier === 'proven'
  const steps = pipelineSteps({ p: row, weeksN, statements: x ? x.evidence.length : null, eligible, campaign, promoteTo })
  return (
    <section aria-labelledby="spot-h" className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 p-6 lg:col-span-7">
          <div className="flex items-center justify-between gap-3">
            <h2 id="spot-h" className="m-0 flex items-center gap-2 text-proof-small font-medium text-ink-2">
              <Sparkles size={15} strokeWidth={1.7} aria-hidden className="text-proof-leaf" />
              {row.tier === 'proven' ? (mine ? 'Your strongest proof' : 'Strongest proof in the catalog') : mine ? 'Closest to Proven' : 'Closest to Proven in the catalog'}
            </h2>
            <Badge tone={row.tier === 'proven' ? 'green' : 'amber'}>
              <TierDot tier={row.tier} />
              {row.tier === 'proven' ? 'Proven' : 'Promising'}
            </Badge>
          </div>
          <Link to={productTo} className="group flex min-w-0 items-center gap-4 no-underline">
            <span className="shrink-0 overflow-hidden rounded-card border border-line bg-pf-bg2 p-1">
              <ProductImage product={{ image_url: row.image_url, category: row.category, name: row.product }} size={48} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-proof-h text-ink group-hover:underline">{row.product}</span>
              <span className="truncate text-proof-small text-ink-2">
                {row.brand} · {row.category_label}
              </span>
            </span>
          </Link>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div className="flex flex-col gap-1">
              <span className="text-proof-hero text-ink tnum">{pct(row.rate)}</span>
              <span className="text-proof-body text-ink-2">
                of {int(row.n)} users saw a visible change by week {weeksN}
              </span>
            </div>
            {row.base_rate !== null ? (
              <div className="flex flex-col gap-1 pb-0.5">
                <span className="flex items-baseline gap-2">
                  <span className="text-proof-kpi text-ink-2 tnum">{pct(row.base_rate)}</span>
                  {row.lift !== null ? <span className={`rounded-pill px-2 py-0.5 text-proof-small font-semibold tnum ${row.lift > 0 ? 'bg-proof-leaf-soft text-proof-leaf' : 'bg-sunken text-ink-2'}`}>{pts(row.lift)}</span> : null}
                </span>
                <span className="text-proof-body text-ink-2">of non-users with the same goals</span>
              </div>
            ) : null}
          </div>
          {x && x.curve.users.some((v) => v !== null) ? (
            <CurveChart title={`${row.product}: share with a visible change by week`} weeks={x.curve.weeks} height={150} series={[{ id: 'users', label: 'Users', values: x.curve.users, tone: 'signal' }, ...(x.curve.base.some((v) => v !== null) ? [{ id: 'base', label: 'Non-users', values: x.curve.base, tone: 'muted' as const }] : [])]} />
          ) : (
            <Bone className="h-[150px] w-full" />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-5 border-t border-line bg-pf-bg2 p-6 lg:col-span-5 lg:border-l lg:border-t-0">
          <h3 className="m-0 text-proof-small font-medium text-ink-2">From photos to an accountable promotion</h3>
          <ProofPipeline steps={steps} vertical />
          <div className="mt-auto flex flex-wrap gap-2">
            <Button to={productTo} kind="secondary">
              View proof <ArrowRight size={15} strokeWidth={1.7} aria-hidden />
            </Button>
            {eligible && (!campaign || campaign.status === 'ended') ? (
              <Button to={promoteTo} kind="primary">
                <Megaphone size={15} strokeWidth={1.7} aria-hidden /> Promote
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function NoSpotlight({ brand }: { brand: string | null }) {
  const { carry } = useRetailState()
  return (
    <EmptyState
      icon={<Sparkles size={18} strokeWidth={1.6} />}
      title={brand ? `No ${brand} product is Proven or Promising yet` : 'No product is Proven or Promising yet'}
      body={`A product becomes Proven when ${MIN_GROUP * 3}+ people used it for 8 weeks and its lift over non-users stays above zero across its 95% interval.`}
      action={{ label: 'See every product', to: `${sectionPath('products')}${carry}` }}
    />
  )
}

/* ───────────────────────────── key figures ───────────────────────────── */

function Kpis({ d, all, rows, brand, summary }: { d: Insights; all: Products | null; rows: ProductRow[]; brand: string | null; summary: BrandSummary | null }) {
  if (!all) return <SkeletonKpis n={4} />
  const kind = cohortKind(d.cohort)
  const proven = rows.filter((r) => r.tier === 'proven').length
  // A brand's own figures come from the api's brand summary (each person once, as Market shows them); the
  // product rows are the fallback when this api build has no /brands.
  const own = summary ? (summary.rate !== null && summary.n !== null ? { value: summary.rate, n: summary.n } : null) : weighted(rows, 'rate')
  const market = weighted(all.products, 'rate')
  const cont = brand ? (summary ? (summary.cont8 !== null ? { value: summary.cont8, n: null } : null) : weighted(rows, 'cont8')) : null
  const unmet = d.tiles.find((t) => t.label.startsWith('Unmet'))
  const users = brand ? (summary ? summary.users : rows.reduce((s, r) => s + (r.users ?? 0), 0)) : null
  const items: Kpi[] = brand
    ? [
        { id: 'proven', label: 'Proven products', value: String(proven), unit: `of ${rows.length}`, note: `${rows.filter((r) => r.tier === 'promising').length} Promising` },
        {
          id: 'rate',
          label: 'Visible change by week 8',
          value: own ? pct(own.value).replace('%', '') : '—',
          unit: own ? '%' : undefined,
          note: own && market ? `${pts(own.value - market.value)} vs the market’s ${pct(market.value)}` : `Fewer than ${MIN_GROUP} people`,
        },
        { id: 'cont', label: 'Still using at week 8', value: cont ? pct(cont.value).replace('%', '') : '—', unit: cont ? '%' : undefined, note: cont ? (cont.n !== null ? `of ${int(cont.n)} people` : 'of your users at week 8') : `Fewer than ${MIN_GROUP} people` },
        { id: 'users', label: 'People using your products', value: users === null ? '—' : int(users), note: users === null ? `Fewer than ${MIN_GROUP} people` : kind === 'simulated' ? 'Simulated cohort' : kind === 'mixed' ? 'Mostly simulated' : 'Consented users' },
      ]
    : [
        { id: 'proven', label: 'Proven products', value: String(proven), unit: `of ${rows.length}`, note: `${rows.filter((r) => r.tier === 'promising').length} Promising, ${rows.filter((r) => r.rate === null).length} without numbers` },
        { id: 'rate', label: 'Visible change by week 8', value: market ? pct(market.value).replace('%', '') : '—', unit: market ? '%' : undefined, note: 'People-weighted, across measured products' },
        { id: 'unmet', label: 'No visible change yet', value: unmet && unmet.value !== '–' ? unmet.value.replace('%', '') : '—', unit: unmet && unmet.value !== '–' ? '%' : undefined, note: unmet && unmet.value !== '–' ? `of ${int(unmet.n)} people at week ${d.cohort.weeks} have a goal without one` : `Fewer than ${MIN_GROUP} people` },
        { id: 'users', label: kind === 'real' ? 'Consented people' : 'People measured', value: int(d.cohort.synthetic + d.cohort.real), note: kind === 'simulated' ? 'Simulated cohort' : kind === 'mixed' ? `${int(d.cohort.real)} real, the rest simulated` : 'Opted in to sharing' },
      ]
  return <KpiStrip items={items} />
}

/* ───────────────────────────── the brief ───────────────────────────── */

const KIND: Record<BriefCard['kind'], { icon: LucideIcon; tone: string; label: string }> = {
  win: { icon: TrendingUp, tone: 'text-proof-leaf bg-proof-leaf-soft', label: 'Win' },
  risk: { icon: TriangleAlert, tone: 'text-pf-amber bg-pf-amber-soft', label: 'Risk' },
  opportunity: { icon: Lightbulb, tone: 'text-ink bg-sunken', label: 'Opportunity' },
  trend: { icon: TrendingUp, tone: 'text-ink bg-sunken', label: 'Trend' },
  gap: { icon: CircleDashed, tone: 'text-ink bg-sunken', label: 'Gap' },
}

type BriefState = { key: string; status: 'loading' | 'ready' | 'failed'; brief: Brief | null }

function BriefPanel({ brand, className }: { brand: string | null; className?: string }) {
  const { filters } = useRetailData()
  const [attempt, setAttempt] = useState(0)
  const key = `${filters.cohort}|${filters.range}|${brand ?? ''}|${attempt}`
  const [res, setRes] = useState<BriefState>({ key: '', status: 'loading', brief: null })
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const q = { ...filters, ...(brand ? { brand } : {}) }
    // The cards arrive at once; while Gemini is still writing the summary, ask again a few times.
    const poll = (tries: number) => {
      timer = setTimeout(() => {
        retailerBrief(q).then(
          (brief) => {
            if (!alive) return
            setRes((r) => (r.key === key && r.brief ? { ...r, brief: { ...r.brief, summary: brief.summary, summary_pending: brief.summary_pending } } : r))
            if (brief.summary_pending && tries > 1) poll(tries - 1)
          },
          () => undefined,
        )
      }, 3000)
    }
    retailerBrief(q).then(
      (brief) => {
        if (!alive) return
        setRes({ key, status: 'ready', brief })
        if (brief.summary_pending) poll(6)
      },
      () => alive && setRes({ key, status: 'failed', brief: null }),
    )
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const state = res.key === key ? res : { status: 'loading' as const, brief: null }
  const summary = state.brief?.summary
  return (
    <Panel
      title="This week’s brief"
      id="brief-h"
      className={className}
      flush
      description={
        summary ? (
          <span className="flex flex-col gap-1 pt-1">
            <span className="text-proof-body text-ink">{summary.text}</span>
            <span className="flex items-center gap-1 text-proof-label text-ink-3">
              <Sparkles size={12} strokeWidth={1.7} aria-hidden /> Summarised by Gemini from the cards below; every number checked.
            </span>
          </span>
        ) : state.brief?.summary_pending ? (
          <span role="status" className="flex flex-col gap-1.5 pt-1">
            <Bone className="h-3.5 w-[85%]" />
            <span className="text-proof-label text-ink-3">Gemini is summarising the cards…</span>
          </span>
        ) : undefined
      }
    >
      {state.status === 'loading' ? (
        <div role="status" aria-label="Loading the brief" className="flex flex-col">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex h-[72px] items-center gap-3 border-t border-line px-5">
              <Bone className="size-8 rounded-ctl" />
              <div className="flex flex-1 flex-col gap-2">
                <Bone className="h-3.5 w-[60%]" />
                <Bone className="h-3 w-[85%]" />
              </div>
            </div>
          ))}
        </div>
      ) : state.status === 'failed' || !state.brief ? (
        <div className="border-t border-line">
          <EmptyState compact title="The brief didn’t load" body="No cards are shown rather than guessed ones. Everything else on this page comes from the live aggregates.">
            <ToolButton onClick={() => setAttempt((a) => a + 1)}>Retry</ToolButton>
          </EmptyState>
        </div>
      ) : state.brief.cards.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          <AutoReady />
          {state.brief.cards.map((c) => (
            <li key={c.id}>
              <BriefRow c={c} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-t border-line">
          <EmptyState compact title="Nothing stands out yet" body={`No rule found a group of ${MIN_GROUP}+ people that stands out in this filter.`} />
        </div>
      )}
    </Panel>
  )
}

/**
 * "Ready to auto-promote": AutoCampaign proposals waiting for this viewer (their own rules, so not part of the
 * shared brief the api caches). Nothing when there are none or there is no session.
 */
function AutoReady() {
  const { user } = useAuth()
  const { carry } = useRetailState()
  const q = useAutopilot(user?.uid ?? null)
  const waiting = openProposals(q.data?.activity ?? [])
  if (!waiting.length) return null
  const first = waiting[0]
  return (
    <li>
      <Link to={`${sectionPath('campaigns')}${carry}#autocampaign`} className="group grid min-h-[72px] grid-cols-[32px_minmax(0,1fr)_auto_16px] items-center gap-3 border-t border-line px-5 py-3 no-underline transition-colors hover:bg-pf-hover">
        <span className="grid size-8 place-items-center rounded-ctl bg-proof-leaf-soft text-proof-leaf" title="Ready">
          <Megaphone size={15} strokeWidth={1.8} aria-hidden />
          <span className="sr-only">Ready: </span>
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-proof-body font-medium text-ink">Ready to auto-promote</span>
          <span className="line-clamp-1 text-proof-small text-ink-2" title={first.text}>
            {first.rule_name ? `${first.rule_name}: ` : ''}
            {first.text.replace(/^Proposed: /, '')}
          </span>
        </span>
        <span className="flex flex-col items-end">
          <span className="text-proof-h text-ink tnum">{waiting.length}</span>
          <span className="text-proof-label text-ink-3">to review</span>
        </span>
        <ChevronRight size={16} strokeWidth={1.6} aria-hidden className="text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
      </Link>
    </li>
  )
}

function BriefRow({ c }: { c: BriefCard }) {
  const { carry } = useRetailState()
  const k = KIND[c.kind]
  const Icon = k.icon
  const fig = cardFigure(c)
  return (
    <Link to={briefHref(c, carry)} className="group grid min-h-[72px] grid-cols-[32px_minmax(0,1fr)_auto_16px] items-center gap-3 border-t border-line px-5 py-3 no-underline transition-colors hover:bg-pf-hover">
      <span className={`grid size-8 place-items-center rounded-ctl ${k.tone}`} title={k.label}>
        <Icon size={15} strokeWidth={1.8} aria-hidden />
        <span className="sr-only">{k.label}: </span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-proof-body font-medium text-ink" title={c.title}>
          {c.title}
        </span>
        <span className="line-clamp-1 text-proof-small text-ink-2" title={c.body}>
          {c.body}
        </span>
      </span>
      <span className="flex flex-col items-end">
        {fig ? (
          <span className="flex items-baseline gap-1 whitespace-nowrap">
            <span className="text-proof-h text-ink tnum">{fig.value}</span>
            {fig.unit ? <span className="text-proof-small text-ink-2">{fig.unit}</span> : null}
          </span>
        ) : null}
        {c.n ? <span className="text-proof-label text-ink-3 tnum">n={int(c.n)}</span> : null}
      </span>
      <ChevronRight size={16} strokeWidth={1.6} aria-hidden className="text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
    </Link>
  )
}

/* ───────────────────────────── top products ───────────────────────────── */

function TopProducts({ rows, brand, className }: { rows: ProductRow[]; brand: string | null; className?: string }) {
  const { carry } = useRetailState()
  const top = rows
    .filter((r) => r.lift !== null)
    .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0))
    .slice(0, 6)
  return (
    <Panel
      title={brand ? 'Your products' : 'Top products'}
      id="top-h"
      className={className}
      flush
      description="By lift over non-users with the same goals."
      actions={
        <Link to={`${sectionPath('products')}${carry}`} className="inline-flex items-center gap-1 text-proof-small text-ink-2 no-underline hover:text-ink">
          View all <ArrowRight size={14} strokeWidth={1.6} aria-hidden />
        </Link>
      }
    >
      {top.length ? (
        <ol className="m-0 flex list-none flex-col p-0">
          {top.map((r) => (
            <li key={r.product_id}>
              <Link to={`${sectionPath('products', r.product_id)}${carry}`} className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-5 py-2 no-underline transition-colors hover:bg-pf-hover">
                <span className="flex min-w-0 items-center gap-3">
                  <ProductImage product={{ image_url: r.image_url, category: r.category, name: r.product }} size={32} decorative />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-proof-body font-medium text-ink">{r.product}</span>
                    <span className="flex items-center gap-1.5 truncate text-proof-label text-ink-2">
                      <TierDot tier={r.tier} />
                      {brand ? r.category_label : r.brand} · {pct(r.rate)} of {int(r.n)}
                    </span>
                  </span>
                </span>
                <span className={`text-proof-body font-semibold tnum ${(r.lift ?? 0) > 0 ? 'text-proof-leaf' : 'text-ink-2'}`}>{pts(r.lift)}</span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className="border-t border-line">
          <EmptyState compact title="No measured products yet" body={`Products appear once ${MIN_GROUP} or more people used them for 8 weeks.`} />
        </div>
      )}
    </Panel>
  )
}

/* ───────────────────────────── about ───────────────────────────── */

function About({ d }: { d: Insights }) {
  const kind = cohortKind(d.cohort)
  const items = [
    {
      k: 'Who is counted',
      v:
        kind === 'real'
          ? `${d.cohort.real} real people who opted in to anonymised sharing. Small, so many groups fall below the threshold.`
          : `${int(d.cohort.synthetic)} simulated people${d.cohort.real ? ` and ${d.cohort.real} real people who opted in` : ''}, who started in August, September or October with one to three goals, a routine of real catalogue products and a reading every week up to today; ${Math.round(d.cohort.dropout * 100)}% stopped early. Fixed seed (${d.cohort.seed}), so the numbers are reproducible.`,
    },
    { k: 'Visible change', v: `A person counts when a goal measure is still beyond their own photo noise band at the week-${d.cohort.weeks} reading, in the desired direction. One lucky reading earlier does not count.` },
    { k: 'Small groups', v: `Any group with fewer than ${MIN_GROUP} people is withheld by the api, so also in charts, tables, exports and answers.` },
    { k: 'What it is not', v: 'Outcomes are associations with product use, not proof of cause: people chose their own products. In the simulation each product moves its measures by 0.2 to 1.1 times the noise band; about 3 in 10 have no effect.' },
    { k: 'Simulated assumptions', v: 'About half of the people who stop a product start another in the same category within 2 weeks, leaning toward products that work for others; effect size varies by skin type (oil control on oily and combination skin, barrier care on dry and sensitive skin).' },
    { k: 'Consent and privacy', v: `Aggregates only. Real people are included only after a separate opt-in. Groups under ${MIN_GROUP} are hidden, including cells that would let a hidden count be worked out. No images or per-person rows leave Willow.` },
  ]
  return (
    <details className="group rounded-card border border-line bg-surface">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 text-proof-body font-medium text-ink [&::-webkit-details-marker]:hidden">
        About this data
        <ChevronRight size={16} strokeWidth={1.6} aria-hidden className="text-ink-2 transition-transform group-open:rotate-90" />
      </summary>
      <div className="flex flex-col gap-5 border-t border-line px-5 py-5">
        <dl className="m-0 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <div key={p.k} className="flex flex-col gap-1">
              <dt className="text-proof-small font-medium text-ink">{p.k}</dt>
              <dd className="m-0 text-proof-small text-ink-2">{p.v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <Disclaimer />
          <a href={DATA_STUDIO} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-proof-small text-ink-2 hover:text-ink">
            Same aggregates in Looker Studio
            <ArrowUpRight size={14} strokeWidth={1.6} aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </details>
  )
}
