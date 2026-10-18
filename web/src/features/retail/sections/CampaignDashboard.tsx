import { Pause, Play, Square, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { api, type Campaign } from '../../../lib/api'
import { setQueryData, useQuery } from '../../../lib/query'
import { useAuth } from '../../../lib/useAuth'
import { ProductImage } from '../../routine/productUi'
import { boostedAdds, campaignInsight, cumulativeDays, dateRange, durationText, goalLabel, HOLDOUT_MIN, ownRecordInsight, runDay, skinLabel, timeLeft } from '../promote'
import { sectionPath, useRetailState } from '../state'
import { fetchProduct } from '../productData'
import type { ProductDetail } from '../types'
import { Bone, Button, EmptyState, ErrorState, int, KpiStrip, PageHeader, Panel, pct, ProofTierChip, pts, SkeletonKpis, SkeletonPanel, type Kpi } from '../ui'
import { BlobRadial, StreamChart } from '../ui/widgets'
import { ErrorBox, StatusBadge, type Confirm } from './promote/CampaignCard'
import { ShopperPreview } from './promote/ShopperPreview'
import { useCampaignActions } from './promote/useCampaignActions'

/*
 * One campaign's dashboard (/retail/campaigns/:id). Everything on it is what Willow counts for that campaign:
 * who saw the Sponsored card, who clicked, who added the product to their routine, and the lift over the randomised
 * holdout (the adoption the campaign caused). Willow has no checkout, so "bought" is "added to routine"; where it
 * is shown is the placement and audience the campaign was set up with. Delivery is never split by goal or skin type.
 * URL: ?confirm=end|delete asks before ending or deleting (the Campaigns table's menu links here).
 */

const REFRESH_MS = 30_000
type Listed = { list: Campaign[]; at: number | null }

export default function CampaignDashboard() {
  const { user, loading, continueAsGuest } = useAuth()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (loading || user) return
    let alive = true
    continueAsGuest().catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [loading, user]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!user)
    return failed ? (
      <ErrorState title="Couldn’t start a workspace session" body="Campaigns belong to a signed-in account (a guest account is enough), and the guest sign-in did not work. Check the connection and reload." />
    ) : (
      <Loading />
    )
  return <Body uid={user.uid} />
}

function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading campaign" className="flex flex-col gap-6">
      <div aria-hidden className="flex flex-col gap-2">
        <Bone className="h-4 w-40" />
        <Bone className="h-8 w-[min(420px,70vw)]" />
      </div>
      <SkeletonKpis n={4} />
      <SkeletonPanel />
    </div>
  )
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const count = (v: number, one: string, many = `${one}s`) => `${int(v)} ${v === 1 ? one : many}`

function Body({ uid }: { uid: string }) {
  const { campaignId = '' } = useParams()
  const navigate = useNavigate()
  const { carry, param, setParam } = useRetailState()
  const back = `${sectionPath('campaigns')}${carry}`

  const camps = useQuery<Listed>(['campaigns', uid], (t) => api.listCampaigns(t).then((r) => ({ list: r.campaigns, at: Date.now() })), { enabled: Boolean(uid), staleMs: 10_000 })
  const elig = useQuery(['promo-eligibility', uid], (t) => api.eligibility(t).then((r) => r.products), { enabled: Boolean(uid), staleMs: 5 * 60_000 })
  // Live numbers: every 30 s while the tab is visible, and at once when it becomes visible again.
  const refetch = camps.refetch
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refetch()
    }
    const t = window.setInterval(tick, REFRESH_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refetch])

  const c = camps.data?.list.find((x) => x.id === campaignId) ?? null
  useEffect(() => {
    if (c) document.title = `${c.product ?? 'Campaign'} · Campaigns · Proof by Willow`
  }, [c])

  if (camps.status === 'error' && !camps.data) return <ErrorState title="Campaign couldn’t load" body="No numbers are shown rather than old ones. Try again in a minute." onRetry={() => void camps.refetch()} />
  if (!camps.data) return <Loading />
  if (!c)
    return (
      <EmptyState
        title="Campaign not found"
        body="It may have been deleted, or it belongs to another account. Campaigns are private to the account that launched them."
        action={{ label: 'Back to campaigns', to: back }}
      />
    )

  const editList = (f: (l: Campaign[]) => Campaign[]) => setQueryData<Listed>(['campaigns', uid], (prev) => ({ list: f(prev?.list ?? []), at: prev?.at ?? null }))
  const confirm = (['end', 'delete'] as const).find((k) => k === param('confirm')) ?? null

  return (
    <Dashboard
      c={c}
      back={back}
      productTo={`${sectionPath('products', c.product_id)}${carry}`}
      eligibility={elig.data?.find((p) => p.product_id === c.product_id) ?? null}
      at={camps.data.at}
      confirm={confirm}
      setConfirm={(k) => setParam({ confirm: k })}
      onChanged={(n) => editList((l) => l.map((x) => (x.id === n.id ? n : x)))}
      onDeleted={(id) => {
        editList((l) => l.filter((x) => x.id !== id))
        toast('Campaign deleted')
        navigate(back, { replace: true })
      }}
      onStale={() => void refetch()}
    />
  )
}

