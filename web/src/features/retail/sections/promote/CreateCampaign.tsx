import { Check } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'

import { api, type Campaign, type PromoEligibility, type SkinType } from '../../../../lib/api'
import { useAuth } from '../../../../lib/useAuth'
import { ProductImage } from '../../../../components/willow/ProductImage'
import { DAYS, DEFAULT_HOLDOUT, goalLabel, HOLDOUTS, MAX_ACTIVE, promoError, skinLabel, skinText, type Days, type PromoError } from '../../promote'
import type { ProductRow } from '../../types'
import { int, pct, pts, ProofTierChip, SearchField, Segmented, SidePanel } from '../../ui'
import { ShopperPreview } from './ShopperPreview'

const STEPS = ['Product', 'Audience', 'Duration', 'Review'] as const

const endDate = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/**
 * Create a campaign, in a side panel: product → audience → duration and holdout → review, with the shopper's card
 * drawn live beside the form (in the review step on phones). Only eligible products, goals and skin types are
 * offered; the api checks them again and its reasons are shown inline when it refuses (422), as is the running cap
 * (429). `?new=1&product=<id>` opens it with the product chosen.
 */
export function CreateCampaign({ open, onClose, products, rows, workspace, initialProduct, running, onCreated, onShowCampaigns }: {
  open: boolean
  onClose: () => void
  /** Eligible products this workspace may promote. */
  products: PromoEligibility[]
  rows: Map<string, ProductRow>
  workspace: { id: string; label: string }
  initialProduct: string | null
  running: number
  onCreated: (c: Campaign) => void
  /** Close and go to the campaigns list (the way out of a 429: pause one first). */
  onShowCampaigns: () => void
}) {
  const { getIdToken } = useAuth()
  const [step, setStep] = useState(0)
  const [productId, setProductId] = useState<string | null>(null)
  const [goals, setGoals] = useState<string[]>([])
  const [skins, setSkins] = useState<string[]>([])
  const [days, setDays] = useState<Days>(14)
  const [holdout, setHoldout] = useState<number>(DEFAULT_HOLDOUT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<PromoError | null>(null)
  const body = useRef<HTMLDivElement>(null)

  // Each opening starts fresh; a product in the URL skips to the audience. (State adjusted while rendering, when
  // the panel opens or its product changes, rather than in an effect: no extra render with stale values.)
  const opening = open ? `open|${initialProduct ?? ''}` : 'closed'
  const [seen, setSeen] = useState('closed')
  if (opening !== seen) {
    setSeen(opening)
    if (open) {
      const pre = initialProduct && products.some((p) => p.product_id === initialProduct) ? initialProduct : null
      const p = products.find((x) => x.product_id === pre)
      setProductId(pre)
      setGoals(p ? [...p.goals] : [])
      setSkins([])
      setDays(14)
      setHoldout(DEFAULT_HOLDOUT)
      setError(null)
      setStep(pre ? 1 : 0)
    }
  }

  const product = products.find((p) => p.product_id === productId) ?? null
  const preselectedMissing = open && initialProduct && !products.some((p) => p.product_id === initialProduct) ? initialProduct : null
  const choose = (p: PromoEligibility) => {
    setProductId(p.product_id)
    setGoals([...p.goals])
    setSkins([])
    setError(null)
  }
  const canNext = [Boolean(product), goals.length > 0, true, true]
  const go = (s: number) => {
    setStep(s)
    setError(null)
    requestAnimationFrame(() => body.current?.querySelector<HTMLElement>('[data-step-focus]')?.focus({ preventScroll: false }))
  }

  const launch = async () => {
    if (!product || busy) return
    setBusy(true)
    setError(null)
    try {
      const c = await api.createCampaign(await getIdToken(), {
        product_id: product.product_id,
        workspace: workspace.id,
        goals,
        skin_types: skins as SkinType[],
        days,
        placement: 'routine',
        holdout_pct: holdout,
      })
      onCreated(c)
    } catch (e) {
      setError(promoError(e))
    } finally {
      setBusy(false)
    }
  }

  const extra = product ? rows.get(product.product_id) : undefined
  const preview = product ? <ShopperPreview product={product} extra={extra} goals={goals} skinTypes={skins} /> : null

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="New campaign"
      subtitle={`${workspace.label} · ${running} of ${MAX_ACTIVE} running`}
      width={980}
      labelledBy="proof-new-campaign"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-ink-2 tnum">
            Step {step + 1} of {STEPS.length}
          </span>
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <button type="button" onClick={() => go(step - 1)} className="hit44 inline-flex h-8 items-center rounded-xs border border-line-strong bg-transparent px-3 text-proof-small text-ink hover:bg-glass">
                Back
              </button>
            ) : (
              <button type="button" onClick={onClose} className="hit44 inline-flex h-8 items-center rounded-xs border border-line-strong bg-transparent px-3 text-proof-small text-ink hover:bg-glass">
                Cancel
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" disabled={!canNext[step]} onClick={() => go(step + 1)} className="hit44 inline-flex h-8 items-center rounded-xs border-0 bg-selected px-3.5 text-proof-small font-medium text-inverse hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-45">
                Next: {STEPS[step + 1]}
              </button>
            ) : (
              <button type="button" disabled={!product || !goals.length || busy} aria-busy={busy || undefined} onClick={() => void launch()} className="hit44 inline-flex h-8 items-center rounded-xs border-0 bg-selected px-3.5 text-proof-small font-medium text-inverse hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-45">
                {busy ? 'Launching…' : `Launch for ${days} days`}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div ref={body} className="flex flex-col gap-5">
        <Stepper step={step} canReach={(i) => i <= step || canNext.slice(0, i).every(Boolean)} onGo={go} />
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-4">
            {step === 0 ? <ProductStep products={products} rows={rows} value={productId} onChoose={choose} missing={preselectedMissing} workspace={workspace.label} /> : null}
            {step === 1 && product ? <AudienceStep product={product} goals={goals} setGoals={setGoals} skins={skins} setSkins={setSkins} /> : null}
            {step === 2 ? <DurationStep days={days} setDays={setDays} holdout={holdout} setHoldout={setHoldout} /> : null}
            {step === 3 && product ? (
              <ReviewStep product={product} extra={extra} workspace={workspace.label} goals={goals} skins={skins} days={days} holdout={holdout} error={error} onFix={go} running={running} onShowCampaigns={onShowCampaigns} />
            ) : null}
            {step === 3 ? <div className="md:hidden">{preview}</div> : null}
          </div>
          <aside aria-label="Live preview" className="hidden md:block">
            <div className="sticky top-0 flex flex-col gap-2">
              <span className="text-proof-small font-medium text-ink">How shoppers will see it</span>
              {preview ?? <p className="m-0 rounded-sm border border-dashed border-line-strong p-4 text-proof-small text-ink-2">Choose a product to see the card shoppers get, with its evidence line.</p>}
            </div>
          </aside>
        </div>
      </div>
    </SidePanel>
  )
}

