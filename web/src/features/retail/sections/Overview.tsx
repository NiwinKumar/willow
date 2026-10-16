import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Disclaimer } from '../../../components/willow/Disclaimer'
import { retailerBrief } from '../../../lib/api'
import { useRetailData } from '../context'
import { DATA_STUDIO, outcomes, totalUsers } from '../data'
import { sectionPath, useRetailState } from '../state'
import type { Brief, BriefCard, Insights } from '../types'
import { Bone, cohortKind, EmptyState, EvidenceBar, int, KpiStrip, MIN_GROUP, Panel, pct, pts, SectionHeader, SimBadge, SkeletonHeader, SkeletonKpis, SkeletonPanel, Term, ToolButton, weeks, type Kpi } from '../ui'
import { briefHref, cardFigure } from '../ui/insight'
import { InsightsGate, useWorkspaceLabel, YoursTag } from './shared'

/** Overview: the brief (insight cards from GET /v1/retailer/brief), the KPI strip and the headline lists. */
export default function Overview() {
  return (
    <InsightsGate
      skeleton={
        <div className="flex flex-col gap-4">
          <SkeletonHeader />
          <SkeletonPanel height={300} />
          <SkeletonKpis n={5} />
        </div>
      }
    >
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function Body({ d }: { d: Insights }) {
  const { workspace } = useRetailData()
  const eyebrow = useWorkspaceLabel()
  const brand = workspace.kind === 'brand' ? workspace.brand : null
  const catalog = d.kpis?.catalog ?? null
  const unmet = d.tiles.find((t) => t.label.startsWith('Unmet'))
  const top = d.tiles.find((t) => t.label === 'Top goal')
  const mine = brand ? outcomes(d).filter((o) => o.brand === brand) : []
  const answer = brand ? (
    mine.length ? (
      <>
        <strong>{brand}</strong> has <strong>{mine.length}</strong> {mine.length === 1 ? 'product' : 'products'} with measured outcomes (10+ people at week {d.cohort.weeks}); the market’s numbers below are the comparison.
      </>
    ) : (
      <>
        No {brand} product has {MIN_GROUP} or more people at week {d.cohort.weeks} in this filter yet; the market’s numbers are below.
      </>
    )
  ) : (
    <>
      {catalog ? (
        <>
          <strong>{catalog.with_outcomes}</strong> of {catalog.products} catalogue products have measured outcomes.{' '}
        </>
      ) : null}
      {top ? (
        <>
          <strong>{top.value}</strong> is the most-chosen goal ({top.sub}).{' '}
        </>
      ) : null}
      {unmet && unmet.value !== '–' ? (
        <>
          <strong>{unmet.value}</strong> of people at week {d.cohort.weeks} have no <Term id="real_change">real change</Term> in a goal metric yet.
        </>
      ) : null}
    </>
  )
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader eyebrow={eyebrow} title="Overview" answer={answer} />
      <BriefPanel brand={brand} d={d} />
      <Kpis d={d} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 min-[1400px]:grid-cols-3">
        <TopProducts d={d} brand={brand} className="lg:col-span-2 min-[1400px]:col-span-1" />
        <GoalsPanel d={d} />
        <ConflictsMini d={d} />
      </div>
      <About d={d} />
    </div>
  )
}

/* ───────────────────────────── KPIs ───────────────────────────── */

function Kpis({ d }: { d: Insights }) {
  const kind = cohortKind(d.cohort)
  const active = d.tiles.find((t) => t.label === 'Active users')
  const unmet = d.tiles.find((t) => t.label.startsWith('Unmet'))
  const catalog = d.kpis?.catalog ?? null
  const cont = d.kpis?.continuation_wk8 ?? null
  const goal = d.needs.find((n) => n.weeks !== null && n.weeks !== undefined)
  const hidden = catalog ? [catalog.below_min ? `${catalog.below_min} under n=${MIN_GROUP}` : '', catalog.not_measured ? `${catalog.not_measured} not measured` : '', catalog.unused ? `${catalog.unused} unused` : ''].filter(Boolean).join(' · ') : ''
  const items: Kpi[] = [
    {
      id: 'users',
      // Simulated people never consented to anything: only real rows are "consented users".
      label: kind === 'simulated' ? 'Simulated users' : kind === 'real' ? 'Consented users' : 'Users',
      value: int(totalUsers(d.cohort)),
      unit: kind === 'simulated' ? 'synthetic' : undefined,
      note: active && active.value !== '–' ? `${int(active.n)} reached week ${d.cohort.weeks}` : `Fewer than ${MIN_GROUP} at week ${d.cohort.weeks}`,
    },
    {
      id: 'products',
      label: 'Products with outcomes',
      value: String(catalog?.with_outcomes ?? Object.keys(d.product_outcomes ?? {}).length),
      unit: catalog ? `of ${catalog.products}` : undefined,
      note: hidden || `Each with ${MIN_GROUP}+ people at week ${d.cohort.weeks}`,
    },
    {
      id: 'unmet',
      label: <>No real change yet</>,
      value: unmet && unmet.value !== '–' ? unmet.value.replace('%', '') : '—',
      unit: unmet && unmet.value !== '–' ? '%' : undefined,
      note: unmet && unmet.value !== '–' ? `of ${int(unmet.n)} people at week ${d.cohort.weeks}` : `Fewer than ${MIN_GROUP} people`,
    },
    goal
      ? { id: 'weeks', label: 'Median time to change', value: String(goal.weeks), unit: 'weeks', note: `${goal.goal} goal · n=${goal.weeks_n}` }
      : { id: 'weeks', label: 'Median time to change', value: '—', note: `Fewer than ${MIN_GROUP} changed in any goal` },
    cont
      ? { id: 'cont', label: <>Continuation at week {d.cohort.weeks}</>, value: String(Math.round(cont.rate * 100)), unit: '%', note: `${int(cont.k)} of ${int(cont.n)} people` }
      : { id: 'cont', label: <>Continuation at week {d.cohort.weeks}</>, value: '—', note: `Fewer than ${MIN_GROUP} people` },
  ]
  return <KpiStrip items={items} label="Key figures for this filter" />
}

/* ───────────────────────────── the brief ───────────────────────────── */

const KIND: Record<BriefCard['kind'], { glyph: string; label: string }> = {
  win: { glyph: '●', label: 'Win' },
  risk: { glyph: '▲', label: 'Risk' },
  opportunity: { glyph: '◇', label: 'Opportunity' },
  trend: { glyph: '↗', label: 'Trend' },
  gap: { glyph: '◌', label: 'Gap' },
}

type BriefState = { key: string; status: 'loading' | 'ready' | 'failed'; brief: Brief | null }

function BriefPanel({ brand, d, className }: { brand: string | null; d: Insights; className?: string }) {
  const { filters } = useRetailData()
  const { carry } = useRetailState()
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
  return (
    <Panel title="This week’s brief" id="brief-h" meta={<SimBadge cohort={d.cohort} />} className={className} footnote={state.status === 'ready' ? (brand ? `Each card is a fixed rule over the aggregates (best and weakest goal against the market, switching, top product, what can be promoted, continuation). Open a card for the exact view.` : 'Each card is a fixed rule over the aggregates (top proven product, biggest lift by skin type, continuation risk, rising goal, largest gap, most common conflict). Open a card for the exact view.') : undefined}>
      {state.status === 'loading' ? (
        <div role="status" aria-label="Loading the brief" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex h-[132px] flex-col gap-2.5 rounded-xs border border-line p-3.5">
              <Bone className="h-2.5 w-20" />
              <Bone className="h-3.5 w-[80%]" />
              <Bone className="h-3 w-full" />
              <Bone className="mt-auto h-5 w-24" />
            </div>
          ))}
        </div>
      ) : state.status === 'failed' || !state.brief ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 max-w-[80ch] flex-col gap-0.5">
            <span className="text-proof-h font-medium text-ink">Brief unavailable</span>
            <span className="text-proof-body text-ink-2">The brief service didn’t answer, so no cards are shown rather than guessed ones. Everything else on this page comes straight from the live aggregates.</span>
          </div>
          <div className="flex shrink-0 gap-2">
            <ToolButton onClick={() => setAttempt((a) => a + 1)}>Retry</ToolButton>
            <Link to={`${sectionPath('products')}${carry}`} className="hit44 inline-flex h-8 items-center gap-1 rounded-xs border border-line-strong px-2.5 text-proof-small text-ink no-underline hover:bg-glass">
              Open products <ArrowRight size={13} strokeWidth={1.6} aria-hidden />
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {state.brief.summary ? (
            <div className="flex max-w-[110ch] flex-col gap-0.5">
              <p className="m-0 text-proof-body text-ink-2">
                <span className="font-medium text-ink">In short: </span>
                {state.brief.summary.text}
              </p>
              <span className="text-[11px] text-ink-2">Written by Gemini from the cards below; numbers checked.</span>
            </div>
          ) : state.brief.summary_pending ? (
            <div role="status" aria-label="Gemini is writing a short summary of the cards" className="flex max-w-[110ch] flex-col gap-1.5">
              <Bone className="h-3 w-[70%]" />
              <span className="text-[11px] text-ink-2">Gemini is writing a short summary of the cards…</span>
            </div>
          ) : null}
          {state.brief.cards.length ? (
            <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
              {state.brief.cards.map((c) => (
                <li key={c.id} className="contents">
                  <BriefCardView c={c} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact title="Nothing stands out yet" body={`No rule found a group of ${MIN_GROUP}+ people that stands out in this filter.`} />
          )}
        </div>
      )}
    </Panel>
  )
}

