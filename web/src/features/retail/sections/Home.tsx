import { ArrowRight, BellOff, Check, CheckCircle2, CircleDashed, Clock, Download, History, Inbox, Megaphone, MoreHorizontal, Send, Sparkles, TrendingUp, TriangleAlert, Users, X, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { api, retailerShelf, type Campaign } from '../../../lib/api'
import { setQueryData, useQuery } from '../../../lib/query'
import { useAuth } from '../../../lib/useAuth'
import { openProposals } from '../autopilot'
import { useRetailData } from '../context'
import { composeCards, DISMISS_REASONS, kindOfKey, laneOf, STATUS_WORD, TYPE_LABEL, type CardAction, type CardKind, type DecisionCard } from '../decisions'
import { useOrg } from '../org'
import { useDecide, useDecisions, useRequests, useSavedClaims, setRequests, withTransition } from '../orgData'
import { useCampaigns } from '../pipeline'
import { ProductImage } from '../../routine/productUi'
import { useProducts } from '../productData'
import { canAct, proofApi, proofError, ROLE_LABEL, type DecisionLogEntry, type EvidenceRequest } from '../proofApi'
import { coverage, statusOf } from '../range'
import { rangeIds, useOnceFlag, useRange } from '../rangeStore'
import { purposeOf, sectionPath, useRetailState } from '../state'
import type { Insights, ProductRow } from '../types'
import { Badge, Bone, Button, downloadText, EmptyState, int, KpiStrip, Menu, MenuItem, MenuLabel, PageHeader, Panel, SidePanel, SkeletonPanel, Tabs, useTooltip } from '../ui'
import { useAutopilot } from './promote/useAutopilot'
import { Spotlight } from './Overview'
import { spotlightOf } from '../productModel'
import { InsightsGate } from './shared'
import { useSegments } from '../useView'
import { agoText } from '../autopilot'

/*
 * Home = Decisions (research/finals/06 §6.4): the first line counts decisions, not KPIs. Three lanes: To decide
 * (at most five cards, most people first; each with its trigger, the figure with n and interval, one primary
 * action, one secondary, Dismiss with a reason and Snooze), In progress (accepted cards, live campaigns, sent
 * evidence requests, each naming what it waits for), Results (campaign results with their interval, answers
 * from brands, done decisions). Accepting moves a card to In progress; every change is logged on the
 * organisation with the numbers as they were (Decision log). Below: evidence requests between the retailer and
 * its brands, and (brands) the strongest proof. A first-run guide ticks itself from real state.
 */

const MAX_CARDS = 5

export default function Home() {
  return (
    <InsightsGate
      skeleton={
        <div className="flex flex-col gap-6">
          <div aria-hidden className="flex flex-col gap-2">
            <Bone className="h-7 w-56" />
            <Bone className="h-4 w-[min(520px,80%)]" />
          </div>
          <SkeletonPanel height={96} />
          <div className="grid gap-4 lg:grid-cols-3">
            <SkeletonPanel height={320} />
            <SkeletonPanel height={320} />
            <SkeletonPanel height={320} />
          </div>
        </div>
      }
    >
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

const KIND_ICON: Record<CardKind, { icon: LucideIcon; tone: string }> = {
  proven_not_promoted: { icon: Megaphone, tone: 'bg-proof-leaf-soft text-proof-leaf' },
  nearly_proven: { icon: CircleDashed, tone: 'bg-pf-amber-soft text-pf-amber' },
  claim_ready: { icon: CheckCircle2, tone: 'bg-proof-leaf-soft text-proof-leaf' },
  over_shelved: { icon: TriangleAlert, tone: 'bg-pf-amber-soft text-pf-amber' },
  under_shelved: { icon: TrendingUp, tone: 'bg-proof-leaf-soft text-proof-leaf' },
  unmet_group: { icon: Users, tone: 'bg-sunken text-ink' },
  demand_shift: { icon: TrendingUp, tone: 'bg-sunken text-ink' },
  campaign_result: { icon: Sparkles, tone: 'bg-proof-leaf-soft text-proof-leaf' },
  auto_proposal: { icon: Megaphone, tone: 'bg-sunken text-ink' },
}

/** A view-transition name for a card (lane moves glide where the browser supports it). */
const vt = (key: string) => ({ viewTransitionName: `dc-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}` }) as React.CSSProperties

function Body({ d }: { d: Insights }) {
  const { filters, workspace } = useRetailData()
  const { carry, param, setParam } = useRetailState()
  const { org, role, orgs, instance } = useOrg()
  const { user } = useAuth()
  const uid = user?.uid ?? null
  const brand = workspace.kind === 'brand' ? workspace.brand : null
  const mix: 'retailer' | 'brand' = org ? org.kind : workspace.kind
  const { state: prodState } = useProducts(filters)
  const rows = useMemo(() => (prodState.status === 'ready' ? prodState.d.products : []), [prodState])
  const campaigns = useCampaigns()
  const shelf = useQuery(['shelf-home', uid, filters.cohort, filters.range], (t) => retailerShelf(t, filters), { enabled: Boolean(uid) && mix === 'retailer', staleMs: 5 * 60_000 })
  const segments = useSegments()
  const claims = useSavedClaims()
  const auto = useAutopilot(uid)
  const decisions = useDecisions()
  const requests = useRequests()
  const decide = useDecide()
  const { range } = useRange()
  const [showAll, setShowAll] = useState(false)

  const brandOrgs = useMemo(() => new Set(orgs.filter((o) => o.kind === 'brand').flatMap((o) => o.brands)), [orgs])
  const cards = useMemo(() => {
    if (!rows.length) return []
    const shelfProducts = shelf.data ? shelf.data.categories.flatMap((c) => c.products.map((p) => ({ ...p, category_label: c.label }))) : null
    return composeCards({
      mix,
      brand,
      rows,
      campaigns,
      shelf: shelfProducts ? { products: shelfProducts, flags: shelf.data?.flags ?? [] } : null,
      segments: segments.status === 'ready' ? segments.data : null,
      demand: d.needs_by_month ?? null,
      claimed: new Set((claims.data ?? []).map((c) => c.product_id)),
      proposals: openProposals(auto.data?.activity ?? []),
      brandOrgs,
      weeks: d.cohort.weeks,
      carry,
    })
  }, [rows, mix, brand, campaigns, shelf.data, segments, d, claims.data, auto.data, brandOrgs, carry])

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
  const shown = showAll ? decide_ : decide_.slice(0, MAX_CARDS)
  const loadingCards = prodState.status === 'loading' || (mix === 'retailer' && shelf.status === 'loading' && !shelf.data)

  const snapshotOf = (c: DecisionCard) => ({ title: c.title.slice(0, 200), figure: `${c.figure} ${c.figureNote}`.trim().slice(0, 120), n: c.n })
  const logByKey = useMemo(() => {
    const m = new Map<string, DecisionLogEntry>()
    for (const e of decisions.data?.log ?? []) if (e.snapshot && !m.has(e.key)) m.set(e.key, e)
    return m
  }, [decisions.data])

  // ── the KPI strip: one row, four figures
  const ids = rangeIds(range)
  const inRange = ids ? rows.filter((r) => ids.has(r.product_id)) : brand ? rows.filter((r) => r.brand === brand) : rows
  const cov = coverage(inRange.map((r) => ({ status: statusOf(r), match: r.product_id })))
  const proven = inRange.filter((r) => r.tier === 'proven').length
  const ownCampaigns = brand ? campaigns.filter((c) => c.brand === brand) : campaigns
  const running = ownCampaigns.filter((c) => c.status === 'active').length

  const header = (
    <>
      <strong>{decide_.length} to decide</strong> · {inProgressN} in progress · {resultsN} {resultsN === 1 ? 'result' : 'results'}
    </>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={org ? org.name : brand ?? 'Home'}
        description={header}
        purpose={purposeOf('home')}
        actions={
          org ? (
            <Button onClick={() => setParam({ log: '1' }, { push: true })}>
              <History size={15} strokeWidth={1.6} aria-hidden /> Decision log
            </Button>
          ) : null
        }
      />

      <KpiStrip
        label="Your range at a glance"
        items={[
          { id: 'range', label: brand ? `${brand} products` : ids ? 'Products in your range' : 'Products in the catalog', value: int(cov.total), note: <Link to={`${sectionPath('range')}${carry}`} className="text-ink-2 no-underline hover:text-ink">{ids ? `from ${range?.filename}` : brand ? 'in the retailer’s range →' : 'Connect your range →'}</Link> },
          { id: 'measured', label: 'Measured', value: int(cov.measured), note: `${int(cov.collecting)} collecting · ${int(cov.no_users)} no users yet` },
          { id: 'proven', label: 'Proven', value: int(proven), note: cov.measured ? `of ${int(cov.measured)} measured` : 'none measured yet' },
          { id: 'campaigns', label: 'Campaigns running', value: int(running), note: `${ownCampaigns.filter((c) => c.stats.incrementality).length} with a measured lift` },
        ]}
      />

      <GettingStarted mix={mix} rangeConnected={Boolean(range) || mix === 'brand'} decided={Object.keys(items).length > 0} campaigns={campaigns.length > 0} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col lg:col-span-7">
        <Lane title="To decide" count={decide_.length} empty={loadingCards ? null : mix === 'brand' && !rows.some((r) => r.brand === brand) ? <NoProducts brand={brand} /> : 'Nothing waits for a decision. New cards appear when the data moves.'}>
          {loadingCards ? (
            <>
              <SkeletonPanel height={180} />
              <SkeletonPanel height={180} />
            </>
          ) : (
            <>
              {shown.map((c, i) => (
                <CardView key={c.key} c={c} index={i} canDecide={canAct(role) || !org} legacy={!org} onDecide={(status, reason) => void decide(c.key, status, { reason, snapshot: snapshotOf(c) })} />
              ))}
              {decide_.length > MAX_CARDS ? (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="hit44 self-start border-0 bg-transparent px-1 text-proof-small text-ink-2 hover:text-ink">
                  {showAll ? 'Show the top five' : `Show ${decide_.length - MAX_CARDS} more`}
                </button>
              ) : null}
            </>
          )}
        </Lane>
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
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
                        <Check size={14} strokeWidth={1.8} aria-hidden /> Mark done
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
            <CardView key={c.key} c={c} index={i} canDecide={canAct(role) || !org} legacy={!org} result onDecide={(status, reason) => void decide(c.key, status === 'accepted' ? 'done' : status, { reason, snapshot: snapshotOf(c) })} />
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
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        {org ? <Requests className={mix === 'brand' ? 'lg:col-span-5' : 'lg:col-span-12'} inbox={inbox} outbox={outbox} loading={requests.status === 'loading'} /> : null}
        {mix === 'brand' ? <BrandSpotlight rows={rows} brand={brand} weeks={d.cohort.weeks} className={org ? 'lg:col-span-7' : 'lg:col-span-12'} /> : null}
      </div>

      {instance?.demo ? <p className="m-0 text-proof-small text-ink-2">Demo instance: cards are composed from the {d.cohort.real ? 'mixed' : 'simulated'} cohort and labelled as such wherever they are exported.</p> : null}

      <SidePanel open={param('log') === '1'} onClose={() => setParam({ log: null })} title="Decision log" subtitle={org ? `${org.name} · every accept, dismiss, snooze and done, with the numbers at the time` : undefined} width={520} labelledBy="proof-log-title">
        <DecisionLog log={decisions.data?.log ?? []} />
      </SidePanel>
    </div>
  )
}

const orgName = (orgs: { id: string; name: string }[], id: string) => orgs.find((o) => o.id === id)?.name ?? id

/* ───────────────────────────── lanes and cards ───────────────────────────── */

function Lane({ title, count, empty, children }: { title: string; count: number; empty: ReactNode; children: ReactNode }) {
  const kids = Array.isArray(children) ? children.flat().filter(Boolean) : children
  const isEmpty = Array.isArray(kids) ? kids.length === 0 : !kids
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <h2 className="m-0 flex items-center gap-2 text-proof-h text-ink">
        {title}
        <span className="rounded-pill bg-sunken px-2 text-proof-label text-ink-2 tnum">{count}</span>
      </h2>
      {isEmpty && count === 0 ? empty ? <div className="rounded-card border border-dashed border-line px-4 py-6 text-proof-small text-ink-2">{empty}</div> : null : children}
    </section>
  )
}

function CardView({ c, index, canDecide, legacy, result = false, onDecide }: { c: DecisionCard; index: number; canDecide: boolean; legacy: boolean; result?: boolean; onDecide: (status: 'accepted' | 'dismissed' | 'snoozed', reason?: string) => void }) {
  const k = KIND_ICON[c.kind]
  const Icon = k.icon
  const ivTip = useTooltip(c.interval ?? '')
  return (
    <article style={{ ...vt(c.key), animationDelay: `${index * 40}ms` }} className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 animate-[proofPage_.28s_var(--ease-standard)_both]">
      <div className="flex items-center gap-2">
        <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-ctl ${k.tone}`}>
          <Icon size={13} strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1 truncate text-proof-small text-ink-2">{c.type}</span>
        {canDecide && !legacy ? <CardMenu onDecide={onDecide} /> : null}
      </div>
      <div className="flex min-w-0 items-start gap-3">
        {c.product ? (
          <Link to={`/retail/products/${encodeURIComponent(c.product.id)}`} aria-hidden tabIndex={-1} className="shrink-0 overflow-hidden rounded-ctl border border-line bg-pf-bg2 p-0.5">
            <ProductImage product={{ image_url: c.product.image_url, category: c.product.category || 'serum', name: c.product.name }} size={32} decorative />
          </Link>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="m-0 text-proof-body font-medium text-ink [text-wrap:pretty]">{c.title}</h3>
          <p className="m-0 text-proof-small text-ink-2 [text-wrap:pretty]">{c.trigger}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-ink tnum">{c.figure}</span>
        <span className="text-proof-small text-ink-2">{c.figureNote}</span>
        <span className="ml-auto flex items-center gap-2 text-proof-label text-ink-2 tnum">
          {c.n !== null ? <span>n={int(c.n)}</span> : null}
          {c.interval ? (
            <>
              <span {...ivTip.trigger} tabIndex={0} className="cursor-help underline decoration-line-strong decoration-dotted underline-offset-2">
                interval
              </span>
              {ivTip.node}
            </>
          ) : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <ActionButton a={c.primary} c={c} primary canDecide={canDecide} onAccept={() => onDecide('accepted')} result={result} />
        {c.secondary ? <ActionButton a={c.secondary} c={c} canDecide={canDecide} onAccept={() => onDecide('accepted', 'evidence requested')} result={result} /> : null}
      </div>
    </article>
  )
}

/** Dismiss (with a reason) and Snooze for a week. */
function CardMenu({ onDecide }: { onDecide: (status: 'dismissed' | 'snoozed', reason?: string) => void }) {
  return (
    <Menu label="More: snooze or dismiss" align="right" width={240} triggerClass="hit44 grid size-7 place-items-center rounded-ctl border-0 bg-transparent text-ink-2 hover:bg-pf-hover hover:text-ink" trigger={<MoreHorizontal size={15} strokeWidth={1.7} aria-hidden />}>
      {(close) => (
        <>
          <MenuItem
            onClick={() => {
              close()
              onDecide('snoozed', 'snoozed for 7 days')
              toast('Snoozed for a week')
            }}
          >
            <BellOff size={14} strokeWidth={1.7} aria-hidden className="text-ink-2" /> Snooze for a week
          </MenuItem>
          <MenuLabel>Dismiss because…</MenuLabel>
          {DISMISS_REASONS.map((r) => (
            <MenuItem
              key={r}
              onClick={() => {
                close()
                onDecide('dismissed', r)
                toast(`Dismissed · ${r}`)
              }}
            >
              <X size={14} strokeWidth={1.7} aria-hidden className="text-ink-2" /> {r}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  )
}

function ActionButton({ a, c, primary = false, canDecide, onAccept, result }: { a: CardAction; c: DecisionCard; primary?: boolean; canDecide: boolean; onAccept: () => void; result: boolean }) {
  const navigate = useNavigate()
  const { org, orgs } = useOrg()
  const { getIdToken } = useAuth()
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const kind = primary ? 'primary' : 'secondary'
  // The primary action decides (accepts) and does the thing; a secondary link only opens the evidence.
  const run = async () => {
    if (a.kind === 'link') {
      if (primary && canDecide) onAccept()
      navigate(a.to)
      return
    }
    if (a.kind === 'accept') {
      onAccept()
      toast(result ? 'Noted · moved to the log' : `Accepted · ${c.title}`)
      return
    }
    if (a.kind === 'brief') {
      downloadText(a.file, a.body, 'text/markdown')
      if (canDecide) onAccept()
      return
    }
    if (a.kind === 'request') {
      const to = orgs.find((o) => o.kind === 'brand' && o.brands.includes(a.brand))
      if (!org || !to) return
      setBusy(true)
      try {
        const t = await getIdToken()
        const sent = await proofApi.sendRequest(t, org.id, { to_org: to.id, product_id: a.productId, message: a.message, snapshot: { title: c.title.slice(0, 200), figure: `${c.figure} ${c.figureNote}`.slice(0, 120), n: c.n } })
        withTransition(() => setRequests(org.id, (v) => ({ inbox: v?.inbox ?? [], outbox: [sent, ...(v?.outbox ?? []).filter((x) => x.id !== sent.id)] })))
        onAccept()
        toast(`Evidence request sent to ${to.name}`)
      } catch (e) {
        toast.error(proofError(e, 'send the request'))
      } finally {
        setBusy(false)
      }
      return
    }
    if (a.kind === 'autopilot') {
      if (!user) return
      setBusy(true)
      try {
        const t = await getIdToken()
        const v = await api.autopilotAct(t, a.activityId, a.act)
        setQueryData(['autopilot', user.uid], { rules: v.rules, activity: v.activity })
        if (a.act === 'approve') {
          onAccept()
          toast(v.campaign_id ? 'Approved · the campaign has started' : (v.outcome ?? 'Approved'))
        } else toast('Declined')
      } catch (e) {
        toast.error(proofError(e, a.act === 'approve' ? 'approve the proposal' : 'decline the proposal'))
      } finally {
        setBusy(false)
      }
    }
  }
  const icon = a.kind === 'brief' ? <Download size={14} strokeWidth={1.7} aria-hidden /> : a.kind === 'request' ? <Send size={14} strokeWidth={1.7} aria-hidden /> : a.kind === 'link' && !primary ? null : null
  const needsRole = (a.kind === 'accept' || a.kind === 'request' || a.kind === 'autopilot') && !canDecide
  return (
    <Button size="sm" kind={kind} onClick={() => void run()} disabled={busy || needsRole} title={needsRole ? 'Viewers can read; an analyst or admin decides' : undefined}>
      {icon}
      {busy ? 'Working…' : a.label}
      {a.kind === 'link' && primary ? <ArrowRight size={14} strokeWidth={1.7} aria-hidden /> : null}
    </Button>
  )
}

function ProgressItem({ vkey, kind, title, figure, n, meta, waiting, actions, sub, done = false }: { vkey: string; kind: CardKind | null; title: string; figure: string; n: number | null; meta: string; waiting?: string; actions?: ReactNode; sub?: string; done?: boolean }) {
  return (
    <article style={vt(vkey)} className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4 animate-[proofPage_.28s_var(--ease-standard)_both]">
      <div className="flex items-center gap-2 text-proof-small text-ink-2">
        {done ? <CheckCircle2 size={14} strokeWidth={1.8} aria-hidden className="text-proof-leaf" /> : <Clock size={14} strokeWidth={1.8} aria-hidden className="text-pf-amber" />}
        <span className="truncate">{kind ? TYPE_LABEL[kind] : 'Decision'}</span>
      </div>
      <h3 className="m-0 text-proof-body font-medium text-ink [text-wrap:pretty]">{title}</h3>
      {sub ? <p className="m-0 text-proof-small text-ink-2">{sub}</p> : null}
      {figure ? (
        <p className="m-0 text-proof-small text-ink-2 tnum">
          <span className="font-medium text-ink">{figure}</span>
          {n !== null ? ` · n=${int(n)}` : ''}
        </p>
      ) : null}
      <p className="m-0 text-proof-label text-ink-2">{meta}</p>
      {waiting && !done ? (
        <p className="m-0 rounded-ctl bg-pf-bg2 px-2.5 py-1.5 text-proof-small text-ink-2">
          <span className="font-medium text-ink">Waiting for</span> {waiting}
        </p>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
    </article>
  )
}

function LiveCampaign({ c, carry }: { c: Campaign; carry: string }) {
  const [now] = useState(() => Date.now())
  const start = Date.parse(c.starts_at)
  const day = Math.min(c.days, Math.max(1, Math.ceil((now - start) / 86_400_000)))
  return (
    <Link to={`${sectionPath('campaigns', c.id)}${carry}`} style={vt(`camp-${c.id}`)} className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4 no-underline transition-colors hover:bg-pf-hover animate-[proofPage_.28s_var(--ease-standard)_both]">
      <span className="flex items-center gap-2 text-proof-small text-ink-2">
        <Megaphone size={14} strokeWidth={1.8} aria-hidden className="text-pf-amber" /> Campaign live · day {day} of {c.days}
      </span>
      <span className="text-proof-body font-medium text-ink">{c.product ?? c.product_id}</span>
      <span className="text-proof-small text-ink-2 tnum">
        {int(c.stats.reach ?? c.stats.impressions)} reached · {int(c.stats.adds)} adds
      </span>
      <span className="rounded-ctl bg-pf-bg2 px-2.5 py-1.5 text-proof-small text-ink-2">
        <span className="font-medium text-ink">Waiting for</span> 10 people in each group, then the lift against the holdout
      </span>
    </Link>
  )
}

function AnswerItem({ r, from }: { r: EvidenceRequest; from: string }) {
  return (
    <article style={vt(`ans-${r.id}`)} className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4 animate-[proofPage_.28s_var(--ease-standard)_both]">
      <span className="flex items-center gap-2 text-proof-small text-ink-2">
        <Inbox size={14} strokeWidth={1.8} aria-hidden className={r.status === 'answered' ? 'text-proof-leaf' : 'text-ink-2'} />
        {r.status === 'answered' ? `${from} answered` : `${from} declined`} · {agoText(r.updated_at ?? r.created_at)}
      </span>
      <span className="text-proof-body font-medium text-ink">{r.product ?? r.product_id}</span>
      {r.reply ? <p className="m-0 rounded-ctl bg-pf-bg2 px-3 py-2 text-proof-small text-ink [text-wrap:pretty]">“{r.reply}”</p> : null}
      <Link to={`/retail/products/${encodeURIComponent(r.product_id)}`} className="self-start text-proof-small font-medium text-ink no-underline hover:underline">
        Re-read the evidence →
      </Link>
    </article>
  )
}

/* ───────────────────────────── evidence requests ───────────────────────────── */

function Requests({ inbox, outbox, loading, className }: { inbox: EvidenceRequest[]; outbox: EvidenceRequest[]; loading: boolean; className?: string }) {
  const { org, orgs } = useOrg()
  const [tab, setTab] = useState<'inbox' | 'sent'>(org?.kind === 'brand' || (inbox.length > 0 && !outbox.length) ? 'inbox' : 'sent')
  const list = tab === 'inbox' ? inbox : outbox
  return (
    <Panel
      title="Evidence requests"
      id="requests-h"
      className={className}
      description={org?.kind === 'brand' ? 'The retailer asks for evidence before a range review; answer here and it lands on their Home.' : 'Ask a brand for evidence from a card; their answer lands in Results.'}
      flush
    >
      <div className="px-5">
        <Tabs
          label="Requests"
          value={tab}
          onChange={setTab}
          panelId="requests-panel"
          tabs={[
            { id: 'inbox', label: 'Inbox', count: inbox.filter((r) => r.status === 'open').length },
            { id: 'sent', label: 'Sent', count: outbox.length },
          ]}
        />
      </div>
      <div id="requests-panel" role="tabpanel" className="flex flex-col">
        {loading ? (
          <div className="flex flex-col gap-2 p-5">
            <Bone className="h-4 w-3/4" />
            <Bone className="h-4 w-1/2" />
          </div>
        ) : list.length ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {list.map((r) => (
              <RequestRow key={r.id} r={r} incoming={tab === 'inbox'} other={(tab === 'inbox' ? r.from_name : r.to_name) ?? orgName(orgs, tab === 'inbox' ? r.from_org : r.to_org)} />
            ))}
          </ul>
        ) : (
          <EmptyState compact title={tab === 'inbox' ? 'No requests for you' : 'No requests sent'} body={tab === 'inbox' ? 'When the retailer asks for evidence on one of your products, it appears here.' : org?.kind === 'brand' ? 'Brands answer requests; the retailer sends them.' : 'Send one from an “Over-shelved, under-delivering” card.'} />
        )}
      </div>
    </Panel>
  )
}

function RequestRow({ r, incoming, other }: { r: EvidenceRequest; incoming: boolean; other: string }) {
  const { org, role } = useOrg()
  const { getIdToken } = useAuth()
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const answer = async (status: 'answered' | 'declined') => {
    if (!org) return
    setBusy(true)
    try {
      const t = await getIdToken()
      const next = await proofApi.answerRequest(t, org.id, r.id, { status, reply: reply.trim() || (status === 'declined' ? 'Declined' : '') })
      withTransition(() => setRequests(org.id, (v) => ({ inbox: (v?.inbox ?? []).map((x) => (x.id === r.id ? { ...x, ...next } : x)), outbox: v?.outbox ?? [] })))
      toast(status === 'answered' ? 'Answer sent' : 'Request declined')
    } catch (e) {
      toast.error(proofError(e, 'answer the request'))
    } finally {
      setBusy(false)
    }
  }
  const tone = r.status === 'answered' ? 'green' : r.status === 'declined' ? 'gray' : 'amber'
  return (
    <li className="flex flex-col gap-2 border-t border-line px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-proof-body font-medium text-ink">{r.product ?? r.product_id}</span>
        <Badge tone={tone}>{r.status === 'open' ? 'Waiting' : r.status === 'answered' ? 'Answered' : 'Declined'}</Badge>
        <span className="ml-auto text-proof-label text-ink-2">
          {incoming ? `From ${other}` : `To ${other}`} · {agoText(r.created_at)}
        </span>
      </div>
      <p className="m-0 text-proof-small text-ink-2 [text-wrap:pretty]">{r.message}</p>
      {r.snapshot?.figure ? (
        <p className="m-0 text-proof-label text-ink-2 tnum">
          At the time: {r.snapshot.figure}
          {r.snapshot.n !== null && r.snapshot.n !== undefined ? ` · n=${int(r.snapshot.n)}` : ''}
        </p>
      ) : null}
      {r.reply ? <p className="m-0 rounded-ctl bg-pf-bg2 px-3 py-2 text-proof-small text-ink">“{r.reply}”</p> : null}
      {incoming && r.status === 'open' && canAct(role) ? (
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor={`reply-${r.id}`}>
            Your answer
          </label>
          <textarea id={`reply-${r.id}`} value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={600} placeholder="Your answer: what evidence you hold, a study date, or what you will change" className="w-full resize-y rounded-ctl border border-line bg-surface px-3 py-2 text-proof-small text-ink placeholder:text-ink-2 hover:border-line-strong" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" kind="primary" onClick={() => void answer('answered')} disabled={busy || reply.trim().length < 3}>
              <Send size={14} strokeWidth={1.7} aria-hidden /> Send answer
            </Button>
            <Button size="sm" kind="ghost" onClick={() => void answer('declined')} disabled={busy}>
              Decline
            </Button>
            <Link to={`/retail/products/${encodeURIComponent(r.product_id)}`} className="ml-auto self-center text-proof-small text-ink-2 no-underline hover:text-ink">
              Open the product’s proof →
            </Link>
          </div>
        </div>
      ) : null}
    </li>
  )
}

/* ───────────────────────────── decision log ───────────────────────────── */

function DecisionLog({ log }: { log: DecisionLogEntry[] }) {
  if (!log.length) return <EmptyState compact title="No decisions yet" body="Accept, dismiss or snooze a card on Home and it is recorded here: who, when, and the numbers at the time." />
  const sorted = [...log].sort((a, b) => b.at.localeCompare(a.at))
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {sorted.map((e, i) => {
        const kind = kindOfKey(e.key)
        return (
          <li key={`${e.key}-${e.at}-${i}`} className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={e.status === 'accepted' || e.status === 'done' ? 'green' : e.status === 'dismissed' ? 'gray' : 'amber'}>{STATUS_WORD[e.status]}</Badge>
              <span className="text-proof-label text-ink-2">
                {new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {e.by_role ? ` · ${ROLE_LABEL[e.by_role]}` : ''}
              </span>
            </span>
            <span className="text-proof-body font-medium text-ink">{e.snapshot?.title ?? (kind ? TYPE_LABEL[kind] : e.key)}</span>
            {e.snapshot?.figure ? (
              <span className="text-proof-small text-ink-2 tnum">
                {e.snapshot.figure}
                {e.snapshot.n !== null && e.snapshot.n !== undefined ? ` · n=${int(e.snapshot.n)}` : ''}
              </span>
            ) : null}
            {e.reason ? <span className="text-proof-small text-ink-2">Reason: {e.reason}</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

/* ───────────────────────────── getting started ───────────────────────────── */

function GettingStarted({ mix, rangeConnected, decided, campaigns }: { mix: 'retailer' | 'brand'; rangeConnected: boolean; decided: boolean; campaigns: boolean }) {
  const [hidden, hide] = useOnceFlag('guide-hidden')
  const [visited] = useOnceFlag('visited-product')
  const { carry } = useRetailState()
  if (hidden) return null
  const steps = [
    {
      title: 'Connect your range',
      body: mix === 'brand' ? 'Your products arrive from the retailer’s item file, matched to the measured catalog.' : 'Upload your item file once; Proof matches it to the measured catalog.',
      items: [{ label: mix === 'brand' ? 'Your products are in the catalog' : 'Item file connected', done: rangeConnected, to: `${sectionPath('range')}${carry}` }],
    },
    {
      title: 'See what works',
      body: 'Every product’s visible change against non-users with the same goals, with n and interval.',
      items: [{ label: 'Open a product’s proof', done: visited, to: `${sectionPath('products')}${carry}` }],
    },
    {
      title: 'Act and measure',
      body: 'Decide on a card; promote a Proven product with a randomised holdout to measure the lift.',
      items: [
        { label: 'Decide on a first card', done: decided, to: null },
        { label: mix === 'brand' ? 'Launch or approve a campaign' : 'Launch or approve a campaign', done: campaigns, to: `${sectionPath('campaigns')}${carry}` },
      ],
    },
  ]
  const all = steps.flatMap((s) => s.items)
  const doneN = all.filter((i) => i.done).length
  if (doneN === all.length) return null
  return (
    <section aria-labelledby="guide-h" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 animate-[proofPage_.24s_var(--ease-standard)_both]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="guide-h" className="m-0 text-proof-h text-ink">
          How Proof works
        </h2>
        <span className="flex items-center gap-3">
          <span className="text-proof-small text-ink-2 tnum">
            {doneN} of {all.length} done
          </span>
          <button type="button" onClick={hide} className="hit44 border-0 bg-transparent text-proof-small text-ink-2 hover:text-ink">
            Hide guide
          </button>
        </span>
      </div>
      <ol className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-3">
        {steps.map((s, i) => {
          const stepDone = s.items.every((x) => x.done)
          return (
            <li key={s.title} className="flex gap-3">
              <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full text-proof-label font-medium tnum transition-colors duration-300 ${stepDone ? 'bg-proof-leaf text-[var(--bg-canvas)]' : 'bg-proof-leaf-soft text-proof-leaf'}`}>
                {stepDone ? <Check size={13} strokeWidth={3} /> : i + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="text-proof-body font-medium text-ink">{s.title}</span>
                <span className="text-proof-small text-ink-2">{s.body}</span>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {s.items.map((it) => (
                    <li key={it.label} className="flex items-center gap-2 text-proof-small">
                      <span aria-hidden className={`grid size-4 place-items-center rounded-full border transition-colors duration-300 ${it.done ? 'border-proof-leaf bg-proof-leaf text-[var(--bg-canvas)]' : 'border-line-strong'}`}>{it.done ? <Check size={10} strokeWidth={3.2} /> : null}</span>
                      <span className="sr-only">{it.done ? 'Done: ' : 'To do: '}</span>
                      {it.to && !it.done ? (
                        <Link to={it.to} className="text-ink no-underline hover:underline">
                          {it.label}
                        </Link>
                      ) : (
                        <span className={it.done ? 'text-ink-2 line-through decoration-line-strong' : 'text-ink'}>{it.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/* ───────────────────────────── brand pieces ───────────────────────────── */

function NoProducts({ brand }: { brand: string | null }) {
  const { carry } = useRetailState()
  return (
    <div className="flex flex-col gap-2 rounded-card border border-dashed border-line px-4 py-5 text-proof-small text-ink-2">
      <span className="font-medium text-ink">{brand ? `${brand} has no product in the catalog for this filter` : 'No products for this filter'}</span>
      <span>Check the range: products the retailer lists that Willow doesn’t know yet can be requested there.</span>
      <Link to={`${sectionPath('range')}${carry}`} className="self-start font-medium text-ink no-underline hover:underline">
        Open your range →
      </Link>
    </div>
  )
}

function BrandSpotlight({ rows, brand, weeks, className }: { rows: ProductRow[]; brand: string | null; weeks: number; className?: string }) {
  const { carry } = useRetailState()
  const mine = brand ? rows.filter((r) => r.brand === brand) : rows
  const spot = spotlightOf(mine)
  if (spot) return <div className={className}><Spotlight row={spot} weeksN={weeks} mine /></div>
  // An empty brand workspace gets the next useful step, not "nothing is Proven".
  const collecting = mine.filter((r) => statusOf(r) === 'collecting').length
  const unused = mine.filter((r) => statusOf(r) === 'no_users').length
  return (
    <section className={`flex flex-col gap-2 rounded-card border border-line bg-surface p-5 ${className ?? ''}`}>
      <h2 className="m-0 text-proof-h text-ink">Your next step</h2>
      <p className="m-0 text-proof-body text-ink-2">
        {mine.length
          ? `${mine.length} ${mine.length === 1 ? 'product is' : 'products are'} in the catalog; ${collecting} ${collecting === 1 ? 'is' : 'are'} collecting people and ${unused} ${unused === 1 ? 'has' : 'have'} no users yet. A product gets a Proof tier once 10 people reach week ${weeks}.`
          : 'None of your products is in the catalog yet.'}
      </p>
      <p className="m-0 text-proof-small text-ink-2">Sampling grows n fastest: a nearly-proven card offers a brief when one is close.</p>
      <Link to={`${sectionPath('products')}${carry}`} className="self-start text-proof-small font-medium text-ink no-underline hover:underline">
        See where each product stands →
      </Link>
    </section>
  )
}
