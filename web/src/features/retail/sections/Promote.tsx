import { Plus, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { api, retailerProducts, type Campaign } from '../../../lib/api'
import { setQueryData, useQuery } from '../../../lib/query'
import { useAuth } from '../../../lib/useAuth'
import { useRetailData } from '../context'
import { answerLine, campaignSummary, createTarget, liftWords, MAX_ACTIVE, notEligibleOrder, runningCount, workspaceId } from '../promote'
import { sectionPath, useRetailState } from '../state'
import type { ProductRow, Products } from '../types'
import { Bone, Button, EmptyState, ErrorState, int, PageHeader, pts, SidePanel, SkeletonTable, ToolButton } from '../ui'
import { CampaignDetail, CampaignDetailFooter } from './promote/CampaignCard'
import { CampaignsTable } from './promote/CampaignsTable'
import { CreateCampaign } from './promote/CreateCampaign'
import { useCampaignActions } from './promote/useCampaignActions'
import { EligibleList } from './promote/EligibleList'

/*
 * Campaigns (docs/RETAILER_INSIGHTS.md "Proof-gated promotion"), the end of the demo story: measure → prove →
 * promote → measure the lift. The campaigns first (status, reach, adds, the lift over a randomised holdout), then
 * the products this workspace can promote; with no campaigns, how proof-gated promotion works in three steps.
 * Eligibility is always the mixed cohort, all time (the evidence shoppers see), whatever the top bar says.
 * Sign-in: a guest account, made on arrival (as Ask does on first question).
 * URL: ?new=<product_id> (or ?new=1, or the older ?product=<id>) opens the create panel; ?campaign=<id> opens a
 * campaign; ?all=1 lists campaigns from every workspace.
 */

const REFRESH_MS = 30_000
/** My campaigns and when the api answered (ms; null after only local edits). */
type Listed = { list: Campaign[]; at: number | null }

export default function Campaigns() {
  const { user, loading, continueAsGuest } = useAuth()
  const [signin, setSignin] = useState<'idle' | 'failed'>('idle')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (loading || user) return
    let alive = true
    continueAsGuest().catch(() => alive && setSignin('failed'))
    return () => {
      alive = false
    }
  }, [loading, user, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) {
    if (signin === 'failed')
      return (
        <Frame>
          <ErrorState
            title="Couldn’t start a workspace session"
            body="Campaigns belong to a signed-in account (a guest account is enough), and the guest sign-in did not work. Check the connection and retry."
            onRetry={() => {
              setSignin('idle')
              setAttempt((a) => a + 1)
            }}
          />
        </Frame>
      )
    return <Loading label="Starting a guest workspace session" />
  }
  return <Body uid={user.uid} />
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Campaigns" description="Promote a Proven product to the people its evidence covers." />
      {children}
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-8">
      <div aria-hidden className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          <Bone className="h-8 w-44" />
          <Bone className="h-5 w-[min(520px,70vw)]" />
        </div>
        <Bone className="h-9 w-36" />
      </div>
      <SkeletonTable rows={3} />
      <SkeletonTable rows={5} />
    </div>
  )
}

/** The rule shoppers rely on, said once, quietly. */
function Rules() {
  return (
    <p className="m-0 flex items-start gap-2 border-t border-line bg-pf-bg2 px-5 py-3 text-proof-small text-ink-2">
      <ShieldCheck size={15} strokeWidth={1.7} aria-hidden className="mt-px shrink-0 text-proof-leaf" />
      Money buys reach, never rank or eligibility. Shoppers see a Sponsored label and can hide sponsored cards.
    </p>
  )
}

