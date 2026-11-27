import { CheckCircle2, History, Mail } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { agoText } from '../autopilot'
import { useRetailData } from '../context'
import { kindOfKey, laneOf, type DecisionCard } from '../decisions'
import { campaignTotals, demandTrends, pooledRate, portfolio, risingGoal, weekBrief } from '../home/dashboard'
import { AnswerItem, BriefPanel, CardView, LiveCampaign, ProgressItem, type Brief } from '../home/Cards'
import { GuideChip, GuidePanel, useGuide } from '../home/Guide'
import { campaignsFor, DemandPanel, FunnelPanel, KpiBand, marks, portfolioNote, type Tile } from '../home/Pulse'
import { DecisionLog, Requests } from '../home/Requests'
import { useHomeCards } from '../homeData'
import { useOrg } from '../org'
import { useDecide } from '../orgData'
import { spotlightOf } from '../productModel'
import { canAct, ROLE_LABEL, type DecisionLogEntry } from '../proofApi'
import { homeScope, statusOf } from '../range'
import { rangeIds } from '../rangeStore'
import { sectionPath, useRetailState } from '../state'
import type { Insights, ProductRow } from '../types'
import { Bone, BrandLogo, Button, int, pct, pts, SidePanel, SkeletonPanel } from '../ui'
import { topUnmet } from '../ui/insight'
import { Spotlight } from './Overview'
import { InsightsGate } from './shared'

/*
 * Home: the organisation's dashboard, decision first (research/finals/06 §6.4; owner feedback Nov 27).
 *
 * The person came to learn what needs them and how their products are doing. Top to bottom:
 * 1. The organisation (logo, name) and "This week for CeraVe": two or three sentences written in code from the
 *    figures below (never Gemini), so the page can be read in one line.
 * 2. "What needs you today": the top three decisions as full cards, each with one primary action (filled) and a
 *    quiet secondary; Ask about this on each. The first card is raised. Nothing to decide → a calm done state.
 * 3. The KPI band, per role. Brand: products measured, Proof score (share Proven, ring), visible change vs the
 *    market (delta), campaigns (best lift, reach, daily sparkline). Retailer: range coverage, Proof score, the
 *    least-served group, campaigns. Each tile opens the section behind it.
 * 4. Two panels that earn their place: what people come for by month (a brand's own goals lead), and the
 *    campaign funnel (reach → clicks → adds → lift vs holdout).
 * 5. The lanes: more to decide, in progress, results. Then evidence requests and (brands) the strongest proof.
 * One click away: Weekly digest, Decision log (side panel), a brief (side panel to read, copy or save), Ask.
 * The first-run guide folds into a header chip once two of its four steps are done.
 *
 * Four tests (new: brief line, priority strip, KPI marks, demand and funnel panels, Ask about this, brief panel)
 * are in each file's header (home/*.tsx); the brief line passes all four: it states only the data's numbers (1),
 * plain sentences (2), sits where the description was (3), kit type (4).
 */

const PRIORITY = 3

export default function Home() {
  return (
    <InsightsGate skeleton={<HomeSkeleton />}>
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div aria-hidden className="flex items-start gap-4">
        <Bone className="size-10 shrink-0 rounded-[10px]" />
        <div className="flex flex-1 flex-col gap-2">
          <Bone className="h-7 w-56" />
          <Bone className="h-4 w-[min(620px,90%)]" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonPanel height={208} />
        <SkeletonPanel height={208} />
        <SkeletonPanel height={208} />
      </div>
      <SkeletonPanel height={116} />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <SkeletonPanel height={300} />
        </div>
        <div className="lg:col-span-5">
          <SkeletonPanel height={300} />
        </div>
      </div>
    </div>
  )
}

