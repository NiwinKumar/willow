import { Check } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { api, retailerSegments, type Campaign, type PromoEligibility, type SkinType } from '../../../../lib/api'
import { useAuth } from '../../../../lib/useAuth'
import { blockedReasons, DAYS, DEFAULT_HOLDOUT, goalLabel, HOLDOUT_RANGE, MAX_ACTIVE, promoError, reachRange, skinLabel, type Days, type PromoError } from '../../promote'
import type { ProductRow, Segments } from '../../types'
import { Button, int, LiftValue, pct, ProductCell, ProofTierChip, SearchField, Segmented, SidePanel } from '../../ui'
import { useView } from '../../useView'
import { ErrorBox } from './CampaignCard'
import { ShopperPreview } from './ShopperPreview'

const endDate = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/**
 * New campaign, one scrolling form in a side panel: 1 product (only eligible ones can be picked; the rest are
 * greyed with the reason on hover), 2 audience (the goals and skin types the evidence covers, all ticked; they
 * can only be narrowed), 3 duration and holdout, 4 the exact card a shopper will see. The api checks everything
 * again; its refusals (422 reasons, 429 cap) show above the footer. `?new=<product_id>` opens it with the
 * product chosen, or with the reasons it can't be promoted.
 */
export function CreateCampaign({ open, onClose, eligible, blocked, all, brand, rows, workspace, initialProduct, running, onCreated, onShowCampaigns }: {
  open: boolean
  onClose: () => void
  /** Products this workspace may promote. */
  eligible: PromoEligibility[]
  /** This workspace's products that can't be promoted yet (listed greyed). */
  blocked: PromoEligibility[]
  /** Every product's eligibility, to explain a product in the link that can't be promoted. */
  all: PromoEligibility[]
  brand: string | null
  rows: Map<string, ProductRow>
  workspace: { id: string; label: string }
  initialProduct: string | null
  running: number
  onCreated: (c: Campaign) => void
  /** Close and go to the campaigns list (the way out of a 429: pause one first). */
  onShowCampaigns: () => void
}) {
  const { getIdToken } = useAuth()
  const [productId, setProductId] = useState<string | null>(null)
  const [picking, setPicking] = useState(true)
  const [goals, setGoals] = useState<string[]>([])
  const [skins, setSkins] = useState<string[]>([])
  const [days, setDays] = useState<Days>(14)
  const [holdout, setHoldout] = useState<number>(DEFAULT_HOLDOUT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<PromoError | null>(null)

  const choose = (p: PromoEligibility | undefined) => {
    setProductId(p?.product_id ?? null)
    setGoals(p ? [...p.goals] : [])
    setSkins(p ? [...p.skin_types] : [])
    setPicking(!p)
    setError(null)
  }
  // Each opening starts fresh, with the link's product when it can be promoted. (Adjusted while rendering, when
  // the panel opens or its product changes, rather than in an effect: no extra render with stale values.)
  const opening = open ? `open|${initialProduct ?? ''}` : 'closed'
  const [seen, setSeen] = useState('closed')
  if (opening !== seen) {
    setSeen(opening)
    if (open) {
      choose(eligible.find((p) => p.product_id === initialProduct))
      setDays(14)
      setHoldout(DEFAULT_HOLDOUT)
    }
  }

  const product = eligible.find((p) => p.product_id === productId) ?? null
  const linkBlocked = open && initialProduct && !eligible.some((p) => p.product_id === initialProduct) ? { p: all.find((x) => x.product_id === initialProduct), reasons: blockedReasons(all.find((x) => x.product_id === initialProduct), brand) } : null

  const launch = async () => {
    if (!product || busy) return
    setBusy(true)
    setError(null)
    try {
      const c = await api.createCampaign(await getIdToken(), {
        product_id: product.product_id,
        workspace: workspace.id,
        goals,
        // every covered skin type ticked = "all eligible" ([]), which keeps following the evidence
        skin_types: (skins.length === product.skin_types.length ? [] : skins) as SkinType[],
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

  const capped = running >= MAX_ACTIVE || error?.kind === 'too_many'
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="New campaign"
      subtitle={`${workspace.label} · ${running} of ${MAX_ACTIVE} running`}
      width={600}
      labelledBy="proof-new-campaign"
      footer={
        <div className="flex flex-col gap-3">
          {error && error.kind !== 'too_many' ? <ErrorBox error={error} /> : null}
          {capped ? (
            <div role={error ? 'alert' : undefined} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-pf-amber-soft/50 px-4 py-3 text-proof-small text-ink">
              <span className="min-w-0 flex-1">{MAX_ACTIVE} campaigns are already running. Pause one before launching another.</span>
              <Button kind="secondary" size="sm" onClick={onShowCampaigns}>
                See running campaigns
              </Button>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-proof-small text-ink-2 tnum max-sm:hidden">{product ? `${days} days, ends ${endDate(days)} · ${Math.round(holdout * 100)}% holdout` : 'Choose a product to continue'}</span>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button kind="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button kind="primary" onClick={() => void launch()} disabled={!product || !goals.length || !skins.length || busy || capped}>
                {busy ? 'Launching…' : 'Launch campaign'}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      <form
        className="flex flex-col gap-8 pb-2"
        onSubmit={(e) => {
          e.preventDefault()
          void launch()
        }}
      >
        <Step n={1} title="Product">
          {linkBlocked ? (
            <div role="alert" className="flex flex-col gap-1.5 rounded-card border border-line bg-pf-amber-soft/50 p-4">
              <span className="text-proof-body font-medium text-ink">{linkBlocked.p ? `${linkBlocked.p.product} can’t be promoted yet` : 'That product can’t be promoted'}</span>
              <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-proof-small text-ink-2">
                {linkBlocked.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {eligible.length ? <span className="text-proof-small text-ink-2">Choose an eligible product below.</span> : null}
            </div>
          ) : null}
          {product && !picking ? (
            <div className="flex items-center gap-3 rounded-card border border-proof-leaf-line bg-proof-leaf-soft/40 px-4 py-3">
              <span className="min-w-0 flex-1">
                <ProductCell p={{ product: product.product, brand: product.brand, category: rows.get(product.product_id)?.category ?? '', image_url: rows.get(product.product_id)?.image_url }} size={36} />
              </span>
              <Outcome row={rows.get(product.product_id)} />
              <Button kind="ghost" size="sm" onClick={() => setPicking(true)}>
                Change
              </Button>
            </div>
          ) : (
            <ProductPicker eligible={eligible} blocked={blocked} rows={rows} value={productId} onChoose={(p) => choose(p)} />
          )}
        </Step>

        <Step n={2} title="Audience" hint="Only the goals and skin types this product’s evidence covers. Untick to narrow; you can’t widen.">
          {product ? <Audience product={product} goals={goals} setGoals={setGoals} skins={skins} setSkins={setSkins} /> : <Waiting />}
        </Step>

        <Step n={3} title="Duration and holdout">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label="Duration" options={DAYS.map((d) => ({ value: String(d) as `${Days}`, label: `${d} days` }))} value={String(days) as `${Days}`} onChange={(v) => setDays(Number(v) as Days)} />
            <span className="text-proof-small text-ink-2 tnum">Ends {endDate(days)}</span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="proof-holdout" className="text-proof-body text-ink">
                Randomised holdout
              </label>
              <output htmlFor="proof-holdout" className="text-proof-body font-medium text-ink tnum">
                {Math.round(holdout * 100)}%
              </output>
            </div>
            <input
              id="proof-holdout"
              type="range"
              min={HOLDOUT_RANGE.min * 100}
              max={HOLDOUT_RANGE.max * 100}
              step={HOLDOUT_RANGE.step * 100}
              value={Math.round(holdout * 100)}
              onChange={(e) => setHoldout(Number(e.target.value) / 100)}
              aria-valuetext={`${Math.round(holdout * 100)}% held out`}
              className="h-5 w-full cursor-pointer accent-[var(--proof-leaf)]"
            />
            <p className="m-0 text-proof-small text-ink-2">{Math.round(holdout * 100)}% of matching shoppers never see the card, so the difference in adoption is the lift the campaign caused, not who would have added it anyway.</p>
          </div>
        </Step>

        <Step n={4} title="Preview" hint="The card exactly as a matching shopper sees it in the Willow app.">
          {product ? <ShopperPreview product={product} extra={rows.get(product.product_id)} goals={goals} skinTypes={skins.length === product.skin_types.length ? [] : skins} /> : <Waiting />}
        </Step>
      </form>
    </SidePanel>
  )
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <legend className="contents">
        <span className="flex items-center gap-2.5">
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border border-line text-proof-label font-medium text-ink-2 tnum">
            {n}
          </span>
          <span className="text-proof-h text-ink">{title}</span>
        </span>
      </legend>
      {hint ? <p className="-mt-2 m-0 pl-[34px] text-proof-small text-ink-2 max-sm:pl-0">{hint}</p> : null}
      <div className="flex min-w-0 flex-col gap-4 pl-[34px] max-sm:pl-0">{children}</div>
    </fieldset>
  )
}

function Waiting() {
  return <p className="m-0 rounded-card border border-dashed border-line px-4 py-3 text-proof-small text-ink-2">Choose a product first.</p>
}

/** "63% vs 29% · +34 pts" (n and the intervals on hover, in the kit cells). */
function Outcome({ row }: { row?: ProductRow }) {
  if (!row || row.rate === null) return null
  return (
    <span className="hidden shrink-0 flex-col items-end gap-0.5 text-proof-small sm:flex">
      <span className="text-ink tnum">
        {pct(row.rate)} <span className="text-ink-2">vs {pct(row.base_rate)}</span>
      </span>
      <LiftValue lift={row.lift} lo={row.lift_lo} hi={row.lift_hi} />
    </span>
  )
}

function ProductPicker({ eligible, blocked, rows, value, onChoose }: { eligible: PromoEligibility[]; blocked: PromoEligibility[]; rows: Map<string, ProductRow>; value: string | null; onChoose: (p: PromoEligibility) => void }) {
  const [q, setQ] = useState('')
  const match = (p: PromoEligibility) => !q || `${p.product} ${p.brand}`.toLowerCase().includes(q.toLowerCase())
  const shown = useMemo(() => eligible.filter(match), [eligible, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const greyed = useMemo(() => blocked.filter(match), [blocked, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const cell = (p: PromoEligibility) => ({ product: p.product, brand: p.brand, category: rows.get(p.product_id)?.category ?? '', image_url: rows.get(p.product_id)?.image_url })
  return (
    <div className="flex flex-col gap-3">
      {eligible.length + blocked.length > 8 ? <SearchField label="Search products" value={q} onChange={setQ} placeholder="Search products" /> : null}
      <div role="radiogroup" aria-label="Product" className="flex max-h-[340px] flex-col overflow-y-auto rounded-card border border-line">
        {shown.map((p) => {
          const on = p.product_id === value
          return (
            <label key={p.product_id} className={`flex min-h-14 cursor-pointer items-center gap-3 border-b border-line px-4 py-2 transition-colors last:border-b-0 ${on ? 'bg-proof-leaf-soft/50' : 'hover:bg-pf-hover'}`}>
              <input type="radio" name="campaign-product" checked={on} onChange={() => onChoose(p)} className="size-4 shrink-0 accent-[var(--proof-leaf)]" />
              <span className="min-w-0 flex-1">
                <ProductCell p={cell(p)} />
              </span>
              <Outcome row={rows.get(p.product_id)} />
            </label>
          )
        })}
        {greyed.length ? (
          <>
            <span className="sticky top-0 border-b border-line bg-pf-bg2 px-4 py-2 text-proof-small text-ink-2">Not eligible yet · hover for why</span>
            {greyed.map((p) => (
              <BlockedRow key={p.product_id} p={p} cell={cell(p)} />
            ))}
          </>
        ) : null}
        {!shown.length && !greyed.length ? <p className="m-0 px-4 py-6 text-center text-proof-small text-ink-2">No product matches “{q}”.</p> : null}
      </div>
    </div>
  )
}

function BlockedRow({ p, cell }: { p: PromoEligibility; cell: { product: string; brand: string; category: string; image_url?: string | null } }) {
  // A native title, not the kit tooltip: the kit's portalled tooltip sits under a modal dialog's top layer.
  const why = p.reasons.join(' ') || 'Not Proven yet.'
  return (
    <div tabIndex={0} aria-disabled="true" title={why} className="flex min-h-14 cursor-not-allowed items-center gap-3 border-b border-line px-4 py-2 last:border-b-0">
      <span aria-hidden className="size-4 shrink-0 rounded-full border border-line-strong opacity-60" />
      <span className="min-w-0 flex-1 opacity-55">
        <ProductCell p={cell} />
      </span>
      <ProofTierChip tier={p.tier} size="sm" />
      <span className="sr-only">Not eligible: {why}</span>
    </div>
  )
}

function Chip({ on, onClick, children, last }: { on: boolean; onClick: () => void; children: ReactNode; last: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={last || undefined}
      title={last ? 'At least one is needed' : undefined}
      onClick={() => !last && onClick()}
      className={`hit44 inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-proof-small transition-colors ${on ? 'border-proof-leaf-line bg-proof-leaf-soft text-ink' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'} ${last ? 'cursor-not-allowed' : ''}`}
    >
      {on ? <Check size={12} strokeWidth={2.2} aria-hidden className="text-proof-leaf" /> : null}
      {children}
    </button>
  )
}

function Audience({ product, goals, setGoals, skins, setSkins }: { product: PromoEligibility; goals: string[]; setGoals: (g: string[]) => void; skins: string[]; setSkins: (s: string[]) => void }) {
  // The cohort's skin type × goal counts on the same evidence as eligibility (mixed cohort, all time).
  const seg = useView<Segments>('segments|mixed|all', () => retailerSegments({ cohort: 'mixed', range: 'all' }))
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const reach = seg.data ? reachRange(seg.data.cells, goals, skins, seg.data.skin_types) : null
  return (
    <>
      <div role="group" aria-labelledby="campaign-goals" className="flex flex-col gap-2">
        <span id="campaign-goals" className="text-proof-small text-ink-2">
          Goals · shown to people with at least one
        </span>
        <div className="flex flex-wrap gap-1.5">
          {product.goals.map((g) => (
            <Chip key={g} on={goals.includes(g)} last={goals.length === 1 && goals[0] === g} onClick={() => setGoals(toggle(goals, g))}>
              {goalLabel(g)}
            </Chip>
          ))}
        </div>
      </div>
      <div role="group" aria-labelledby="campaign-skins" className="flex flex-col gap-2">
        <span id="campaign-skins" className="text-proof-small text-ink-2">
          Skin types
        </span>
        <div className="flex flex-wrap gap-1.5">
          {product.skin_types.map((s) => (
            <Chip key={s} on={skins.includes(s)} last={skins.length === 1 && skins[0] === s} onClick={() => setSkins(toggle(skins, s))}>
              {skinLabel(s)}
            </Chip>
          ))}
        </div>
      </div>
      {reach ? (
        <div aria-live="polite" className="flex flex-col gap-1 rounded-card bg-pf-bg2 px-4 py-3">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-proof-body text-ink">Matching profiles</span>
            <span className="text-proof-body font-medium text-ink tnum">{reach.lo === reach.hi ? int(reach.lo) : `${int(reach.lo)}–${int(reach.hi)}`} people</span>
          </span>
          <span className="text-proof-small text-ink-2">In the Willow cohort with one of these goals and one of these skin types. Current users of the product never see the card.</span>
        </div>
      ) : null}
    </>
  )
}