function Body({ uid }: { uid: string }) {
  const { workspace } = useRetailData()
  const { param, setParam, carry } = useRetailState()
  const wsId = workspaceId(workspace)
  const brand = workspace.kind === 'brand' ? workspace.brand : null
  const wsLabel = workspace.kind === 'brand' ? `${workspace.brand ?? workspace.slug} workspace` : 'Retailer · all brands'

  const elig = useQuery(['promo-eligibility', uid], (t) => api.eligibility(t).then((r) => r.products), { enabled: Boolean(uid), staleMs: 5 * 60_000 })
  // Each answer carries the time it arrived; local edits keep that time.
  const camps = useQuery<Listed>(['campaigns', uid], (t) => api.listCampaigns(t).then((r) => ({ list: r.campaigns, at: Date.now() })), { enabled: Boolean(uid), staleMs: 10_000 })
  const editList = (f: (l: Campaign[]) => Campaign[]) => setQueryData<Listed>(['campaigns', uid], (prev) => ({ list: f(prev?.list ?? []), at: prev?.at ?? null }))

  // The same evidence as eligibility (mixed, all time), for packshots, rates and lifts. Optional: without it the
  // lists still work, with category orbs and dashes.
  const [products, setProducts] = useState<Products | null>(null)
  useEffect(() => {
    let alive = true
    retailerProducts({ cohort: 'mixed', range: 'all' }).then(
      (r) => alive && setProducts(r),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])
  const rows = useMemo(() => new Map<string, ProductRow>((products?.products ?? []).map((p) => [p.product_id, p])), [products])

  // Live stats: every 30 s while the tab is visible, and at once when it becomes visible again.
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

  // A just-launched campaign: its row scrolled to, focused and tinted for a moment.
  const [highlight, setHighlight] = useState<string | null>(null)
  const hlTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(hlTimer.current), [])
  useEffect(() => {
    if (!highlight) return
    const el = document.querySelector<HTMLElement>(`tr.cmp-row-${highlight}`)
    el?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
    el?.focus({ preventScroll: true })
  }, [highlight])

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  // The open campaign's panel keeps its last campaign while it slides out.
  const openId = param('campaign')
  const all = elig.data ?? []
  const campaigns = camps.data?.list ?? []
  const current = openId ? (campaigns.find((c) => c.id === openId) ?? null) : null
  const [lastShown, setLastShown] = useState<Campaign | null>(null)
  if (current && current !== lastShown) setLastShown(current)
  const shown = current ?? lastShown

  if (workspace.kind === 'brand' && !brand)
    return (
      <Frame>
        <EmptyState title="Unknown brand" body={`“${workspace.slug}” isn’t a catalog brand, so it has no products to promote. Choose a brand in the workspace menu, or switch to the retailer view.`} action={{ label: 'View as retailer', to: sectionPath('campaigns') }} />
      </Frame>
    )
  if (elig.status === 'error' && !elig.data)
    return (
      <Frame>
        <ErrorState title="Eligibility couldn’t load" body="The evidence that decides which products can be promoted didn’t answer, so nothing is listed. Try again in a minute." onRetry={() => void elig.refetch()} />
      </Frame>
    )
  if (!elig.data) return <Loading label="Loading campaigns" />

  const scope = brand ? all.filter((p) => p.brand === brand) : all
  const eligible = scope.filter((p) => p.eligible).sort((a, b) => (rows.get(b.product_id)?.lift ?? 0) - (rows.get(a.product_id)?.lift ?? 0) || a.product.localeCompare(b.product))
  const notEligible = scope.filter((p) => !p.eligible).sort(notEligibleOrder)

  const running = runningCount(campaigns)
  const mine = campaigns.filter((c) => c.workspace === wsId)
  const showAll = param('all') === '1'
  const listed = showAll ? campaigns : mine
  const elsewhere = campaigns.length - mine.length
  const runningFor = new Map<string, number>()
  for (const c of mine) if (c.status === 'active') runningFor.set(c.product_id, (runningFor.get(c.product_id) ?? 0) + 1)
  const workspaceOf = (c: Campaign) => (c.workspace === wsId ? null : c.workspace === 'retailer' ? 'retailer workspace' : `${c.workspace} workspace`)

  const target = createTarget(param('new'), param('product'))
  const openCreate = (productId?: string) => setParam({ new: productId ?? '1', product: null, campaign: null }, { push: true })
  const closeCreate = () => setParam({ new: null, product: null })
  const openCampaign = (id: string) => setParam({ campaign: id }, { push: true })
  const closeCampaign = () => {
    setParam({ campaign: null })
    setConfirmDelete(null)
  }

  const onCreated = (c: Campaign) => {
    editList((l) => [c, ...l.filter((x) => x.id !== c.id)])
    closeCreate()
    if (c.workspace !== wsId && !showAll) setParam({ all: '1' })
    toast(`Campaign launched · ${c.product} · ${c.days} days`)
    // after the panel has closed and returned focus, move to the new row
    window.setTimeout(() => {
      setHighlight(c.id)
      window.clearTimeout(hlTimer.current)
      hlTimer.current = window.setTimeout(() => setHighlight(null), 3200)
    }, 240)
  }
  const showCampaigns = () => {
    closeCreate()
    if (elsewhere > 0 && !showAll) setParam({ all: '1' })
    window.setTimeout(() => document.getElementById('proof-campaigns-h')?.scrollIntoView({ block: 'start' }), 240)
  }
  const onChanged = (c: Campaign) => editList((l) => l.map((x) => (x.id === c.id ? c : x)))
  const onDeleted = (id: string) => {
    editList((l) => l.filter((x) => x.id !== id))
    closeCampaign()
    toast('Campaign deleted')
  }

  const sum = campaignSummary(listed)
  const description = listed.length ? (
    <>
      {sum.active ? (
        <>
          <strong>{sum.active} active</strong> {sum.active === 1 ? 'campaign' : 'campaigns'}
        </>
      ) : (
        'No campaign running'
      )}
      , <strong>{int(sum.impressions)}</strong> {sum.impressions === 1 ? 'impression' : 'impressions'} so far
      <LiftClause lifts={sum.lifts} />
    </>
  ) : eligible.length ? (
    <>
      Promote a Proven product to the people its evidence covers. <strong>{brand ? `${eligible.length} of your products` : `${eligible.length} ${eligible.length === 1 ? 'product' : 'products'}`}</strong> {eligible.length === 1 ? 'is' : 'are'} ready.
    </>
  ) : (
    answerLine(all, brand)
  )

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Campaigns"
        description={description}
        actions={
          <Button kind="primary" onClick={() => openCreate()} disabled={!eligible.length} title={eligible.length ? undefined : 'No product here is Proven yet'}>
            <Plus size={15} strokeWidth={1.8} aria-hidden />
            New campaign
          </Button>
        }
      />

      {camps.status === 'error' && !camps.data ? (
        <section className="rounded-card border border-line bg-surface">
          <ErrorState compact title="Campaigns couldn’t load" body="No stats are shown rather than old ones." onRetry={() => void camps.refetch()} />
        </section>
      ) : !camps.data ? (
        <div role="status" aria-label="Loading campaigns">
          <SkeletonTable rows={3} />
        </div>
      ) : listed.length ? (
        <section aria-labelledby="proof-campaigns-h" className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
          <CampaignsTable
            campaigns={listed}
            heading={
              <>
                <h2 id="proof-campaigns-h" className="m-0 text-proof-h text-ink">
                  Campaigns
                </h2>
                <span className="text-proof-small text-ink-2 tnum">
                  {running} of {MAX_ACTIVE} running
                </span>
              </>
            }
            toolbar={
              <>
                <Updated at={camps.data.at} />
                {elsewhere > 0 ? (
                  <ToolButton pressed={showAll} onClick={() => setParam({ all: showAll ? null : '1' })}>
                    {showAll ? 'This workspace only' : `+${elsewhere} in other workspaces`}
                  </ToolButton>
                ) : null}
              </>
            }
            highlight={highlight}
            onOpen={openCampaign}
            onDelete={(id) => {
              setConfirmDelete(id)
              openCampaign(id)
            }}
            onChanged={onChanged}
            onDeleted={onDeleted}
            onStale={() => void refetch()}
            workspaceOf={workspaceOf}
          />
          <Rules />
        </section>
      ) : (
        <HowItWorks />
      )}

      <EligibleList
        title={brand ? 'Your products ready to promote' : 'Ready to promote'}
        eligible={eligible}
        notEligible={notEligible}
        extras={rows}
        runningFor={runningFor}
        onPromote={(id) => openCreate(id)}
        carry={carry}
        empty={
          <EmptyState
            compact
            title={brand ? `No ${brand} product is Proven yet` : 'No product is Proven yet'}
            body="A product can be promoted once 30+ people have 8 weeks of readings and its lift over non-users stays above zero across the 95% interval. What each one still needs is listed below."
            action={{ label: 'See products', to: `${sectionPath('products')}${carry}` }}
          />
        }
      />

      <CreateCampaign
        open={target.open}
        onClose={closeCreate}
        eligible={eligible}
        blocked={notEligible}
        all={all}
        brand={brand}
        rows={rows}
        workspace={{ id: wsId ?? 'retailer', label: wsLabel }}
        initialProduct={target.product}
        running={running}
        onCreated={onCreated}
        onShowCampaigns={showCampaigns}
      />

      {shown ? (
        <CampaignPanel
          key={shown.id}
          c={shown}
          open={Boolean(current)}
          onClose={closeCampaign}
          otherWorkspace={workspaceOf(shown)}
          confirmDelete={confirmDelete === shown.id}
          setConfirmDelete={(v) => setConfirmDelete(v ? shown.id : null)}
          onChanged={onChanged}
          onDeleted={onDeleted}
          onStale={() => void refetch()}
        />
      ) : null}
    </div>
  )
}