function Body({ d }: { d: Insights }) {
  const { carry, param, setParam } = useRetailState()
  const { org, role, orgs } = useOrg()
  const { mix, brand, rows, prodState, campaigns, shelf, decisions, requests, range, cards, segments } = useHomeCards(d)
  const decide = useDecide()
  const [showAll, setShowAll] = useState(false)
  const [brief, setBrief] = useState<Brief | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const { brands } = useRetailData()

  const items = decisions.data?.items ?? {}
  const decide_ = cards.filter((c) => c.lane === 'decide' && laneOf(items[c.key]) === 'decide')
  const resultCards = cards.filter((c) => c.lane === 'result' && laneOf(items[c.key]) === 'decide')
  const accepted = Object.entries(items).filter(([, v]) => v.status === 'accepted')
  const done = Object.entries(items)
    .filter(([, v]) => v.status === 'done')
    .sort((a, b) => (b[1].updated_at ?? '').localeCompare(a[1].updated_at ?? ''))
    .slice(0, 3)
  const outbox = requests.data?.outbox ?? []
  const inbox = requests.data?.inbox ?? []
  const live = campaigns.filter((c) => c.status === 'active' && !c.stats.incrementality && (!brand || c.brand === brand))
  const sentOpen = outbox.filter((r) => r.status === 'open')
  const answered = outbox.filter((r) => r.status !== 'open')
  const inProgressN = accepted.length + live.length + sentOpen.length
  const resultsN = resultCards.length + answered.length + done.length
  const priority = decide_.slice(0, PRIORITY)
  const rest = decide_.slice(PRIORITY)
  const restShown = showAll ? rest : rest.slice(0, 4)
  const loadingCards = prodState.status === 'loading' || (mix === 'retailer' && shelf.status === 'loading' && !shelf.data)
  const canDecide = canAct(role) || !org

  const snapshotOf = (c: DecisionCard) => ({ title: c.title.slice(0, 200), figure: `${c.figure} ${c.figureNote}`.trim().slice(0, 120), n: c.n })
  const logByKey = useMemo(() => {
    const m = new Map<string, DecisionLogEntry>()
    for (const e of decisions.data?.log ?? []) if (e.snapshot && !m.has(e.key)) m.set(e.key, e)
    return m
  }, [decisions.data])

  // ── the figures (home/dashboard.ts, tested)
  const ids = rangeIds(range)
  const { rows: inScope, scope } = homeScope(rows, ids, brand)
  const p = portfolio(inScope)
  const rate = pooledRate(inScope)
  const market = pooledRate(rows)
  const own = campaignsFor(campaigns, brand)
  const camp = campaignTotals(own)
  const focusGoals = useMemo(() => new Set(brand ? rows.filter((r) => r.brand === brand).flatMap((r) => r.goal_ids) : []), [rows, brand])
  const demand = useMemo(() => demandTrends(d.needs_by_month, focusGoals), [d.needs_by_month, focusGoals])
  const unmet = segments.status === 'ready' && segments.data ? (topUnmet(segments.data, 1)[0] ?? null) : null
  const name = org?.kind === 'brand' ? (brand ?? org.name) : (org?.name ?? brand ?? 'Your range')
  const sentences = weekBrief({ mix, name: mix === 'brand' ? (brand ?? name) : name, p, rate, market, rising: risingGoal(demand.rows), camp })

  const guide = useGuide({ mix, rangeConnected: Boolean(range) || mix === 'brand', decided: Object.keys(items).length > 0, campaigns: campaigns.length > 0 })
  const ask = (q: string) => setParam({ ask: '1', q }, { push: true })
  const promoteTo = `${sectionPath('campaigns')}${carry}`
  const brandSummary = brand ? (brands.find((b) => b.brand === brand)?.summary ?? null) : null

  const proofScore = p.measured ? p.proven / p.measured : null
  const campaignTile: Tile = camp.count
    ? {
        id: 'campaigns',
        label: camp.best ? 'Best campaign lift' : 'Campaigns',
        value: camp.best ? pts(camp.best.lift).replace(' pts', '') : int(camp.count),
        unit: camp.best ? 'pts vs holdout' : camp.live ? `${int(camp.live)} live` : 'run',
        note: `${camp.best?.sample ? 'Sample campaign · ' : ''}${int(camp.reach)} people reached · ${int(camp.adds)} adds`,
        mark: camp.daily.length > 1 ? marks.spark(camp.daily.map((x) => x.impressions), `Impressions per day over ${camp.daily.length} days, latest ${int(camp.daily.at(-1)?.impressions)}`) : undefined,
        to: promoteTo,
      }
    : { id: 'campaigns', label: 'Campaigns', value: '0', unit: 'running', note: p.proven ? 'A Proven product is ready to promote' : 'Promote once a product is Proven', to: promoteTo }
  const tiles: Tile[] =
    mix === 'brand'
      ? [
          { id: 'measured', label: 'Products measured', value: int(p.measured), unit: `of ${int(p.total)}`, note: portfolioNote(p), mark: marks.meter(p.total ? p.measured / p.total : null, `${p.measured} of ${p.total} products measured`), to: `${sectionPath('products')}${carry}` },
          { id: 'proven', label: 'Proof score', value: int(p.proven), unit: p.proven === 1 ? 'Proven' : 'Proven', note: p.measured ? `of ${int(p.measured)} measured${p.promising ? ` · ${int(p.promising)} Promising` : ''}` : 'Nothing measured yet', mark: marks.ring(proofScore, `Proof score: ${p.proven} of ${p.measured} measured products are Proven`), to: `${sectionPath('products')}${carry}` },
          {
            id: 'rate',
            label: 'Visible change',
            value: rate ? pct(rate.rate) : '—',
            unit: rate ? `n=${int(rate.n)}` : undefined,
            note: market ? `Market ${pct(market.rate)} over ${int(market.products)} products` : 'No measured products yet',
            delta: rate && market ? { text: pts(rate.rate - market.rate), tone: rate.rate - market.rate > 0.005 ? 'up' : rate.rate - market.rate < -0.005 ? 'down' : 'flat', title: `${brand ?? name}: pooled over ${rate.products} measured ${rate.products === 1 ? 'product' : 'products'}, against every measured product in the catalog (n=${int(market.n)}).` } : null,
            to: `${sectionPath('market')}${carry}`,
          },
          campaignTile,
        ]
      : [
          { id: 'coverage', label: scope === 'range' ? 'Range measured' : 'Catalog measured', value: p.total ? pct(p.measured / p.total) : '—', note: `${int(p.measured)} of ${int(p.total)} ${scope === 'range' ? 'in your range' : 'in the catalog'} · ${portfolioNote(p)}`, mark: marks.meter(p.total ? p.measured / p.total : null, `${p.measured} of ${p.total} products measured`), to: `${sectionPath('range')}${carry}` },
          { id: 'proven', label: 'Proof score', value: int(p.proven), unit: 'Proven', note: p.measured ? `of ${int(p.measured)} measured${p.promising ? ` · ${int(p.promising)} Promising` : ''}` : 'Nothing measured yet', mark: marks.ring(proofScore, `Proof score: ${p.proven} of ${p.measured} measured products are Proven`), to: `${sectionPath('products')}${carry}` },
          unmet
            ? { id: 'unmet', label: 'Least-served group', value: pct(unmet.unmet), unit: 'no change yet', note: `${unmet.skinLabel} skin · ${unmet.goalLabel.toLowerCase()} · n=${int(unmet.users)}`, to: `${sectionPath('customers')}${carry}` }
            : { id: 'people', label: 'People measured', value: int(d.needs_by_month?.people.at(-1) ?? null), unit: 'this month', note: 'with a reading', mark: d.needs_by_month ? marks.spark(d.needs_by_month.people, 'People with a reading per month', 'ink') : undefined, to: `${sectionPath('customers')}${carry}` },
          campaignTile,
        ]

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-4">
          {org ? <BrandLogo brand={name} src={org.kind === 'brand' ? org.logo_url : org.logo_url} kind={org.kind} size={44} className="mt-0.5" /> : null}
          <div className="flex min-w-0 max-w-[700px] flex-col gap-1.5">
            <h1 className="m-0 flex flex-wrap items-baseline gap-x-2.5 text-proof-title text-ink [text-wrap:balance]">
              {name}
              <span className="text-proof-body font-normal text-ink-2">This week</span>
            </h1>
            {loadingCards ? (
              <span aria-hidden className="flex flex-col gap-1.5 pt-1">
                <Bone className="h-4 w-[min(620px,90%)]" />
                <Bone className="h-4 w-[min(420px,70%)]" />
              </span>
            ) : (
              <p key={sentences.join('')} className="m-0 text-proof-answer text-ink-2 [text-wrap:pretty] animate-[wFadeIn_.3s_ease_both]">
                {sentences.map((s, i) => (
                  <span key={i} className={i === 0 ? 'text-ink' : ''}>
                    {s}{' '}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!guide.hidden && guide.compact ? <GuideChip g={guide} open={guideOpen} onToggle={() => setGuideOpen((o) => !o)} /> : null}
          {org ? (
            <>
              <Button kind="ghost" to={`${sectionPath('digest')}${carry}`} label="Weekly digest" title="Weekly digest">
                <Mail size={15} strokeWidth={1.6} aria-hidden /> <span className="hidden sm:inline">Weekly digest</span>
              </Button>
              <Button kind="ghost" onClick={() => setParam({ log: '1' }, { push: true })} label="Decision log" title="Decision log">
                <History size={15} strokeWidth={1.6} aria-hidden /> <span className="hidden sm:inline">Decision log</span>
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {!guide.hidden && (!guide.compact || guideOpen) ? <GuidePanel g={guide} onClose={guide.compact ? () => setGuideOpen(false) : undefined} /> : null}

      <section aria-labelledby="today-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="today-h" className="m-0 text-proof-h text-ink">
            What needs you today
          </h2>
          <span className="text-proof-small text-ink-2 tnum">
            <span className="font-medium text-ink">{int(decide_.length)} to decide</span> · {int(inProgressN)} in progress · {int(resultsN)} {resultsN === 1 ? 'result' : 'results'}
          </span>
        </div>
        {loadingCards ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <SkeletonPanel height={208} />
            <SkeletonPanel height={208} />
            <SkeletonPanel height={208} />
          </div>
        ) : priority.length ? (
          <div className={`grid items-stretch gap-4 ${priority.length === 1 ? 'lg:grid-cols-2' : priority.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'}`}>
            {priority.map((c, i) => (
              <CardView key={c.key} c={c} index={i} lead={i === 0} canDecide={canDecide} legacy={!org} onAsk={ask} onBrief={setBrief} onDecide={(status, reason) => void decide(c.key, status, { reason, snapshot: snapshotOf(c) })} />
            ))}
          </div>
        ) : mix === 'brand' && !rows.some((r) => r.brand === brand) ? (
          <NoProducts brand={brand} />
        ) : (
          <div className="flex items-center gap-3 rounded-card border border-line bg-surface px-5 py-4 animate-[proofPage_.24s_var(--ease-standard)_both]">
            <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden className="shrink-0 text-proof-leaf" />
            <span className="flex min-w-0 flex-col">
              <span className="text-proof-body font-medium text-ink">Nothing needs a decision today</span>
              <span className="text-proof-small text-ink-2">New cards appear when the data moves: a product nears Proven, a campaign’s lift comes in, demand shifts.</span>
            </span>
            <Link to={`${sectionPath('products')}${carry}`} className="ml-auto hidden shrink-0 text-proof-small font-medium text-ink no-underline hover:underline sm:inline">
              Review products →
            </Link>
          </div>
        )}
      </section>

      {loadingCards ? <SkeletonPanel height={116} /> : <KpiBand tiles={tiles} label={`${name} at a glance`} />}

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <DemandPanel className="lg:col-span-7" months={demand.months} rows={demand.rows} brand={mix === 'brand' ? brand : null} />
        <FunnelPanel className="lg:col-span-5" t={camp} samples={own.filter((c) => c.sample).length} promoteTo={promoteTo} campaignsTo={promoteTo} canPromote={canDecide} />
      </div>

      <div className={`grid grid-cols-1 items-start gap-6 ${rest.length ? 'lg:grid-cols-3' : 'md:grid-cols-2'}`}>
        {rest.length ? (
        <Lane title="More to decide" count={rest.length} empty={null}>
          {restShown.map((c, i) => (
            <CardView key={c.key} c={c} index={i} canDecide={canDecide} legacy={!org} onAsk={ask} onBrief={setBrief} onDecide={(status, reason) => void decide(c.key, status, { reason, snapshot: snapshotOf(c) })} />
          ))}
          {rest.length > 4 ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="hit44 self-start rounded-ctl border-0 bg-transparent px-2 py-1 text-proof-small text-ink-2 hover:bg-pf-hover hover:text-ink">
              {showAll ? 'Show fewer' : `Show ${rest.length - 4} more`}
            </button>
          ) : null}
        </Lane>
        ) : null}

        <Lane title="In progress" count={inProgressN} empty="Accept a card and it waits here for its measurement.">
          {accepted.map(([key, v]) => {
            const card = cards.find((c) => c.key === key)
            const snap = logByKey.get(key)?.snapshot
            return (
              <ProgressItem
                key={key}
                vkey={key}
                kind={kindOfKey(key)}
                title={card?.title ?? snap?.title ?? key}
                figure={card ? `${card.figure} ${card.figureNote}` : (snap?.figure ?? '')}
                n={card?.n ?? snap?.n ?? null}
                meta={`Accepted ${v.updated_at ? agoText(v.updated_at) : ''}${v.by_role ? ` · ${ROLE_LABEL[v.by_role]}` : ''}`}
                waiting={card?.waiting ?? 'Its follow-up measurement'}
                actions={
                  canAct(role) ? (
                    <>
                      <Button size="sm" onClick={() => void decide(key, 'done', { snapshot: card ? snapshotOf(card) : (snap ?? undefined) })}>
                        Mark done
                      </Button>
                      <Button size="sm" kind="ghost" onClick={() => void decide(key, 'open')}>
                        Reopen
                      </Button>
                    </>
                  ) : null
                }
              />
            )
          })}
          {live.map((c) => (
            <LiveCampaign key={c.id} c={c} carry={carry} />
          ))}
          {sentOpen.map((r) => (
            <ProgressItem key={r.id} vkey={`rq-${r.id}`} kind="over_shelved" title={`Asked ${r.to_name ?? orgName(orgs, r.to_org)} for evidence`} figure={r.snapshot?.figure ?? ''} n={r.snapshot?.n ?? null} meta={`Sent ${agoText(r.created_at)}`} waiting="The brand’s answer" sub={r.product ?? r.snapshot?.title} />
          ))}
        </Lane>

        <Lane title="Results" count={resultsN} empty="Campaign results and brands’ answers land here, with their intervals.">
          {resultCards.map((c, i) => (
            <CardView key={c.key} c={c} index={i} canDecide={canDecide} legacy={!org} result onBrief={setBrief} onDecide={(status, reason) => void decide(c.key, status === 'accepted' ? 'done' : status, { reason, snapshot: snapshotOf(c) })} />
          ))}
          {answered.map((r) => (
            <AnswerItem key={r.id} r={r} from={r.to_name ?? orgName(orgs, r.to_org)} />
          ))}
          {done.map(([key, v]) => {
            const snap = logByKey.get(key)?.snapshot
            return <ProgressItem key={key} vkey={key} kind={kindOfKey(key)} title={snap?.title ?? key} figure={snap?.figure ?? ''} n={snap?.n ?? null} meta={`Done ${v.updated_at ? agoText(v.updated_at) : ''}${v.by_role ? ` · ${ROLE_LABEL[v.by_role]}` : ''}`} done />
          })}
        </Lane>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        {org ? <Requests className={mix === 'brand' ? 'lg:col-span-5' : 'lg:col-span-12'} inbox={inbox} outbox={outbox} loading={requests.status === 'loading'} /> : null}
        {mix === 'brand' ? <BrandSpotlight rows={rows} brand={brand} weeks={d.cohort.weeks} summaryRate={brandSummary?.rate ?? null} className={org ? 'lg:col-span-7' : 'lg:col-span-12'} /> : null}
      </div>

      <p className="m-0 text-proof-small text-ink-2">
        {d.cohort.real ? 'Mixed' : 'Simulated'} cohort: every card and figure here is composed from it and labelled as such wherever it is exported.
      </p>

      <SidePanel open={param('log') === '1'} onClose={() => setParam({ log: null })} title="Decision log" subtitle={org ? `${org.name} · every accept, dismiss, snooze and done, with the numbers at the time` : undefined} width={520} labelledBy="proof-log-title">
        <DecisionLog log={decisions.data?.log ?? []} />
      </SidePanel>
      <BriefPanel brief={brief} onClose={() => setBrief(null)} />
    </div>
  )
}

const orgName = (orgs: { id: string; name: string }[], id: string) => orgs.find((o) => o.id === id)?.name ?? id

function Lane({ title, count, empty, children }: { title: string; count: number; empty: ReactNode; children: ReactNode }) {
  const kids = Array.isArray(children) ? children.flat().filter(Boolean) : children
  const isEmpty = Array.isArray(kids) ? kids.length === 0 : !kids
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <h2 className="m-0 flex items-center gap-2 text-proof-h text-ink">
        {title}
        <span className="rounded-pill bg-sunken px-2 text-proof-label text-ink-2 tnum">{count}</span>
      </h2>
      {isEmpty && count === 0 ? empty ? <div className="rounded-card border border-dashed border-line px-4 py-5 text-proof-small text-ink-2">{empty}</div> : null : children}
    </section>
  )
}

function NoProducts({ brand }: { brand: string | null }) {
  const { carry } = useRetailState()
  return (
    <div className="flex flex-col gap-2 rounded-card border border-dashed border-line px-5 py-5 text-proof-small text-ink-2">
      <span className="text-proof-body font-medium text-ink">{brand ? `${brand} has no product in the catalog for this filter` : 'No products for this filter'}</span>
      <span>Check the range: products the retailer lists that Willow doesn’t know yet can be requested there.</span>
      <Link to={`${sectionPath('range')}${carry}`} className="self-start font-medium text-ink no-underline hover:underline">
        Open your range →
      </Link>
    </div>
  )
}

function BrandSpotlight({ rows, brand, weeks, className, summaryRate }: { rows: ProductRow[]; brand: string | null; weeks: number; className?: string; summaryRate: number | null }) {
  const { carry } = useRetailState()
  const mine = brand ? rows.filter((r) => r.brand === brand) : rows
  const spot = spotlightOf(mine)
  if (spot)
    return (
      <div className={className}>
        <Spotlight row={spot} weeksN={weeks} mine />
      </div>
    )
  // An empty brand workspace gets the next useful step, not "nothing is Proven".
  const collecting = mine.filter((r) => statusOf(r) === 'collecting').length
  const unused = mine.filter((r) => statusOf(r) === 'no_users').length
  const nearest = mine.filter((r) => r.rate !== null).sort((a, b) => (b.n ?? 0) - (a.n ?? 0))[0]
  return (
    <section className={`flex flex-col gap-3 rounded-card border border-line bg-surface p-5 ${className ?? ''}`}>
      <h2 className="m-0 text-proof-h text-ink">Your next step to Proven</h2>
      <p className="m-0 text-proof-body text-ink-2 [text-wrap:pretty]">
        {mine.length
          ? `${mine.length} ${mine.length === 1 ? 'product is' : 'products are'} in the catalog; ${collecting} ${collecting === 1 ? 'is' : 'are'} collecting people and ${unused} ${unused === 1 ? 'has' : 'have'} no users yet. A product gets a Proof tier once 10 people reach week ${weeks}.`
          : 'None of your products is in the catalog yet.'}
      </p>
      {nearest ? (
        <Link to={`/retail/products/${encodeURIComponent(nearest.product_id)}${carry}`} className="flex items-center gap-3 rounded-ctl border border-line px-3 py-2.5 no-underline transition-colors hover:bg-pf-hover">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-proof-body font-medium text-ink">{nearest.product}</span>
            <span className="text-proof-small text-ink-2 tnum">
              {pct(nearest.rate)} visible change · n={int(nearest.n)}
              {summaryRate !== null ? ` · brand ${pct(summaryRate)}` : ''}
            </span>
          </span>
          <span className="shrink-0 text-proof-small text-ink-2">{nearest.tier_label ?? 'Measured'} →</span>
        </Link>
      ) : null}
      <Link to={`${sectionPath('products')}${carry}`} className="self-start text-proof-small font-medium text-ink no-underline hover:underline">
        See where each product stands →
      </Link>
    </section>
  )
}