const SECTION_LABEL: Record<BriefCard['link']['section'], string> = {
  products: 'Products',
  categories: 'Categories',
  segments: 'Skin profiles',
  competitors: 'Competitors',
  demand: 'Demand',
  promote: 'Promote',
}

function BriefCardView({ c }: { c: BriefCard }) {
  const { carry } = useRetailState()
  const k = KIND[c.kind]
  const fig = cardFigure(c)
  return (
    <Link to={briefHref(c, carry)} className="group flex min-h-[132px] flex-col gap-1.5 rounded-xs border border-line bg-sunken p-3.5 no-underline transition-colors duration-150 hover:border-line-strong hover:bg-glass">
      <span className="flex items-center gap-1.5 text-proof-small text-ink-2">
        <span aria-hidden className={c.kind === 'win' ? 'text-proof-leaf' : 'text-ink-2'}>
          {k.glyph}
        </span>
        {k.label}
      </span>
      <span className="line-clamp-2 text-proof-h font-medium text-ink" title={c.title}>
        {c.title}
      </span>
      <span className="line-clamp-2 text-proof-body text-ink-2">{c.body}</span>
      <span className="mt-auto flex items-end justify-between gap-2 pt-1">
        <span className="flex items-baseline gap-1">
          {fig ? <span className="font-mono text-[20px] leading-none text-ink tnum">{fig.value}</span> : null}
          {fig?.unit ? <span className="text-proof-small text-ink-2">{fig.unit}</span> : null}
          {c.n ? <span className="ml-1.5 font-mono text-[11px] text-ink-2 tnum">n={int(c.n)}</span> : null}
        </span>
        <span className="flex items-center gap-1 text-proof-small text-ink-2 group-hover:text-ink">
          {SECTION_LABEL[c.link.section]}
          <ArrowRight size={13} strokeWidth={1.6} aria-hidden />
        </span>
      </span>
    </Link>
  )
}