function Dashboard({ c, back, productTo, eligibility, at, confirm, setConfirm, onChanged, onDeleted, onStale }: {
  c: Campaign
  back: string
  productTo: string
  eligibility: Parameters<typeof ShopperPreview>[0]['product'] | null
  at: number | null
  confirm: Confirm | null
  setConfirm: (k: Confirm | null) => void
  onChanged: (c: Campaign) => void
  onDeleted: (id: string) => void
  onStale: () => void
}) {
  const actions = useCampaignActions(c, { onChanged, onDeleted, onStale })
  // The product's own evidence (mixed cohort, all time), for the radial; the page reads fine without it.
  const [detail, setDetail] = useState<ProductDetail | null>(null)
  useEffect(() => {
    let alive = true
    fetchProduct(c.product_id, { cohort: 'mixed', range: 'all' }).then(
      (d) => alive && setDetail(d),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [c.product_id])
  const s = c.stats
  const inc = s.incrementality
  const holdout = c.holdout_pct ?? 0.2
  const day = runDay(c)
  const name = c.product ?? c.product_id
  const kpis: Kpi[] = [
    { id: 'reach', label: 'People reached', value: s.reach !== undefined ? int(s.reach) : '—', note: s.impressions ? `Saw the card ${count(s.impressions, 'time')} in all` : 'No one yet' },
    { id: 'adds', label: 'Added to routine', value: int(s.adds), note: s.clicks ? `After ${count(s.clicks, 'click')} through the card` : 'From the card' },
    inc ? { id: 'lift', label: 'Lift over holdout', value: pts(inc.lift), note: `${pct(inc.exposed.rate)} vs ${pct(inc.holdout.rate)} added it` } : { id: 'lift', label: 'Lift over holdout', value: '—', note: c.status === 'ended' ? 'Not measured' : `Needs ${HOLDOUT_MIN} people in each group` },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-proof-small text-ink-2">
          <Link to={back} className="rounded-ctl text-ink-2 no-underline hover:text-ink">
            Campaigns
          </Link>
          <span aria-hidden className="text-ink-3">
            /
          </span>
          <span className="truncate text-ink">{name}</span>
        </nav>
        <PageHeader
          leading={
            <span className="hidden shrink-0 overflow-hidden rounded-card border border-line bg-pf-bg2 p-1 sm:block">
              <ProductImage product={{ image_url: c.image_url, category: c.category ?? '', name }} size={56} />
            </span>
          }
          title={name}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="font-medium text-ink">{c.brand}</span>
              <StatusBadge status={c.status} />
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              <span className="tnum">{day ? `Day ${day.day} of ${day.of} · ${timeLeft(c)}` : timeLeft(c)}</span>
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              <span className="tnum">
                {dateRange(c.starts_at, c.ends_at)} · {durationText(c)}
              </span>
            </span>
          }
          actions={
            <>
              <Button to={productTo}>Product evidence</Button>
              {c.status === 'active' ? (
                <Button onClick={() => void actions.setStatus('paused')} disabled={actions.busy !== null}>
                  <Pause size={14} strokeWidth={1.8} aria-hidden />
                  {actions.busy === 'status' ? 'Pausing…' : 'Pause'}
                </Button>
              ) : c.status === 'paused' ? (
                <Button kind="primary" onClick={() => void actions.setStatus('active')} disabled={actions.busy !== null}>
                  <Play size={14} strokeWidth={1.8} aria-hidden />
                  {actions.busy === 'status' ? 'Resuming…' : 'Resume'}
                </Button>
              ) : null}
              {c.status !== 'ended' ? (
                <Button onClick={() => setConfirm('end')} disabled={actions.busy !== null}>
                  <Square size={13} strokeWidth={1.8} aria-hidden />
                  End…
                </Button>
              ) : null}
              <Button kind="ghost" onClick={() => setConfirm('delete')} disabled={actions.busy !== null}>
                <Trash2 size={14} strokeWidth={1.8} aria-hidden />
                Delete…
              </Button>
            </>
          }
        />
        {confirm ? <ConfirmBar kind={c.status === 'ended' && confirm === 'end' ? null : confirm} actions={actions} setConfirm={setConfirm} /> : null}
        {actions.error ? <ErrorBox error={actions.error} /> : null}
      </div>

      <KpiStrip items={kpis} label={`Results for ${name}`} />

      <div className="grid gap-4 lg:grid-cols-12">
        <Story c={c} at={at} className="lg:col-span-8" />
        <Holdout c={c} holdout={holdout} className="lg:col-span-4" />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {detail ? <Works d={detail} productTo={productTo} className="lg:col-span-5" /> : null}
        <Audience c={c} holdout={holdout} eligibility={eligibility} className={detail ? 'lg:col-span-7' : 'lg:col-span-12'} />
      </div>
    </div>
  )
}

function ConfirmBar({ kind, actions, setConfirm }: { kind: Confirm | null; actions: ReturnType<typeof useCampaignActions>; setConfirm: (k: Confirm | null) => void }) {
  if (!kind) return null
  const end = kind === 'end'
  return (
    <div role="group" aria-label={end ? 'Confirm end' : 'Confirm delete'} className="flex flex-wrap items-center justify-end gap-x-2 gap-y-2 rounded-card border border-line-strong bg-surface px-4 py-3">
      <span className="mr-auto text-proof-body text-ink">{end ? 'End it now? It stops for good; its results stay.' : 'Delete it and its stats? This can’t be undone.'}</span>
      <Button onClick={() => setConfirm(null)}>{end ? 'Keep running' : 'Keep it'}</Button>
      <Button
        kind="primary"
        disabled={actions.busy !== null}
        onClick={() =>
          end
            ? void actions.setStatus('ended').then((err) => {
                if (!err) setConfirm(null)
              })
            : void actions.remove()
        }
      >
        {end ? (actions.busy === 'status' ? 'Ending…' : 'End campaign') : actions.busy === 'delete' ? 'Deleting…' : 'Delete campaign'}
      </Button>
    </div>
  )
}

const TONE_DOT: Record<ReturnType<typeof campaignInsight>['tone'], string> = { good: 'bg-proof-leaf', neutral: 'bg-[var(--pf-base)]', wait: 'bg-pf-amber' }

/** The answer first (what the campaign is doing, in a sentence), then the stream: shown, clicked and added building up over the run. */
function Story({ c, at, className }: { c: Campaign; at: number | null; className?: string }) {
  const insight = campaignInsight(c)
  const days = cumulativeDays(c.stats.daily)
  const label = (iso: string) => dayLabel(iso)
  return (
    <Panel id="cmp-story" className={className} footnote={at ? `Updated ${new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, refreshes every 30 s while this tab is open. Willow measures adds to a routine, not store sales or channels.` : 'Willow measures adds to a routine, not store sales or channels.'}>
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-3">
          <span aria-hidden className={`mt-2 size-2.5 shrink-0 rounded-full ${TONE_DOT[insight.tone]}`} />
          <div className="flex min-w-0 max-w-[640px] flex-col gap-1">
            <h2 id="cmp-story" className="m-0 text-[20px] font-semibold leading-7 tracking-[-0.02em] text-ink [text-wrap:balance]">
              {insight.headline}
            </h2>
            <p className="m-0 text-proof-body text-ink-2">{insight.detail}</p>
          </div>
        </div>
        {days.length ? (
          <div className="-mx-5 flex flex-col gap-3">
            <StreamChart
              days={days.map((d) => ({ label: label(d.day), values: d.values }))}
              bands={[
                { id: 'shown', label: 'Card shown' },
                { id: 'clicked', label: 'Clicked through' },
                { id: 'added', label: 'Added to routine' },
              ]}
              caption={`Running totals of the card shown, clicked and added to a routine, day by day, for ${c.product ?? 'this campaign'}`}
            />
            <p className="m-0 px-5 text-proof-small text-ink-2">
              Band width is the running total: the outer band is everyone who saw the card, the middle those who clicked, the core those who added the product. The pills above give the total shown by that day.
            </p>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

/** 100 people as dots: the filled ones are the people in that group who added the product. */
function PerHundred({ filled, label, tone, empty = false }: { filled: number; label: string; tone: 'leaf' | 'grey'; empty?: boolean }) {
  return (
    <figure className="m-0 flex min-w-0 flex-1 flex-col gap-2.5" aria-label={empty ? `${label}: not measured yet` : `${label}: ${filled} in 100 added the product`}>
      <div aria-hidden className="grid grid-cols-10 gap-[5px]">
        {Array.from({ length: 100 }, (_, k) => (
          <span key={k} className={`aspect-square rounded-full ${k < filled && !empty ? (tone === 'leaf' ? 'bg-proof-leaf' : 'bg-[var(--pf-base)]') : empty ? 'border border-dashed border-line-strong' : 'bg-sunken ring-1 ring-inset ring-line'}`} />
        ))}
      </div>
      <figcaption className="flex flex-col">
        <span className="text-[20px] font-semibold leading-7 tracking-[-0.02em] text-ink tnum">{empty ? '—' : filled}</span>
        <span className="text-proof-small text-ink-2">{label}</span>
      </figcaption>
    </figure>
  )
}

/** With the card vs without it: per 100 people, the adoption among those who could see the card and the randomised holdout who could not. */
function Holdout({ c, holdout, className }: { c: Campaign; holdout: number; className?: string }) {
  const inc = c.stats.incrementality
  const boost = boostedAdds(inc)
  return (
    <Panel id="cmp-holdout" title="With the card, without it" description="Out of every 100 matching people, how many added the product" className={className} footnote={`The ${Math.round(holdout * 100)}% holdout is picked at random and never sees the card, so the gap between the two is what the campaign caused.`}>
      <div className="flex flex-1 flex-col justify-between gap-5">
        <div className="flex gap-5">
          <PerHundred filled={Math.round((inc?.exposed.rate ?? 0) * 100)} label="Could see the card" tone="leaf" empty={!inc} />
          <PerHundred filled={Math.round((inc?.holdout.rate ?? 0) * 100)} label="Holdout" tone="grey" empty={!inc} />
        </div>
        {inc && boost ? (
          <p className="m-0 text-proof-body text-ink">
            {boost.lo > 0 ? (
              <>
                About <strong className="font-semibold tnum">{count(boost.n, 'extra person', 'extra people')}</strong> added it because of the campaign.
              </>
            ) : (
              <>The gap is {pts(inc.lift)}, but its range reaches zero, so the effect isn’t clear yet.</>
            )}
            <span className="block text-proof-small text-ink-2 tnum">
              95% interval {pts(inc.lift_lo)} to {pts(inc.lift_hi)}
            </span>
          </p>
        ) : (
          <p className="m-0 text-proof-body text-ink-2">{c.status === 'ended' ? `It ended before each group had ${HOLDOUT_MIN} people, so it wasn’t measured.` : `Shows once each group has ${HOLDOUT_MIN} people. No rate is shown before then.`}</p>
        )}
      </div>
    </Panel>
  )
}

/** Who the campaign reaches and where: the audience as chips, the placement in a line, and the card shoppers see. */
function Audience({ c, holdout, eligibility, className }: { c: Campaign; holdout: number; eligibility: Parameters<typeof ShopperPreview>[0]['product'] | null; className?: string }) {
  const chip = (t: string) => (
    <span key={t} className="inline-flex h-6 items-center rounded-pill border border-line bg-pf-bg2 px-2.5 text-proof-small text-ink">
      {t}
    </span>
  )
  return (
    <Panel id="cmp-audience" title="Who it reaches" description="Shown as one Sponsored card on the shopper’s Routine page" className={className}>
      <div className="flex flex-1 flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-proof-small text-ink-2">Goals</span>
            <div className="flex flex-wrap gap-1.5">{c.goals.map((g) => chip(goalLabel(g)))}</div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-proof-small text-ink-2">Skin types</span>
            <div className="flex flex-wrap gap-1.5">{c.skin_types.length ? c.skin_types.map((t) => chip(skinLabel(t))) : chip('Every type the evidence covers')}</div>
          </div>
        </div>
        {eligibility ? (
          <div className="mx-auto w-full max-w-[460px]">
            <ShopperPreview compact product={eligibility} extra={{ image_url: c.image_url, category: c.category }} goals={c.goals} skinTypes={c.skin_types} />
          </div>
        ) : null}
        <p className="m-0 mt-auto text-proof-small text-ink-2">{Math.round(holdout * 100)}% of matching people never see it, so the lift can be measured. Delivery is never split by goal or skin type.</p>
      </div>
    </Panel>
  )
}

/**
 * Where the product works, as the Retail design's radial: one axis per goal (or skin type), a layer for the people
 * using it and one for non-users with the same goals, both read against the highest rate. Only groups of 10 or
 * more people are drawn; with fewer than three such groups there is no shape to draw and the panel says so.
 */
function Works({ d, productTo, className }: { d: ProductDetail; productTo: string; className?: string }) {
  const ok = (g: { rate: number | null; suppressed: boolean }) => !g.suppressed && g.rate !== null
  // the split with the most groups of 10+ people gives the fullest shape (goals win a tie)
  const options = [
    { name: 'goal', segs: d.segments.goal.filter(ok) },
    { name: 'skin type', segs: d.segments.skin.filter(ok) },
    { name: 'skin tone', segs: d.segments.tone.filter(ok) },
  ]
  const by = options.reduce((best, o) => (o.segs.length > best.segs.length ? o : best))
  const segs = by.segs.slice(0, 6)
  const draw = segs.length >= 3
  const peak = Math.max(0.05, ...segs.flatMap((g) => [g.rate ?? 0, g.base_rate ?? 0]))
  const withBase = segs.every((g) => g.base_rate !== null)
  const p = d.product
  const insight = ownRecordInsight(p)
  return (
    <Panel id="cmp-works" title="Where it works" description={`A visible change by week 8, by ${by.name}`} className={className} actions={<ProofTierChip tier={p.tier} />}>
      {draw ? (
        <div className="flex flex-1 flex-col gap-4">
          <BlobRadial
            axes={segs.map((g) => g.label)}
            layers={[
              ...(withBase ? [{ id: 'base', label: 'Non-users, same goals', tone: 'grey' as const, values: segs.map((g) => (g.base_rate ?? 0) / peak) }] : []),
              { id: 'users', label: 'People using it', tone: 'leaf' as const, values: segs.map((g) => (g.rate ?? 0) / peak) },
            ]}
            rings={[pct(peak), pct(peak / 2)]}
            centre={String(p.n ?? '')}
            centreCaption="people measured"
            caption={`Share of people with a visible change by week 8, by ${by.name}, for the product and for non-users with the same goals`}
            format={(v) => pct(v * peak)}
          />
          <ul className="m-0 flex list-none flex-wrap justify-center gap-x-5 gap-y-1.5 p-0 text-proof-small text-ink-2">
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-full bg-proof-leaf" />
              People using it
            </li>
            {withBase ? (
              <li className="inline-flex items-center gap-2">
                <span aria-hidden className="size-2.5 rounded-full bg-[var(--pf-base)]" />
                Non-users, same goals
              </li>
            ) : null}
          </ul>
          {insight ? <p className="m-0 text-proof-small text-ink-2">{insight}</p> : null}
          <span className="mt-auto">
            <Button to={productTo} size="sm">
              Open product page
            </Button>
          </span>
        </div>
      ) : (
        <p className="m-0 py-6 text-proof-body text-ink-2">No {by.name} has 10 people with a measured outcome yet, so there is no shape to draw. {insight ?? ''}</p>
      )}
    </Panel>
  )
}
