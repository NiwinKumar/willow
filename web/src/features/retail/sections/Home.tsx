import { History, Mail } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { agoText } from '../autopilot'
import { useRetailData } from '../context'
import { kindOfKey, laneOf, type DecisionCard } from '../decisions'
import { Board, type Lane, type LaneId } from '../home/Board'
import { AnswerItem, BriefPanel, CardView, LiveCampaign, ProgressItem, type Brief } from '../home/Cards'
import { campaignTotals, changeText, demandTrends, pooledRate, portfolio, risingGoal, weekBrief } from '../home/dashboard'
import { GuideChip, GuidePanel, useGuide } from '../home/Guide'
import { ProofPanel } from '../home/ProofPanel'
import { DemandPanel, FunnelPanel, KpiBand, marks, portfolioNote, type Tile } from '../home/Pulse'
import { LatestPanel, NeedsYou, SLOTS, type Update } from '../home/Rail'
import { DecisionLog, Requests } from '../home/Requests'
import { useHomeCards } from '../homeData'
import { useCampaignsState } from '../pipeline'
import { useOrg } from '../org'
import { useDecide } from '../orgData'
import { workspaceCampaigns, workspaceId } from '../promote'
import { canAct, ROLE_LABEL, type DecisionLogEntry } from '../proofApi'
import { homeScope } from '../range'
import { rangeIds } from '../rangeStore'
import { sectionPath, useRetailState } from '../state'
import type { Insights } from '../types'
import { Bone, Button, cohortSizeText, IconButton, int, pct, pts, SidePanel, SkeletonPanel } from '../ui'
import { InsightsGate } from './shared'

/*
 * Home: the organisation's dashboard (research/finals/06 §6.4; owner feedback Nov 27 and Nov 28).
 *
 * The person came to learn how their products are doing and what needs them. The top bar already says who they
 * are (logo, name, role), so Home has no title block of its own. Two columns, then sections:
 *
 *   ┌──────────────── information (3/4) ────────────────┬── Needs you (1/4) ──┐
 *   │ This week: 2-3 sentences from the figures (code)  │ top 3 decisions     │
 *   │ KPI band, per role (4 tiles, each opens a section)│ (full cards)        │
 *   │ How your products compare (users vs same goals)   │ Latest: requests,   │
 *   │ What people come for  │  Campaign funnel          │ answers, results    │
 *   └───────────────────────────────────────────────────┴─────────────────────┘
 *   Decisions: the rest, one lane at a time (More to decide · In progress · Results)
 *   Evidence requests
 *
 * Phones stack it as: This week, KPIs, Needs you, then the panels. One click away: Weekly digest, Decision
 * log (side panel), a brief (side panel), Ask. The first-run guide folds into a chip once two steps are done.
 * Four tests for each part are in its own file's header (home/*.tsx).
 */

const PRIORITY = SLOTS

export default function Home() {
  return (
    <InsightsGate skeleton={<HomeSkeleton />}>
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function HomeSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-1 gap-x-6 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Bone className="h-4 w-[min(640px,92%)]" />
          <Bone className="h-4 w-[min(460px,70%)]" />
        </div>
        <SkeletonPanel height={116} />
        <SkeletonPanel height={300} />
      </div>
      <div className="flex flex-col gap-3">
        <Bone className="h-5 w-24" />
        <SkeletonPanel height={196} />
        <SkeletonPanel height={196} />
      </div>
    </div>
  )
}