function Stepper({ step, canReach, onGo }: { step: number; canReach: (i: number) => boolean; onGo: (i: number) => void }) {
  return (
    <ol aria-label="Steps" className="m-0 grid list-none grid-cols-4 gap-1.5 p-0">
      {STEPS.map((s, i) => {
        const done = i < step
        const on = i === step
        return (
          <li key={s} className="min-w-0">
            <button
              type="button"
              disabled={!canReach(i)}
              aria-current={on ? 'step' : undefined}
              onClick={() => !on && onGo(i)}
              className={`flex h-9 w-full min-w-0 items-center gap-2 border-0 border-t-2 bg-transparent px-0 pt-1 text-left text-proof-small transition-colors disabled:cursor-default ${on ? 'border-ink font-medium text-ink' : done ? 'border-proof-leaf text-ink hover:text-ink' : 'border-line-strong text-ink-2'}`}
            >
              <span aria-hidden className="font-mono text-[11px] tnum">{done ? <Check size={12} strokeWidth={2} className="text-proof-leaf" /> : i + 1}</span>
              <span className="truncate">{s}</span>
              {done ? <span className="sr-only">(done)</span> : null}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function StepTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 data-step-focus tabIndex={-1} className="m-0 text-proof-h font-medium text-ink outline-none">
        {children}
      </h3>
      {hint ? <p className="m-0 max-w-[62ch] text-proof-small text-ink-2">{hint}</p> : null}
    </div>
  )
}

function ProductStep({ products, rows, value, onChoose, missing, workspace }: { products: PromoEligibility[]; rows: Map<string, ProductRow>; value: string | null; onChoose: (p: PromoEligibility) => void; missing: string | null; workspace: string }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => products.filter((p) => !q || `${p.product} ${p.brand}`.toLowerCase().includes(q.toLowerCase())), [products, q])
  return (
    <>
      <StepTitle hint={`Only Proven products with at least one goal the evidence covers are listed. ${workspace === 'Retailer · all brands' ? 'As the retailer you can promote any brand.' : 'A brand workspace promotes its own products.'}`}>Which product?</StepTitle>
      {missing ? <p role="alert" className="m-0 rounded-sm border border-line bg-sunken p-3 text-proof-small text-ink">The product in the link can’t be promoted from this workspace (not Proven, or another brand’s). Choose one below.</p> : null}
      {products.length > 8 ? <SearchField label="Search eligible products" value={q} onChange={setQ} placeholder="Search products" /> : null}
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="sr-only">Eligible products</legend>
        {shown.map((p) => {
          const r = rows.get(p.product_id)
          const on = p.product_id === value
          return (
            <label key={p.product_id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xs border px-3 py-2 transition-colors ${on ? 'border-proof-leaf-line bg-proof-leaf-soft' : 'border-line hover:bg-glass'}`}>
              <input type="radio" name="promote-product" checked={on} onChange={() => onChoose(p)} className="size-4 shrink-0 accent-[var(--proof-leaf)]" />
              <ProductImage product={{ image_url: r?.image_url, category: r?.category ?? '', name: p.product }} size={30} decorative />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-proof-body text-ink" title={p.product}>
                  {p.product}
                </span>
                <span className="truncate text-proof-small text-ink-2">
                  {p.brand} · {p.goals.map(goalLabel).join(', ')}
                </span>
              </span>
              {r && r.rate !== null ? (
                <span className="hidden shrink-0 flex-col items-end font-mono text-[11px] text-ink-2 tnum sm:flex">
                  <span className="text-proof-body text-ink">{pct(r.rate)}</span>
                  <span>
                    {pts(r.lift)} · n={int(r.n)}
                  </span>
                </span>
              ) : null}
            </label>
          )
        })}
        {!shown.length ? <p className="m-0 py-3 text-proof-small text-ink-2">No eligible product matches “{q}”.</p> : null}
      </fieldset>
    </>
  )
}

function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`hit44 inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-proof-small transition-colors ${on ? 'border-proof-leaf-line bg-proof-leaf-soft text-ink' : 'border-line-strong text-ink-2 hover:bg-glass hover:text-ink'} disabled:opacity-45`}
    >
      {on ? <Check size={12} strokeWidth={2} aria-hidden className="text-proof-leaf" /> : null}
      {children}
    </button>
  )
}

function AudienceStep({ product, goals, setGoals, skins, setSkins }: { product: PromoEligibility; goals: string[]; setGoals: (g: string[]) => void; skins: string[]; setSkins: (s: string[]) => void }) {
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  return (
    <>
      <StepTitle hint="The card shows to people whose profile goals include at least one of these, and whose skin type is targeted. Only goals and skin types where this product has its own positive lift (10+ people each) can be chosen.">Who should see it?</StepTitle>
      <div role="group" aria-labelledby="promote-goals" className="flex flex-col gap-2">
        <span id="promote-goals" className="text-proof-small text-ink-2">
          Goals <span className="text-ink-2">· at least one</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {product.goals.map((g) => (
            <Chip key={g} on={goals.includes(g)} onClick={() => setGoals(toggle(goals, g))}>
              {goalLabel(g)}
            </Chip>
          ))}
        </div>
        {!goals.length ? (
          <p role="alert" className="m-0 text-proof-small text-ink">
            Choose at least one goal.
          </p>
        ) : null}
      </div>
      <div role="group" aria-labelledby="promote-skins" className="flex flex-col gap-2">
        <span id="promote-skins" className="text-proof-small text-ink-2">
          Skin types
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={!skins.length} onClick={() => setSkins([])}>
            All eligible skin types
          </Chip>
          {product.skin_types.map((s) => (
            <Chip key={s} on={skins.includes(s)} onClick={() => setSkins(toggle(skins, s))}>
              {skinLabel(s)}
            </Chip>
          ))}
        </div>
        <p className="m-0 text-proof-small text-ink-2">{skinText(skins, product.skin_types)}. People without a skin type in their profile never match.</p>
      </div>
    </>
  )
}

function DurationStep({ days, setDays, holdout, setHoldout }: { days: Days; setDays: (d: Days) => void; holdout: number; setHoldout: (h: number) => void }) {
  return (
    <>
      <StepTitle hint="The campaign starts at once and ends by itself. You can pause and resume it while it runs.">How long, and how will you measure it?</StepTitle>
      <div className="flex flex-col gap-2">
        <span className="text-proof-small text-ink-2">Duration</span>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Duration" options={DAYS.map((d) => ({ value: String(d) as `${Days}`, label: `${d} days` }))} value={String(days) as `${Days}`} onChange={(v) => setDays(Number(v) as Days)} />
          <span className="font-mono text-[11px] text-ink-2 tnum">Ends {endDate(days)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-proof-small text-ink-2">Randomised holdout</span>
        <div className="self-start">
          <Segmented label="Randomised holdout" options={HOLDOUTS.map((h) => ({ value: String(h), label: `${Math.round(h * 100)}%${h === DEFAULT_HOLDOUT ? ' · default' : ''}` }))} value={String(holdout)} onChange={(v) => setHoldout(Number(v))} />
        </div>
        <div className="flex max-w-[64ch] flex-col gap-1.5 rounded-sm border border-line bg-sunken p-3 text-proof-small text-ink-2">
          <p className="m-0 text-ink">
            {Math.round(holdout * 100)}% of the people this campaign matches are picked at random and never see the card.
          </p>
          <p className="m-0">Comparing how many in each group add the product to their routine (by any path) shows the adoption your campaign caused, not only who clicked. A larger holdout settles the answer sooner but reaches fewer people. The comparison appears once each group has 10 people.</p>
        </div>
      </div>
    </>
  )
}

function ReviewStep({ product, extra, workspace, goals, skins, days, holdout, error, onFix, running, onShowCampaigns }: { product: PromoEligibility; extra?: ProductRow; workspace: string; goals: string[]; skins: string[]; days: Days; holdout: number; error: PromoError | null; onFix: (step: number) => void; running: number; onShowCampaigns: () => void }) {
  const rows: [string, ReactNode, number | null][] = [
    ['Workspace', workspace, null],
    [
      'Product',
      <span key="p" className="inline-flex flex-wrap items-center gap-2">
        {product.product} · {product.brand} <ProofTierChip tier={product.tier} size="sm" />
      </span>,
      0,
    ],
    ['Goals', goals.map(goalLabel).join(', '), 1],
    ['Skin types', skinText(skins, product.skin_types), 1],
    ['Placement', 'Routine page, under the shopper’s own routine; at most one sponsored card a day', null],
    ['Duration', `${days} days, ends ${endDate(days)}`, 2],
    ['Holdout', `${Math.round(holdout * 100)}% of matched people, at random`, 2],
  ]
  return (
    <>
      <StepTitle hint="Payment buys reach only: it never changes a product’s rank, its eligibility, or anyone’s own recommendations. If the product drops below Proven, the card stops showing.">Review and launch</StepTitle>
      <dl className="m-0 flex flex-col rounded-sm border border-line">
        {rows.map(([k, v, fix]) => (
          <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-line px-3 py-2 last:border-b-0">
            <dt className="text-proof-small text-ink-2">{k}</dt>
            <dd className="m-0 min-w-0 text-proof-body text-ink">{v}</dd>
            {fix !== null ? (
              <button type="button" onClick={() => onFix(fix)} className="hit44 border-0 bg-transparent p-0 text-proof-small text-ink-2 underline underline-offset-4 hover:text-ink">
                Edit<span className="sr-only"> {k.toLowerCase()}</span>
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </dl>
      {extra && extra.rate !== null ? (
        <p className="m-0 text-proof-small text-ink-2">
          Evidence shoppers see (mixed cohort, all time): {pct(extra.rate)} had a real change held to week 8 vs {pct(extra.base_rate)} of non-users, {pts(extra.lift)}, n={int(extra.n)}.
        </p>
      ) : null}
      {running >= MAX_ACTIVE && !error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-line bg-sunken p-3 text-proof-small text-ink">
          <span className="min-w-0 flex-1">{MAX_ACTIVE} campaigns are already running. Launching will be refused until you pause or delete one.</span>
          <button type="button" onClick={onShowCampaigns} className="hit44 inline-flex h-8 items-center rounded-xs border border-line-strong bg-transparent px-2.5 text-proof-small text-ink hover:bg-glass">
            See running campaigns
          </button>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="flex flex-col gap-1.5 rounded-sm border border-line-strong bg-sunken p-3.5">
          <span className="text-proof-body font-medium text-ink">{error.title}</span>
          <span className="text-proof-small text-ink-2">{error.message}</span>
          {error.reasons.length ? (
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-proof-small text-ink">
              {error.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          {error.kind === 'too_many' ? (
            <button type="button" onClick={onShowCampaigns} className="hit44 mt-1 inline-flex h-8 items-center self-start rounded-xs border border-line-strong bg-transparent px-2.5 text-proof-small text-ink hover:bg-glass">
              See running campaigns
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