/** "; adoption is +6 pts above the randomised holdout." or, before both groups have 10 people, when it shows. */
function LiftClause({ lifts }: { lifts: number[] }) {
  if (!lifts.length) return <>; the lift over the randomised holdout shows once each group has 10 people.</>
  if (lifts.length === 1) {
    const w = liftWords(lifts[0])
    return w.figure ? (
      <>
        ; adoption is <strong>{w.figure}</strong> {w.dir} the randomised holdout.
      </>
    ) : (
      <>; adoption is level with the randomised holdout.</>
    )
  }
  return (
    <>
      ; adoption against the randomised holdout runs from <strong>{pts(Math.min(...lifts)).replace(' pts', '')}</strong> to <strong>{pts(Math.max(...lifts))}</strong> across {lifts.length} measured campaigns.
    </>
  )
}

function Updated({ at }: { at: number | null }) {
  if (!at) return null
  return (
    <span aria-live="polite" className="text-proof-small text-ink-2 tnum" title="Refreshes every 30 s while this tab is open">
      Updated {new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

const STEPS = [
  { title: 'Evidence decides eligibility', body: 'Only Proven products can be promoted: 30+ people, and a lift over non-users whose 95% interval stays above zero.' },
  { title: 'Reach the people it works for', body: 'Target only the goals and skin types the evidence covers. Shoppers see one card, labelled Sponsored, on their Routine page.' },
  { title: 'Measure the lift you caused', body: 'A random share of matching shoppers never sees the card. The difference in adoption between the groups is the campaign’s lift.' },
]

function HowItWorks() {
  return (
    <section aria-labelledby="proof-how-h" className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
      <h2 id="proof-how-h" className="m-0 px-5 pb-1 pt-4 text-proof-h text-ink">
        How proof-gated promotion works
      </h2>
      <ol className="m-0 grid list-none gap-6 px-5 pb-5 pt-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-proof-leaf-soft text-proof-label font-medium text-proof-leaf tnum">
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-proof-body font-medium text-ink">{s.title}</span>
              <span className="text-proof-small text-ink-2">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <Rules />
    </section>
  )
}

function CampaignPanel({ c, open, onClose, otherWorkspace, confirmDelete, setConfirmDelete, onChanged, onDeleted, onStale }: {
  c: Campaign
  open: boolean
  onClose: () => void
  otherWorkspace: string | null
  confirmDelete: boolean
  setConfirmDelete: (v: boolean) => void
  onChanged: (c: Campaign) => void
  onDeleted: (id: string) => void
  onStale: () => void
}) {
  const actions = useCampaignActions(c, { onChanged, onDeleted, onStale })
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={c.product ?? c.product_id}
      subtitle={c.brand ?? undefined}
      width={560}
      labelledBy="proof-campaign-panel"
      footer={<CampaignDetailFooter c={c} actions={actions} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} />}
    >
      <CampaignDetail c={c} otherWorkspace={otherWorkspace} actions={actions} />
    </SidePanel>
  )
}