/* ───────────────────────────── headline lists ───────────────────────────── */

function TopProducts({ d, brand, className }: { d: Insights; brand: string | null; className?: string }) {
  const { carry } = useRetailState()
  const all = outcomes(d)
  // Highest lift over non-users first (rate alone favours goals that change easily); products without a base last.
  const rows = [...all].sort((a, b) => (b.lift ?? -9) - (a.lift ?? -9) || b.n - a.n).slice(0, 7)
  return (
    <Panel
      title="Largest lift over non-users"
      id="top-h"
      className={className}
      actions={
        <Link to={`${sectionPath('products')}${carry}`} className="inline-flex h-8 items-center gap-1 rounded-xs px-2 text-proof-small text-ink-2 no-underline hover:bg-glass hover:text-ink">
          All {all.length} <ArrowRight size={13} strokeWidth={1.6} aria-hidden />
        </Link>
      }
      footnote={
        <>
          Ember dot: share of users with a <Term id="real_change">real change</Term> by week {d.cohort.weeks}; tick: <Term id="base_rate">non-users</Term> with the same goal.
        </>
      }
      flush
    >
      <ol className="m-0 flex list-none flex-col p-0">
        {rows.map((r, i) => {
          const base = r.lift !== null && r.lift !== undefined ? Math.max(0, r.rate - r.lift) : null
          return (
            <li key={r.product_id} className="border-b border-line last:border-b-0">
              <Link to={`${sectionPath('products')}${carry}${carry ? '&' : '?'}product=${encodeURIComponent(r.product_id)}`} className="grid grid-cols-[18px_minmax(0,1fr)_minmax(96px,40%)] items-center gap-2.5 px-4 py-2 no-underline hover:bg-glass">
                <span className="font-mono text-[11px] text-ink-2 tnum">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-proof-body text-ink">{r.product}</span>
                  <span className="block truncate text-proof-small text-ink-2">
                    {r.brand}
                    {brand === r.brand ? <YoursTag /> : null}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="font-mono text-proof-small text-ink tnum">
                    {pct(r.rate)}
                    <span className="text-ink-2"> · {pts(r.lift)}</span>
                  </span>
                  <EvidenceBar rate={r.rate} base={base} n={r.n} showN={false} className="w-full" />
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

function GoalsPanel({ d }: { d: Insights }) {
  const { carry } = useRetailState()
  const rows = d.needs.slice(0, 8)
  const max = Math.max(1, ...rows.map((r) => r.n))
  return (
    <Panel
      title="Goals customers chose"
      id="goals-h"
      meta={<SimBadge cohort={d.cohort} />}
      actions={
        <Link to={`${sectionPath('demand')}${carry}`} className="inline-flex h-8 items-center gap-1 rounded-xs px-2 text-proof-small text-ink-2 no-underline hover:bg-glass hover:text-ink">
          Demand <ArrowRight size={13} strokeWidth={1.6} aria-hidden />
        </Link>
      }
      footnote={`People choosing each goal (up to 3 each) and, of them, the share with a real change by week ${d.cohort.weeks}. Median weeks among those who changed; hidden under ${MIN_GROUP}.`}
      flush
    >
      <table className="w-full border-collapse text-proof-body">
        <caption className="sr-only">Goals by people choosing them</caption>
        <thead>
          <tr className="text-proof-small text-ink-2">
            <th scope="col" className="h-8 px-4 text-left font-normal">Goal</th>
            <th scope="col" className="w-[30%] px-2 text-left font-normal">People</th>
            <th scope="col" className="whitespace-nowrap px-2 text-right font-normal">Real change</th>
            <th scope="col" className="px-4 text-right font-normal">Median</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.goal} className="border-t border-line">
              <th scope="row" className="h-9 whitespace-nowrap px-4 text-left font-normal text-ink">{r.goal}</th>
              <td className="px-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="block h-1.5 min-w-0 flex-1 rounded-pill">
                    <span className="block h-full rounded-pill bg-ink/70" style={{ width: `${(r.n / max) * 100}%` }} />
                  </span>
                  <span className="w-9 shrink-0 text-right font-mono text-proof-small text-ink-2 tnum">{int(r.n)}</span>
                </span>
              </td>
              <td className="px-2 text-right font-mono tnum">{r.real}%</td>
              <td className="px-4 text-right font-mono tnum text-ink-2">{weeks(r.weeks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function ConflictsMini({ d }: { d: Insights }) {
  const { carry } = useRetailState()
  const rows = d.conflicts.slice(0, 5)
  const checked = d.routines_checked ?? totalUsers(d.cohort)
  const max = Math.max(0.01, ...rows.map((c) => c.share))
  return (
    <Panel
      title="Routine findings"
      id="conflicts-mini-h"
      meta={<SimBadge cohort={d.cohort} />}
      actions={
        <Link to={`${sectionPath('demand')}${carry}#conflicts`} className="inline-flex h-8 items-center gap-1 rounded-xs px-2 text-proof-small text-ink-2 no-underline hover:bg-glass hover:text-ink">
          Details <ArrowRight size={13} strokeWidth={1.6} aria-hidden />
        </Link>
      }
      footnote={`Share of the ${int(checked)} routines checked, from the app’s fixed rule table. An education and cross-sell opportunity, not a judgement.`}
    >
      {rows.length === 0 ? (
        <EmptyState compact title="No common findings" body={`No finding appears in ${MIN_GROUP} or more routines.`} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rows.map((c) => (
            <li key={c.pair} className="grid grid-cols-[minmax(0,1fr)_minmax(64px,30%)_40px] items-center gap-3">
              <span className="text-proof-body leading-snug text-ink">{c.pair}</span>
              <span aria-hidden className="block h-1.5 rounded-pill bg-muted">
                <span className="block h-full rounded-pill bg-ink/70" style={{ width: `${(c.share / max) * 100}%` }} />
              </span>
              <span className="text-right font-mono text-proof-small tnum">{pct(c.share)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ───────────────────────────── about the data ───────────────────────────── */

function About({ d }: { d: Insights }) {
  const kind = cohortKind(d.cohort)
  const items = [
    {
      k: 'Cohort',
      v:
        kind === 'real'
          ? `${d.cohort.real} real people who opted in to anonymised sharing. Small, so many groups fall below the threshold.`
          : `${int(d.cohort.synthetic)} synthetic people${d.cohort.real ? ` and ${d.cohort.real} real people who opted in` : ''}, who started in August, September or October with one to three goals, a routine of real catalogue products and a reading every week up to today; ${Math.round(d.cohort.dropout * 100)}% stopped early. Fixed seed (${d.cohort.seed}), so the numbers are reproducible.${d.cohort.real ? '' : ' No real customer is represented.'}`,
    },
    { k: 'Real change', v: `A person counts when a goal metric is still beyond their own photo noise band at the week-${d.cohort.weeks} reading, in the desired direction. One lucky reading earlier does not count.` },
    { k: 'Suppression', v: `Any group with fewer than ${MIN_GROUP} people is withheld in the api, so also in charts, tables, exports and answers.` },
    {
      k: 'Assumptions',
      v: 'Outcomes are associations with product use, not proof of effect: people chose their own products and groups are not randomised. In the simulation each product moves its target metrics by 0.2 to 1.1 times the noise band, about 3 in 10 have no effect, and tone band, skin type and region have no effect.',
    },
    {
      k: 'Switching and skin profiles',
      v: "Two further invented assumptions demonstrate the switching and skin-profile views: about half of the people who stop a product start another in the same category within 2 weeks, leaning strongly toward products that work for others and are popular, and a product's effect size varies by skin type (oil-control products work better on oily and combination skin, barrier and gentle hydrating products on dry and sensitive skin, strong retinoids and acids less on sensitive skin).",
    },
    {
      k: 'Consent and privacy',
      v: `Aggregates only. Real people are included only after a separate opt-in to anonymised sharing. Groups under ${MIN_GROUP} are hidden, including complementary cells that would let a hidden count be worked out. No images or per-person rows ever leave Willow.`,
    },
  ]
  return (
    <details className="group rounded-sm border border-line bg-surface">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-proof-h font-medium text-ink [&::-webkit-details-marker]:hidden">
        About this data
        <span className="text-proof-small font-normal text-ink-2 group-open:hidden">Cohort, method, suppression, assumptions, consent</span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
        <dl className="m-0 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <div key={p.k} className="flex flex-col gap-1">
              <dt className="eyebrow">■ {p.k}</dt>
              <dd className="m-0 text-proof-body text-ink-2">{p.v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <Disclaimer />
          <a href={DATA_STUDIO} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-proof-small text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            The same aggregates as a Data Studio report
            <ArrowUpRight size={13} strokeWidth={1.6} aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </details>
  )
}