function Body({ d }: { d: Insights }) {
  const { carry, param, setParam } = useRetailState()
  const { org, role, orgs } = useOrg()
  const { mix, brand, rows, prodState, retryProducts, campaigns, shelf, decisions, requests, range, cards, settling } = useHomeCards(d)
  const { workspace } = useRetailData()
  const decide = useDecide()
  const [brief, setBrief] = useState<Brief | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const board = useRef<HTMLElement>(null)

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
  // The campaigns Home counts: this organisation's, in the workspace viewed (as the Campaigns page lists them).
  const own = workspaceCampaigns(campaigns, workspaceId(workspace))
  const live = own.filter((c) => c.status === 'active' && !c.stats.incrementality)
  const sentOpen = outbox.filter((r) => r.status === 'open')
  const answered = outbox.filter((r) => r.status !== 'open')
  const inProgressN = accepted.length + live.length + sentOpen.length
  const resultsN = resultCards.length + answered.length + done.length
  const priority = decide_.slice(0, PRIORITY)
  const rest = decide_.slice(PRIORITY)
  const loadingCards = settling || prodState.status === 'loading' || (mix === 'retailer' && shelf.status === 'loading' && !shelf.data)
  const campaignsState = useCampaignsState()
  const loadingCampaigns = campaignsState.loading
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
  const camp = campaignTotals(own)
  const focusGoals = useMemo(() => new Set(brand ? rows.filter((r) => r.brand === brand).flatMap((r) => r.goal_ids) : []), [rows, brand])
  const demand = useMemo(() => demandTrends(d.needs_by_month, focusGoals), [d.needs_by_month, focusGoals])
  const people = d.needs_by_month?.people ?? []
  const peopleChange = people.length > 1 && people.at(-2) ? ((people.at(-1) ?? 0) - (people.at(-2) ?? 0)) / (people.at(-2) ?? 1) : null
  const name = org?.kind === 'brand' ? (brand ?? org.name) : (org?.name ?? brand ?? 'Your range')
  const briefLines = weekBrief({ mix, name: mix === 'brand' ? (brand ?? name) : name, p, rate, market, rising: risingGoal(demand.rows), camp })
  // simulated people in the numbers: the headline says so in its first words (the notice above says why)
  const sentences = d.cohort.synthetic && briefLines.length ? [`In the simulated cohort, ${briefLines[0].charAt(0).toLowerCase()}${briefLines[0].slice(1)}`, ...briefLines.slice(1)] : briefLines

  const guide = useGuide({ mix, rangeConnected: Boolean(range) || mix === 'brand', decided: Object.keys(items).length > 0, campaigns: campaigns.some((c) => !c.sample) })
  const ask = (q: string) => setParam({ ask: '1', q }, { push: true })
  const promoteTo = `${sectionPath('campaigns')}${carry}`

  const proofScore = p.measured ? p.proven / p.measured : null
  // Campaigns as activity (live, run, reach per day); the lift itself is the funnel's last step, said once there.
  const campaignTile: Tile = camp.count
    ? {
        id: 'campaigns',
        label: 'Campaigns',
        value: int(camp.live),
        unit: `active of ${int(camp.count)}`,
        note: `${int(camp.reach)} people reached`,
        mark: camp.daily.length > 1 ? marks.spark(camp.daily.map((x) => x.impressions), `Impressions per day over ${camp.daily.length} days, latest ${int(camp.daily.at(-1)?.impressions)}`) : undefined,
        to: promoteTo,
      }
    : { id: 'campaigns', label: 'Campaigns', value: '0', unit: 'running', note: p.proven ? 'A Proven product is ready to promote' : 'Promote once a product is Proven', to: promoteTo }
  const tiles: Tile[] =
    mix === 'brand'
      ? [
          { id: 'measured', label: 'Products measured', value: int(p.measured), unit: `of ${int(p.total)}`, note: portfolioNote(p), mark: marks.meter(p.total ? p.measured / p.total : null, `${p.measured} of ${p.total} products measured`), to: `${sectionPath('products')}${carry}` },
          { id: 'proven', label: 'Proven', value: int(p.proven), unit: `of ${int(p.measured)} measured`, note: p.measured ? (p.promising ? `${int(p.promising)} Promising, close behind` : 'None Promising') : 'Nothing measured yet', mark: marks.ring(proofScore, `${p.proven} of ${p.measured} measured products are Proven`), to: `${sectionPath('products')}${carry}` },
          {
            id: 'rate',
            label: 'Visible change',
            value: rate ? pct(rate.rate) : '—',
            unit: rate ? `of ${int(rate.n)}` : undefined,
            note: market ? `Market: ${pct(market.rate)}` : 'No measured products yet',
            delta: rate && market ? { text: pts(rate.rate - market.rate), tone: rate.rate - market.rate > 0.005 ? 'up' : rate.rate - market.rate < -0.005 ? 'down' : 'flat', title: `${brand ?? name} against the market: ${pct(rate.rate)} of ${int(rate.n)} product uses across ${rate.products} measured ${rate.products === 1 ? 'product' : 'products'}, against ${pct(market.rate)} of ${int(market.n)} product uses across every measured product (one person can use several).` } : null,
            to: `${sectionPath('market')}${carry}`,
          },
          campaignTile,
        ]
      : [
          { id: 'coverage', label: scope === 'range' ? 'Range measured' : 'Catalog measured', value: int(p.measured), unit: `of ${int(p.total)}`, note: `${p.total ? pct(p.measured / p.total) : '—'} · ${portfolioNote(p)}`, mark: marks.meter(p.total ? p.measured / p.total : null, `${p.measured} of ${p.total} products measured`), to: `${sectionPath('range')}${carry}` },
          { id: 'proven', label: 'Proven', value: int(p.proven), unit: `of ${int(p.measured)} measured`, note: p.measured ? (p.promising ? `${int(p.promising)} Promising, close behind` : 'None Promising') : 'Nothing measured yet', mark: marks.ring(proofScore, `${p.proven} of ${p.measured} measured products are Proven`), to: `${sectionPath('products')}${carry}` },
          // People, not the least-served group: that group is already a decision card in Needs you.
          { id: 'people', label: 'People measured', value: int(d.needs_by_month?.people.at(-1) ?? null), unit: 'this month', note: d.needs_by_month && d.needs_by_month.people.length > 1 ? `${changeText(peopleChange)} on the month before` : 'with a reading', mark: d.needs_by_month ? marks.spark(d.needs_by_month.people, `People with a reading per month: ${d.needs_by_month.people.map((n) => int(n)).join(', ')}`, 'ink') : undefined, to: `${sectionPath('customers')}${carry}` },
          campaignTile,
        ]

  // ── the board's lanes (below the dashboard) and the rail's "Latest" (pointers into them)
  const cardOf = (c: DecisionCard, i: number, o: { lead?: boolean; result?: boolean; rail?: boolean } = {}) => (
    <CardView key={c.key} c={c} index={i} lead={o.lead} rail={o.rail} result={o.result} canDecide={canDecide} legacy={!org} onAsk={o.result ? undefined : ask} onBrief={setBrief} onDecide={(status, reason) => void decide(c.key, o.result && status === 'accepted' ? 'done' : status, { reason, snapshot: snapshotOf(c) })} />
  )
  const progressItems = [
    ...accepted.map(([key, v]) => {
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
    }),
    ...live.map((c) => <LiveCampaign key={c.id} c={c} carry={carry} />),
    ...sentOpen.map((r) => <ProgressItem key={r.id} vkey={`rq-${r.id}`} kind="over_shelved" title={`Asked ${r.to_name ?? orgName(orgs, r.to_org)} for evidence`} figure={r.snapshot?.figure ?? ''} n={r.snapshot?.n ?? null} meta={`Sent ${agoText(r.created_at)}`} waiting="The brand’s answer" sub={r.product ?? r.snapshot?.title} />),
  ]
  const resultItems = [
    ...resultCards.map((c, i) => cardOf(c, i, { result: true })),
    ...answered.map((r) => <AnswerItem key={r.id} r={r} from={r.to_name ?? orgName(orgs, r.to_org)} />),
    ...done.map(([key, v]) => {
      const snap = logByKey.get(key)?.snapshot
      return <ProgressItem key={key} vkey={key} kind={kindOfKey(key)} title={snap?.title ?? key} figure={snap?.figure ?? ''} n={snap?.n ?? null} meta={`Done ${v.updated_at ? agoText(v.updated_at) : ''}${v.by_role ? ` · ${ROLE_LABEL[v.by_role]}` : ''}`} done />
    }),
  ]
  const lanes: Lane[] = [
    { id: 'decide', label: 'More to decide', count: rest.length, items: rest.map((c, i) => cardOf(c, i)), empty: priority.length ? 'Everything waiting for you is in Needs you, above.' : 'Nothing waits for a decision.' },
    { id: 'progress', label: 'In progress', count: inProgressN, items: progressItems, empty: 'Accept a card and it waits here for its measurement.' },
    { id: 'results', label: 'Results', count: resultsN, items: resultItems, empty: 'Campaign results and brands’ answers land here, with their intervals.' },
  ]
  const laneParam = param('lane') as LaneId | null
  const lane: LaneId = laneParam && lanes.some((l) => l.id === laneParam) ? laneParam : (lanes.find((l) => l.items.length)?.id ?? 'decide')
  const openLane = (l: LaneId) => {
    setParam({ lane: l })
    requestAnimationFrame(() => board.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))
  }

  const toRequests = () => document.getElementById('requests-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const updates: Update[] = [
    ...inbox.filter((r) => r.status === 'open').map((r): Update => ({ key: `in-${r.id}`, kind: 'request', text: <><span className="font-medium">{r.from_name ?? orgName(orgs, r.from_org)}</span> asked for evidence on {r.product ?? r.product_id}</>, meta: `Waiting for your answer · ${agoText(r.created_at)}`, onClick: toRequests })),
    ...answered.map((r): Update => ({ key: `ans-${r.id}`, kind: 'answer', text: <><span className="font-medium">{r.to_name ?? orgName(orgs, r.to_org)}</span> {r.status === 'answered' ? 'answered' : 'declined'} on {r.product ?? r.product_id}</>, meta: agoText(r.updated_at ?? r.created_at), to: `/retail/products/${encodeURIComponent(r.product_id)}${carry}` })),
    ...resultCards.map((c): Update => ({ key: `res-${c.key}`, kind: 'result', text: <><span className="font-medium">{c.product?.name ?? c.title}</span>: {c.figure} adoption against the holdout</>, meta: c.figureNote === 'interval above zero' ? 'Campaign result · clear: interval above zero' : 'Campaign result · not yet clear: interval includes zero', to: c.secondary?.kind === 'link' ? c.secondary.to : undefined, onClick: () => openLane('results') })),
    ...live.map((c): Update => ({ key: `live-${c.id}`, kind: 'live', text: <><span className="font-medium">{c.product ?? c.product_id}</span>: campaign live, {int(c.stats.reach ?? c.stats.impressions)} reached</>, meta: 'Lift once each group has 10 people', to: `${sectionPath('campaigns', c.id)}${carry}` })),
  ]

  return (
    <div className="flex flex-col gap-10">
      {!guide.hidden && !guide.compact ? <GuidePanel g={guide} /> : null}

      {/* A fixed frame (owner feedback, Nov 28: nothing appears or disappears with the data). Top: the summary,
          key numbers and the comparison on the left; two decision slots on the right that stretch to the left
          column's height. Below: demand, the funnel and Latest side by side, equal height. */}
      <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            {loadingCards ? (
              <span aria-hidden className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
                <Bone className="h-4 w-[min(640px,92%)]" />
                <Bone className="h-4 w-[min(460px,70%)]" />
              </span>
            ) : (
              <p key={sentences.join('')} className="m-0 min-w-[min(100%,440px)] max-w-[68ch] flex-1 text-proof-answer text-ink-2 [text-wrap:pretty] animate-[wFadeIn_.3s_ease_both]">
                {sentences.map((s, i) => (
                  <span key={i} className={i === 0 ? 'font-medium text-ink' : ''}>
                    {s}{' '}
                  </span>
                ))}
              </p>
            )}
            {!guide.hidden && guide.compact ? <GuideChip g={guide} open={guideOpen} onToggle={() => setGuideOpen((o) => !o)} /> : null}
          </div>
          {!guide.hidden && guide.compact && guideOpen ? <GuidePanel g={guide} onClose={() => setGuideOpen(false)} /> : null}
        </div>

        <div>{loadingCards ? <SkeletonPanel height={116} /> : <KpiBand tiles={tiles} label={`${name} at a glance`} />}</div>
        <ProofPanel className="flex-1" loading={loadingCards} rows={inScope} mix={mix} scopeWord={scope === 'range' ? 'your range' : 'the catalog'} weeks={d.cohort.weeks} brand={brand} onRetry={prodState.status === 'failed' ? retryProducts : undefined} />
        </div>

        <NeedsYou
          count={decide_.length}
          loading={loadingCards}
          empty={mix === 'brand' && !rows.some((r) => r.brand === brand) ? <NoProducts brand={brand} /> : undefined}
          cards={mix === 'brand' && !rows.some((r) => r.brand === brand) ? [] : priority.map((c, i) => cardOf(c, i, { lead: i === 0, rail: true }))}
          actions={
            org ? (
              <>
                <IconButton to={`${sectionPath('digest')}${carry}`} label="Weekly digest">
                  <Mail size={15} strokeWidth={1.6} aria-hidden />
                </IconButton>
                <IconButton onClick={() => setParam({ log: '1' }, { push: true })} label="Decision log">
                  <History size={15} strokeWidth={1.6} aria-hidden />
                </IconButton>
              </>
            ) : null
          }
        />

      </div>

      <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2 xl:grid-cols-12">
        <DemandPanel className="md:col-span-2 xl:col-span-5" months={demand.months} rows={demand.rows} brand={mix === 'brand' ? brand : null} />
        <FunnelPanel className="xl:col-span-4" loading={loadingCampaigns} t={camp} samples={own.filter((c) => c.sample).length} promoteTo={promoteTo} campaignsTo={promoteTo} canPromote={canDecide} onRetry={campaignsState.failed ? () => void campaignsState.retry() : undefined} />
        <LatestPanel className="xl:col-span-3" loading={loadingCards || loadingCampaigns || requests.status === 'loading'} updates={updates} total={updates.length} onAll={() => openLane('results')} />
      </div>
      </div>

      <Board ref={board} lanes={lanes} lane={lane} onLane={(l) => setParam({ lane: l })} />

      {org ? <Requests inbox={inbox} outbox={outbox} loading={requests.status === 'loading'} /> : null}

      <p className="m-0 border-t border-line pt-4 text-proof-small text-ink-2">
        Simulated cohort ({cohortSizeText(d.cohort)}): every card and figure here is composed from it and labelled as such wherever it is exported.
      </p>

      <SidePanel open={param('log') === '1'} onClose={() => setParam({ log: null })} title="Decision log" subtitle={org ? `${org.name} · every accept, dismiss, snooze and done, with the numbers at the time` : undefined} width={520} labelledBy="proof-log-title">
        <DecisionLog log={decisions.data?.log ?? []} />
      </SidePanel>
      <BriefPanel brief={brief} onClose={() => setBrief(null)} />
    </div>
  )
}

const orgName = (orgs: { id: string; name: string }[], id: string) => orgs.find((o) => o.id === id)?.name ?? id

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
