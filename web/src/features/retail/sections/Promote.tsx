import { ChevronRight, ExternalLink, Plus, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { ProductImage } from '../../../components/willow/ProductImage'
import { api, retailerProducts, type Campaign, type PromoEligibility } from '../../../lib/api'
import { setQueryData, useQuery } from '../../../lib/query'
import { useAuth } from '../../../lib/useAuth'
import { useRetailData } from '../context'
import { csvMeta } from '../data'
import { answerLine, goalLabel, MAX_ACTIVE, notEligibleOrder, runningCount, skinLabel, workspaceId } from '../promote'
import { sectionPath, useRetailState } from '../state'
import type { ProductRow, Products } from '../types'
import { Bone, DataTable, EmptyState, ErrorState, EvidenceBar, LiftValue, Panel, ProofTierChip, SectionHeader, SidePanel, SimBadge, SkeletonTable, Term, ToolButton, type Column } from '../ui'
import { CampaignCard } from './promote/CampaignCard'
import { CreateCampaign } from './promote/CreateCampaign'
import { ShopperPreview } from './promote/ShopperPreview'
import { useWorkspaceLabel } from './shared'

/*
 * Promote (docs/RETAILER_INSIGHTS.md "Proof-gated promotion"): which products clear the evidence bar and can be
 * shown in the Willow app, a campaign flow with the shopper's card drawn live, and each campaign's delivery and
 * randomised-holdout lift. Eligibility is always the mixed cohort, all time (the evidence shoppers see), whatever
 * the top-bar filters say. Sign-in: a guest account, made on arrival (as Ask does on first question).
 * URL: ?new=1 (create panel), &product=<id> (chosen product), ?how=1 (how shoppers see it), ?all=1 (campaigns
 * from every workspace).
 */

const REFRESH_MS = 30_000
/** My campaigns and when the api answered (ms; null after only local edits). */
type Listed = { list: Campaign[]; at: number | null }

export default function Promote() {
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

function Frame({ children, answer }: { children: ReactNode; answer?: ReactNode }) {
  const eyebrow = useWorkspaceLabel()
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader eyebrow={eyebrow} title="Promote" answer={answer ?? 'Products that clear Willow’s evidence bar can be shown to matching people in the Willow app.'} />
      {children}
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-4">
      <div aria-hidden className="flex flex-col gap-2">
        <Bone className="h-2.5 w-24" />
        <Bone className="h-7 w-48" />
        <Bone className="h-4 w-[min(520px,90%)]" />
      </div>
      <Bone className="h-[92px] w-full" />
      <div className="@container">
        <div className="grid gap-4 @[1080px]:grid-cols-12">
          <div className="@[1080px]:col-span-7">
            <SkeletonTable rows={8} />
          </div>
          <div className="flex flex-col gap-3 @[1080px]:col-span-5">
            <Bone className="h-[320px] w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

function Body({ uid }: { uid: string }) {
  const { workspace } = useRetailData()
  const { param, setParam, carry } = useRetailState()
  const eyebrow = useWorkspaceLabel()
  const wsId = workspaceId(workspace)
  const brand = workspace.kind === 'brand' ? workspace.brand : null
  const wsLabel = workspace.kind === 'brand' ? (workspace.brand ?? workspace.slug) : 'Retailer · all brands'

  const elig = useQuery(['promo-eligibility', uid], (t) => api.eligibility(t).then((r) => r.products), { enabled: Boolean(uid), staleMs: 5 * 60_000 })
  // Each answer carries the time it arrived ("Updated hh:mm:ss"); local edits keep that time.
  const camps = useQuery<Listed>(['campaigns', uid], (t) => api.listCampaigns(t).then((r) => ({ list: r.campaigns, at: Date.now() })), { enabled: Boolean(uid), staleMs: 10_000 })
  const editList = (f: (l: Campaign[]) => Campaign[]) => setQueryData<Listed>(['campaigns', uid], (prev) => ({ list: f(prev?.list ?? []), at: prev?.at ?? null }))

  // The same evidence as eligibility (mixed, all time), for packshots, rates and intervals. Optional: without it
  // the lists still work, with category orbs and no rate column numbers.
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
  const updated = camps.data?.at ? new Date(camps.data.at) : null
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

  // A just-launched campaign: scrolled to, focused and outlined for a moment.
  const [highlight, setHighlight] = useState<string | null>(null)
  const hlTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(hlTimer.current), [])
  useEffect(() => {
    if (!highlight) return
    const el = document.getElementById(`campaign-${highlight}`)
    el?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
    el?.focus({ preventScroll: true })
  }, [highlight])

  if (workspace.kind === 'brand' && !brand)
    return (
      <Frame>
        <EmptyState title="Unknown brand" body={`“${workspace.slug}” isn’t a catalog brand, so it has no products to promote. Choose a brand in “Viewing as”, or switch to the retailer view.`} action={{ label: 'View as retailer', to: sectionPath('promote') }} />
      </Frame>
    )
  if (elig.status === 'error' && !elig.data)
    return (
      <Frame>
        <ErrorState title="Eligibility couldn’t load" body="The evidence that decides which products can be promoted didn’t answer, so nothing is listed. Try again in a minute." onRetry={() => void elig.refetch()} />
      </Frame>
    )
  if (!elig.data) return <Loading label="Loading eligibility" />

  const all = elig.data
  const scope = brand ? all.filter((p) => p.brand === brand) : all
  const eligible = scope.filter((p) => p.eligible).sort((a, b) => (rows.get(b.product_id)?.lift ?? 0) - (rows.get(a.product_id)?.lift ?? 0) || a.product.localeCompare(b.product))
  const notEligible = scope.filter((p) => !p.eligible).sort(notEligibleOrder)
  const othersEligible = brand ? all.filter((p) => p.eligible && p.brand !== brand).length : 0

  const campaigns = camps.data?.list ?? []
  const running = runningCount(campaigns)
  const mine = campaigns.filter((c) => c.workspace === wsId)
  const showAll = param('all') === '1'
  const listed = showAll ? campaigns : mine
  const elsewhere = campaigns.length - mine.length
  const runningFor = new Map<string, number>()
  for (const c of mine) if (c.status === 'active') runningFor.set(c.product_id, (runningFor.get(c.product_id) ?? 0) + 1)

  const createOpen = param('new') === '1' || Boolean(param('product'))
  const openCreate = (productId?: string) => setParam({ new: '1', product: productId ?? null }, { push: true })
  const closeCreate = () => setParam({ new: null, product: null })
  const howOpen = param('how') === '1'

  const onCreated = (c: Campaign) => {
    editList((l) => [c, ...l.filter((x) => x.id !== c.id)])
    closeCreate()
    if (c.workspace !== wsId && !showAll) setParam({ all: '1' })
    toast(`Campaign launched · ${c.product} · ${c.days} days`)
    // after the panel has closed and returned focus, move to the new card
    window.setTimeout(() => {
      setHighlight(c.id)
      window.clearTimeout(hlTimer.current)
      hlTimer.current = window.setTimeout(() => setHighlight(null), 2600)
    }, 240)
  }
  const showCampaigns = () => {
    closeCreate()
    if (elsewhere > 0 && !showAll) setParam({ all: '1' })
    window.setTimeout(() => {
      const el = document.getElementById('proof-campaigns')?.closest('section')
      el?.scrollIntoView({ block: 'start' })
      el?.querySelector<HTMLElement>('article')?.focus({ preventScroll: true })
    }, 240)
  }
  const onChanged = (c: Campaign) => editList((l) => l.map((x) => (x.id === c.id ? c : x)))
  const onDeleted = (id: string) => {
    editList((l) => l.filter((x) => x.id !== id))
    toast('Campaign deleted')
  }

  const sample = (() => {
    const c = mine.find((x) => x.status === 'active') ?? mine[0]
    const fromCampaign = c ? all.find((p) => p.product_id === c.product_id && p.eligible) : undefined
    const p = fromCampaign ?? eligible[0] ?? all.find((x) => x.eligible)
    return p ? { p, goals: c && fromCampaign ? c.goals : p.goals, skins: c && fromCampaign ? c.skin_types : [] } : null
  })()

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow={eyebrow}
        title="Promote"
        answer={answerLine(all, brand)}
        actions={
          <>
            <ToolButton onClick={() => setParam({ how: '1' }, { push: true })}>
              <Smartphone size={14} strokeWidth={1.6} aria-hidden />
              How shoppers see it
            </ToolButton>
            <button
              type="button"
              disabled={!eligible.length}
              onClick={() => openCreate()}
              className="hit44 inline-flex h-8 items-center gap-1.5 rounded-xs border-0 bg-selected px-3 text-proof-small font-medium text-inverse transition-[transform,background] duration-150 hover:bg-ink/85 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden />
              New campaign
            </button>
          </>
        }
      />

      <HowItWorks />

      {/* Side by side once the content area is 1080 px wide (1440 px screens, or 1280 with the nav collapsed). */}
      <div className="@container">
        <div className="grid items-start gap-4 @[1080px]:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-4 @[1080px]:col-span-7">
            <EligibleTable
              rows={eligible}
              extras={rows}
              products={products}
              brand={brand}
              othersEligible={othersEligible}
              runningFor={runningFor}
              onPromote={(id) => openCreate(id)}
            />
            {notEligible.length ? <NotEligible items={notEligible} extras={rows} brand={brand} carry={carry} /> : null}
          </div>
  
          <Panel
            className="@[1080px]:col-span-5"
            id="proof-campaigns"
            title="Your campaigns"
            meta={
              <span className="font-mono text-[11px] text-ink-2 tnum">
                {running} of {MAX_ACTIVE} running
              </span>
            }
            actions={
              elsewhere > 0 ? (
                <ToolButton pressed={showAll} onClick={() => setParam({ all: showAll ? null : '1' })}>
                  {showAll ? 'This workspace only' : `+${elsewhere} in other workspaces`}
                </ToolButton>
              ) : undefined
            }
            footnote={
              <span aria-live="polite">
                {updated ? `Updated ${updated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · refreshes every 30 s while this tab is open.` : 'Loading…'} The running cap of {MAX_ACTIVE} counts every workspace on this account.
              </span>
            }
          >
            {camps.status === 'error' && !camps.data ? (
              <ErrorState compact title="Campaigns couldn’t load" body="No stats are shown rather than old ones." onRetry={() => void camps.refetch()} />
            ) : !camps.data ? (
              <div role="status" aria-label="Loading campaigns" className="flex flex-col gap-3">
                <Bone className="h-[300px] w-full" />
              </div>
            ) : listed.length ? (
              <div className="@container">
                <div className="grid items-start gap-3 @[700px]:grid-cols-2">
                  {listed.map((c) => (
                    <CampaignCard key={c.id} c={c} onChanged={onChanged} onDeleted={onDeleted} onStale={() => void refetch()} highlight={highlight === c.id} otherWorkspace={c.workspace !== wsId ? (c.workspace === 'retailer' ? 'the retailer workspace' : `${c.workspace}’s workspace`) : null} />
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                compact
                glyph="00"
                title={eligible.length ? 'No campaigns yet' : 'Nothing to promote yet'}
                body={
                  eligible.length
                    ? `Pick one of the ${eligible.length} eligible ${eligible.length === 1 ? 'product' : 'products'}, choose who should see it, and follow impressions, clicks, adds and the lift over a randomised holdout here.`
                    : 'Campaigns can only run for Proven products. The list on the left says what each product still needs.'
                }
                action={eligible.length ? { label: 'Create a campaign', onClick: () => openCreate() } : { label: 'See the product scoreboard', to: `${sectionPath('products')}${carry}` }}
              />
            )}
          </Panel>
        </div>
      </div>

      <CreateCampaign open={createOpen} onClose={closeCreate} products={eligible} rows={rows} workspace={{ id: wsId ?? 'retailer', label: wsLabel }} initialProduct={param('product')} running={running} onCreated={onCreated} onShowCampaigns={showCampaigns} />

      <SidePanel open={howOpen} onClose={() => setParam({ how: null })} title="How shoppers see it" subtitle="The closed loop, from this screen to the Willow app and back" width={560} labelledBy="proof-how">
        <HowShoppers sample={sample ? { ...sample, extra: rows.get(sample.p.product_id) } : null} />
      </SidePanel>
    </div>
  )
}

/* ───────────────────────────── how it works ───────────────────────────── */

const STEPS = [
  { title: 'Evidence decides eligibility', body: 'Only Proven products (30+ people, lift above zero across its 95% interval), for the goals and skin types where they show their own lift.' },
  { title: 'You choose who sees it', body: 'Goals and skin types from that evidence, for 7, 14 or 30 days. One labelled card on the shopper’s Routine page.' },
  { title: 'We measure the lift', body: 'A randomised holdout never sees the card; adoption is compared between the two groups, with its interval.' },
]
const RULES = ['Money buys reach, never rank or eligibility.', 'Always labelled “Sponsored”, with “Why am I seeing this?” one tap away.', 'Organic recommendations never read campaign data.']

function HowItWorks() {
  return (
    <section aria-labelledby="proof-how-works" className="rounded-sm border border-line bg-surface">
      <h2 id="proof-how-works" className="sr-only">
        How proof-gated promotion works
      </h2>
      <ol className="m-0 grid list-none gap-px p-0 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 border-line px-4 py-3 max-md:[&:not(:last-child)]:border-b md:[&:not(:last-child)]:border-r">
            <span aria-hidden className="mt-px grid size-5 shrink-0 place-items-center rounded-full border border-proof-leaf-line font-mono text-[11px] text-proof-leaf tnum">
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-proof-body font-medium text-ink">{s.title}</span>
              <span className="text-proof-small text-ink-2">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <ul aria-label="Rules" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2 text-proof-small text-ink">
        {RULES.map((r) => (
          <li key={r} className="flex items-baseline gap-1.5">
            <span aria-hidden className="text-proof-leaf">
              ✓
            </span>
            {r}
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ───────────────────────────── eligible products ───────────────────────────── */

function ProductCell({ p, extra, live = 0 }: { p: PromoEligibility; extra?: ProductRow; live?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <ProductImage product={{ image_url: extra?.image_url, category: extra?.category ?? '', name: p.product }} size={26} decorative />
      <span className="flex min-w-0 flex-col leading-[1.25]">
        <span className="truncate text-ink" title={p.product}>
          {p.product}
        </span>
        <span className="truncate text-[11.5px] text-ink-2">
          {p.brand}
          {live ? <span className="text-ink"> · <span aria-hidden className="text-proof-leaf">●</span> {live} running</span> : null}
        </span>
      </span>
    </span>
  )
}

function EligibleTable({ rows, extras, products, brand, othersEligible, runningFor, onPromote }: { rows: PromoEligibility[]; extras: Map<string, ProductRow>; products: Products | null; brand: string | null; othersEligible: number; runningFor: Map<string, number>; onPromote: (id: string) => void }) {
  const columns: Column<PromoEligibility>[] = [
    {
      id: 'product',
      header: 'Product',
      rowHeader: true,
      width: '34%',
      sortValue: (r) => r.product,
      firstDir: 'asc',
      cell: (r) => <ProductCell p={r} extra={extras.get(r.product_id)} live={runningFor.get(r.product_id) ?? 0} />,
      csv: (r) => `${r.product} (${r.brand})`,
    },
    {
      id: 'rate',
      header: <Term id="real_change">Real change</Term>,
      headerText: 'Real change rate',
      width: '132px',
      sortValue: (r) => extras.get(r.product_id)?.rate ?? null,
      cell: (r) => {
        const x = extras.get(r.product_id)
        return x ? <EvidenceBar rate={x.rate} lo={x.rate_lo} hi={x.rate_hi} base={x.base_rate} n={x.n} /> : <span className="text-proof-small text-ink-2">—</span>
      },
      csv: (r) => extras.get(r.product_id)?.rate ?? '',
    },
    {
      id: 'lift',
      header: <Term id="lift" />,
      headerText: 'Lift',
      align: 'right',
      width: '76px',
      sortValue: (r) => extras.get(r.product_id)?.lift ?? null,
      cell: (r) => {
        const x = extras.get(r.product_id)
        return <LiftValue lift={x?.lift} lo={x?.lift_lo} hi={x?.lift_hi} />
      },
    },
    {
      id: 'targets',
      header: 'Can target',
      cell: (r) => (
        <span className="flex min-w-0 flex-col leading-[1.25]">
          <span className="truncate text-ink" title={r.goals.map(goalLabel).join(', ')}>
            {r.goals.map(goalLabel).join(', ')}
          </span>
          <span className="truncate text-[11.5px] text-ink-2" title={`Skin types: ${r.skin_types.map(skinLabel).join(', ')}`}>
            {r.skin_types.length === 5 ? 'Every skin type' : `${r.skin_types.length} skin ${r.skin_types.length === 1 ? 'type' : 'types'}: ${r.skin_types.map((s) => skinLabel(s).toLowerCase()).join(', ')}`}
          </span>
        </span>
      ),
      csv: (r) => `${r.goals.join(' ')} | ${r.skin_types.join(' ')}`,
    },
    {
      id: 'action',
      header: <span className="sr-only">Action</span>,
      headerText: 'Running campaigns',
      align: 'right',
      width: '80px',
      cell: (r) => (
        <span className="inline-flex items-center justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onPromote(r.product_id)
            }}
            className="hit44 inline-flex h-7 items-center rounded-xs border border-line-strong bg-transparent px-2 text-proof-small text-ink hover:bg-glass"
          >
            Promote<span className="sr-only"> {r.product}</span>
          </button>
        </span>
      ),
      csv: (r) => runningFor.get(r.product_id) ?? 0,
    },
  ]
  const title = brand ? 'Your products that can be promoted' : 'Products that can be promoted'
  const badges = (
    <>
      <ProofTierChip tier="proven" size="sm" />
      {products ? <SimBadge cohort={products.cohort} /> : null}
    </>
  )
  return (
    <Panel
      title={rows.length ? undefined : title}
      id="proof-eligible"
      meta={rows.length ? undefined : badges}
      flush
      footnote={
        <>
          Evidence: mixed cohort, all time (what shoppers see), whatever the filters above say. Goals and skin types are the ones where the product has its own positive lift with 10+ people.
          {brand && othersEligible ? ` ${othersEligible} more eligible ${othersEligible === 1 ? 'product belongs' : 'products belong'} to other brands; a brand workspace promotes its own.` : ''}
        </>
      }
    >
      {rows.length ? (
        <DataTable
          caption={title}
          heading={
            <>
              <h2 className="m-0 text-proof-h font-medium text-ink">{title}</h2>
              {badges}
            </>
          }
          columns={columns}
          rows={rows}
          rowKey={(r) => r.product_id}
          onRowClick={(r) => onPromote(r.product_id)}
          rowLabel={(r) => `Promote ${r.product}`}
          minWidth={560}
          maxHeight={520}
          csv={{ name: 'willow-proof-promote-eligible.csv', meta: products ? csvMeta(products, 'promotion eligibility') : ['Willow Proof promotion eligibility · mixed cohort · all time', 'Cosmetic outcome associations from photos, not proof of effect. Not a medical assessment.'] }}
        />
      ) : (
        <div className="p-4">
          <EmptyState
            compact
            glyph="00"
            title={brand ? `No ${brand} product clears the bar yet` : 'No product clears the bar yet'}
            body="A product becomes eligible at Proven: 30+ people with 8 weeks of readings, and a lift over non-users whose 95% interval stays above zero. What each product still needs is listed below."
          />
        </div>
      )}
    </Panel>
  )
}

/* ───────────────────────────── not eligible ───────────────────────────── */

function NotEligible({ items, extras, brand, carry }: { items: PromoEligibility[]; extras: Map<string, ProductRow>; brand: string | null; carry: string }) {
  return (
    <details className="group rounded-sm border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-proof-h font-medium text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} strokeWidth={1.8} aria-hidden className="text-ink-2 transition-transform duration-150 group-open:rotate-90" />
        Not eligible yet
        <span className="font-mono text-[11px] font-normal text-ink-2 tnum">{items.length}</span>
        <span className="ml-auto hidden text-proof-small font-normal text-ink-2 sm:inline">{brand ? `${brand}’s products` : 'Every brand'} · what each still needs</span>
      </summary>
      <ul className="m-0 flex max-h-[420px] list-none flex-col overflow-y-auto border-t border-line p-0">
        {items.map((p) => (
          <li key={p.product_id} className="grid grid-cols-1 gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="min-w-0 flex-1">
                <ProductCell p={p} extra={extras.get(p.product_id)} />
              </span>
              <ProofTierChip tier={p.tier} size="sm" />
            </span>
            <span className="text-proof-small text-ink-2">
              {p.reasons.join(' ')}{' '}
              <Link to={`${sectionPath('products', p.product_id)}${carry}`} className="whitespace-nowrap text-ink underline decoration-ink-2/60 underline-offset-[3px] hover:decoration-ink">
                Product detail
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/* ───────────────────────────── how shoppers see it ───────────────────────────── */

const LOOP = [
  { title: 'Launch a campaign here', body: 'A Proven product, the goals and skin types its evidence covers, and a duration.' },
  { title: 'A matching shopper opens Routine', body: 'In the Willow app, someone whose profile goals overlap and whose skin type is targeted, and who doesn’t already use the product. 20% (or your holdout share) are held out at random and never see it.' },
  { title: 'The card appears under their routine', body: 'At most one sponsored card a day, labelled first. An impression counts once half the card is on screen; each person once a day.' },
  { title: 'The numbers land here', body: 'Impressions, “View product” clicks and adds to routine update this screen within 30 seconds; the holdout comparison follows once each group has 10 people.' },
]

function HowShoppers({ sample }: { sample: { p: PromoEligibility; goals: string[]; skins: string[]; extra?: ProductRow } | null }) {
  return (
    <div className="flex flex-col gap-5">
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {LOOP.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span aria-hidden className="mt-px grid size-5 shrink-0 place-items-center rounded-full border border-proof-leaf-line font-mono text-[11px] text-proof-leaf tnum">
              {i + 1}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-proof-body font-medium text-ink">{s.title}</span>
              <span className="text-proof-small text-ink-2">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      {sample ? (
        <div className="flex flex-col gap-2">
          <span className="text-proof-small font-medium text-ink">The card, as drawn in the app</span>
          <ShopperPreview product={sample.p} extra={sample.extra} goals={sample.goals} skinTypes={sample.skins} />
        </div>
      ) : (
        <p className="m-0 rounded-sm border border-dashed border-line-strong p-4 text-proof-small text-ink-2">No product clears the evidence bar yet, so there is no card to show.</p>
      )}
      <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-sunken p-3 text-proof-small text-ink-2">
        <span className="text-ink">Try it yourself</span>
        <span>Open the Willow app with a profile whose goals and skin type match a running campaign (and without the product in the routine). The card shows under the routine, and this screen counts the impression.</span>
        <a href="/routine" target="_blank" rel="noopener" className="hit44 mt-1 inline-flex h-8 items-center gap-1.5 self-start rounded-xs border border-line-strong px-3 text-ink no-underline hover:bg-glass">
          Open the Willow app’s Routine
          <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    </div>
  )
}
