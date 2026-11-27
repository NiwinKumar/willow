import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { CheckedChip } from '../../components/willow/CheckedChip'
import { ProductImage } from '../../components/willow/ProductImage'
import { RollingNumber } from '../../components/willow/RollingNumber'
import { refreshRoutine, useOwner } from '../../data/hooks'
import type { Product } from '../../data/types'
import { api, localDay } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { COMMISSION_NOTE, useStoreClick } from '../../lib/clicks'
import { useChecks } from '../../lib/safety'
import { useAuth } from '../../lib/useAuth'
import { usePlan } from './draft'
import { SLOT_WORDS, WHEN_WORDS, errorText, money, type PlanPick, type PlanWhen } from './planApi'
import { card, cardStyle, primary, secondary, stagger } from './styles'
import { Frame } from './ui'

const DAY = 86_400_000
/** The date `weeks` from today, as a short date ("12 Feb"). */
const weeksFrom = (weeks: number) => fmtDate(new Date(Date.parse(`${localDay()}T12:00:00`) + weeks * 7 * DAY).toISOString().slice(0, 10))
const slotsOf = (w: PlanWhen): ('am' | 'pm')[] => (w === 'both' ? ['am', 'pm'] : [w])

/**
 * (g) The plan: the morning and evening order at a glance, each pick with its check, why, verdict date,
 * proof and two alternatives a tap away, the week-by-week start (one new active at a time), notes and the
 * total. "Add all" / "Start with the base only" write to the routine (POST /v1/routine, starting today;
 * products already in the routine are skipped), then the plan ends at `?next=` or Routine.
 */
export function PlanRoutineStep() {
  const { result, exit } = usePlan()
  const navigate = useNavigate()
  const { getIdToken } = useAuth()
  const uid = useOwner()
  // A swapped-in alternative replaces the pick (index → product).
  const [swaps, setSwaps] = useState<Record<number, Product>>({})
  const [open, setOpen] = useState<number | null>(null)
  const [busy, setBusy] = useState<'all' | 'base' | null>(null)
  const onStore = useStoreClick('plan')
  const [error, setError] = useState<string | null>(null)

  const picks = useMemo(() => (result?.picks ?? []).map((p, i) => (swaps[i] ? { ...p, product: swaps[i], check: null, proof: null } : p)), [result, swaps])
  const ids = useMemo(() => (result?.picks ?? []).flatMap((p, i) => [swaps[i]?.product_id ?? p.product.product_id, ...p.alternatives.map((a) => a.product_id)]), [result, swaps])
  const { checks, profileComplete, status } = useChecks(ids)
  if (!result) return null

  const currency = result.total.currency
  const total = picks.reduce((s, p) => s + (p.product.price.currency === currency ? p.product.price.amount : 0), 0)
  const base = picks.filter((p) => p.slot !== 'active')

  const add = async (which: 'all' | 'base') => {
    setBusy(which)
    setError(null)
    try {
      const token = await getIdToken()
      const { entries } = await api.routine(token)
      const have = new Set(entries.filter((e) => !e.ended_at && e.product_id).map((e) => e.product_id))
      let added = 0
      for (const p of which === 'all' ? picks : base) {
        if (have.has(p.product.product_id)) continue
        await api.addRoutine(token, { product_id: p.product.product_id, slots: slotsOf(p.when), started_at: localDay(), source: 'catalog' })
        have.add(p.product.product_id)
        added++
      }
      refreshRoutine(uid)
      toast(added ? `Added ${added} ${added === 1 ? 'product' : 'products'} to your routine` : 'These are already in your routine')
      navigate(exit)
    } catch (e) {
      setBusy(null)
      setError(errorText(e, 'Could not add them just now. Check your connection and try again.'))
    }
  }

  return (
    <Frame
      wide
      eyebrow={`${picks.length} PRODUCTS · CHECKED FOR YOU`}
      title="Your routine"
      aside={
        <span className="flex flex-col items-end">
          <span className="font-mono text-[10.5px] tracking-[.08em] text-ink-2">TOTAL</span>
          <RollingNumber value={total} duration={900} delay={200} format={(v) => money(Math.round(v * 100) / 100, currency)} className="font-dot text-[clamp(24px,3.6vh,34px)] leading-none font-extrabold tabular-nums" />
        </span>
      }
      actions={
        <>
          {error ? (
            <p role="alert" className="m-0 rounded-[14px] bg-selected px-3.5 py-2 text-[13px] text-inverse">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button type="button" className={`${primary} sm:flex-1`} disabled={Boolean(busy)} onClick={() => void add('all')}>
              {busy === 'all' ? 'Adding…' : `Add all ${picks.length} to my routine`}
            </button>
            {base.length < picks.length ? (
              <button type="button" className={`${secondary} sm:flex-1`} disabled={Boolean(busy)} onClick={() => void add('base')}>
                {busy === 'base' ? 'Adding…' : `Start with the base only (${base.length})`}
              </button>
            ) : null}
          </div>
        </>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] sm:items-start">
        <div className="flex flex-col gap-2.5">
          <Order picks={picks} />
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {picks.map((p, i) => (
              <PickCard
                key={`${i}-${p.product.product_id}`}
                pick={p}
                i={i}
                open={open === i}
                onToggle={() => setOpen(open === i ? null : i)}
                check={checks[p.product.product_id] ?? p.check}
                checks={checks}
                loading={status === 'loading'}
                profileComplete={profileComplete}
                swapped={Boolean(swaps[i])}
                onSwap={(alt) => {
                  setSwaps((s) => ({ ...s, [i]: alt }))
                  setOpen(null)
                }}
                onRestore={() =>
                  setSwaps((s) => {
                    const next = { ...s }
                    delete next[i]
                    return next
                  })
                }
                original={result.picks[i].product}
                onStore={onStore}
              />
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-2.5">
          <Schedule schedule={result.schedule} />
          {result.notes.length ? (
            <ul className={`${card} m-0 flex list-none flex-col gap-2 px-4 py-3.5`} style={{ ...cardStyle, ...stagger(6) }}>
              {result.notes.map((n) => (
                <li key={n} className="flex gap-2.5 text-[13px] leading-[1.45]">
                  <span aria-hidden className="mt-[5px] size-1.5 flex-none rounded-full bg-ink/40" />
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="m-0 px-1 text-[12px] leading-[1.45] text-ink-2" style={stagger(7)}>
            Picked by fixed rules from the catalog and published sources. Labels can be incomplete. Cosmetic guidance only, not a medical assessment.
          </p>
        </div>
      </div>
    </Frame>
  )
}

/** Morning and evening at a glance: each product's photo in the order it is used, joined by a drawn line. */
function Order({ picks }: { picks: PlanPick[] }) {
  const rows: { id: 'am' | 'pm'; label: string; glyph: string }[] = [
    { id: 'am', label: 'Morning', glyph: '☼' },
    { id: 'pm', label: 'Evening', glyph: '☾' },
  ]
  return (
    <div className={`${card} flex flex-col gap-2 px-4 py-3`} style={{ ...cardStyle, ...stagger(0) }}>
      {rows.map((r, ri) => {
        const list = picks.filter((p) => p.when === 'both' || p.when === r.id)
        return (
          <div key={r.id} className="flex items-center gap-3">
            <span className="flex w-[5.6em] flex-none items-center gap-1.5 text-[13px] text-ink-2">
              <span aria-hidden>{r.glyph}</span>
              {r.label}
            </span>
            <ol className="relative m-0 flex list-none items-center gap-[clamp(8px,2vw,18px)] p-0" aria-label={`${r.label}: ${list.map((p) => SLOT_WORDS[p.slot]).join(', ')}`}>
              <span aria-hidden className="absolute top-1/2 right-3 left-3 h-px origin-left bg-ink/15" style={{ animation: `wLine .7s var(--ease-standard) ${200 + ri * 150}ms both` }} />
              {list.map((p, i) => (
                <li key={p.product.product_id + r.id} className="relative" style={{ animation: `wDotIn .45s var(--ease-bounce) ${260 + ri * 150 + i * 80}ms both` }}>
                  <ProductImage product={p.product} size={34} decorative />
                  {p.start_week > 0 ? <span className="absolute -top-1 -right-1 rounded-pill bg-lime px-1 font-mono text-[8.5px] leading-[13px]">W{p.start_week}</span> : null}
                </li>
              ))}
            </ol>
          </div>
        )
      })}
    </div>
  )
}

function PickCard({ pick, i, open, onToggle, check, checks, loading, profileComplete, swapped, onSwap, onRestore, original, onStore }: {
  pick: PlanPick
  i: number
  open: boolean
  onToggle: () => void
  check: PlanPick['check']
  checks: ReturnType<typeof useChecks>['checks']
  loading: boolean
  profileComplete: boolean | null
  swapped: boolean
  onSwap: (p: Product) => void
  onRestore: () => void
  original: Product
  onStore: (productId: string, store: string) => void
}) {
  const p = pick.product
  const panel = `pick-${i}`
  return (
    <li className={`${card} overflow-hidden`} style={{ ...cardStyle, ...stagger(i + 1, 120, 70) }}>
      <div className="flex items-start gap-3 px-3.5 pt-3 pb-2.5 sm:px-4">
        <span key={p.product_id} className="animate-[wDotIn_.4s_var(--ease-bounce)_both]">
          <ProductImage product={p} size={46} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-mono text-[10px] tracking-[.08em] text-ink-2">
            {SLOT_WORDS[pick.slot].toUpperCase()} · {WHEN_WORDS[pick.when].toUpperCase()}
            {pick.start_week > 0 ? ` · FROM WEEK ${pick.start_week}` : ''}
          </span>
          <span key={p.product_id} className="animate-[wWord_.35s_both] text-[15px] leading-[1.25]">
            {p.name} <span className="text-ink-2">· {p.brand}</span>
          </span>
          {pick.why[0] && !swapped ? <span className="text-[12.5px] leading-[1.35] text-ink-2">{pick.why[0]}</span> : null}
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <CheckedChip check={check} loading={loading} profileComplete={profileComplete} short />
            {pick.verdict_week != null ? <span className="rounded-pill bg-sunken px-2.5 py-[5px] text-[12px] leading-none">Verdict due {weeksFrom(pick.verdict_week)}</span> : null}
            {pick.proof && !swapped ? (
              <span className="rounded-pill bg-[var(--willow-900)] px-2.5 py-[5px] text-[12px] leading-none text-inverse" title="From Willow's outcome data. Today that cohort is simulated.">
                {pick.proof.tier === 'proven' ? 'Proven' : 'Promising'} · {pick.proof.n} people · simulated
              </span>
            ) : null}
          </span>
        </div>
        <span className="flex flex-none flex-col items-end gap-1.5">
          <span className="text-[15px] tabular-nums">{money(p.price.amount, p.price.currency)}</span>
          {pick.alternatives.length || pick.why.length > 1 || p.stores.length ? (
            <button type="button" aria-expanded={open} aria-controls={panel} onClick={onToggle} className="flex min-h-8 items-center gap-1 rounded-pill px-2 text-[12.5px] text-ink-2 transition-colors hover:bg-ink/5 hover:text-ink">
              {open ? 'Less' : 'More'}
              <span aria-hidden className="inline-block transition-transform duration-300 ease-standard" style={{ rotate: open ? '180deg' : '0deg' }}>
                ⌄
              </span>
            </button>
          ) : null}
        </span>
      </div>
      <div id={panel} aria-hidden={!open} inert={!open} className="grid transition-[grid-template-rows] duration-[340ms] ease-standard" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
        <div className={`min-h-0 overflow-hidden transition-[opacity,filter,translate] duration-300 ${open ? 'opacity-100' : 'translate-y-[-4px] opacity-0 blur-[3px]'}`}>
          <div className="flex flex-col gap-2.5 border-t border-ink/[.07] px-3.5 pt-2.5 pb-3 sm:px-4">
            {pick.why.length > 1 && !swapped ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {pick.why.slice(1).map((w) => (
                  <li key={w} className="flex gap-2 text-[12.5px] leading-[1.4] text-ink-2">
                    <span aria-hidden>·</span>
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
            {pick.evidence?.source ? (
              <p className="m-0 text-[12px] text-ink-2">
                Verdict timing:{' '}
                <a href={pick.evidence.source.url} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
                  {pick.evidence.source.label}
                </a>
                {pick.evidence.grade ? ` · evidence grade ${pick.evidence.grade}` : ''}
              </p>
            ) : null}
            {p.stores.length ? (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] tracking-[.08em] text-ink-2">WHERE TO BUY</span>
                <span className="flex flex-wrap gap-1.5">
                  {p.stores.slice(0, 3).map((st) => (
                    <a
                      key={st.url}
                      href={st.url}
                      target="_blank"
                      rel="noopener noreferrer sponsored"
                      onClick={() => onStore(p.product_id, st.store)}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-pill bg-white px-3 text-[12.5px] text-ink no-underline shadow-[0_1px_4px_rgba(0,0,0,.08)] transition-transform active:scale-95"
                    >
                      {st.store}
                      {st.price ? <span className="text-ink-2">{money(st.price.amount, st.price.currency)}</span> : null}
                      <span aria-hidden>↗</span>
                    </a>
                  ))}
                </span>
                <span className="text-[11.5px] text-ink-2">{COMMISSION_NOTE}</span>
              </div>
            ) : null}
            {pick.alternatives.length ? (
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] tracking-[.08em] text-ink-2">OR INSTEAD</span>
                {[...(swapped ? [original] : []), ...pick.alternatives.filter((a) => a.product_id !== p.product_id)].slice(0, 3).map((a) => (
                  <div key={a.product_id} className="flex items-center gap-2.5 rounded-[16px] bg-sunken px-2.5 py-2">
                    <ProductImage product={a} size={30} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13.5px]">{a.name}</span>
                      <span className="truncate text-[12px] text-ink-2">
                        {a.brand} · {money(a.price.amount, a.price.currency)}
                      </span>
                    </span>
                    <CheckedChip check={checks[a.product_id]} short />
                    <button type="button" onClick={() => (a.product_id === original.product_id ? onRestore() : onSwap(a))} className="min-h-8 rounded-pill bg-white px-3 text-[12.5px] shadow-[0_1px_4px_rgba(0,0,0,.08)] transition-transform active:scale-95">
                      {a.product_id === original.product_id ? 'Use the pick' : 'Use this'}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  )
}

/** The start, week by week: a small timeline whose line draws down as the steps arrive. */
function Schedule({ schedule }: { schedule: { week: number; text: string }[] }) {
  if (!schedule.length) return null
  return (
    <section className={`${card} px-4 py-3.5`} style={{ ...cardStyle, ...stagger(4) }} aria-labelledby="plan-schedule">
      <h2 id="plan-schedule" className="m-0 flex items-baseline justify-between gap-2 text-[15px] font-normal">
        Week by week
        <span className="text-[12px] text-ink-2">One new active at a time</span>
      </h2>
      <ol className="relative m-0 mt-2.5 flex list-none flex-col gap-3 p-0 pl-6">
        <span aria-hidden className="absolute top-1.5 bottom-1.5 left-[7px] w-px origin-top bg-ink/15" style={{ animation: 'wPlanGrow .9s var(--ease-standard) .35s both' }} />
        {schedule.map((s, i) => (
          <li key={`${s.week}-${i}`} className="relative" style={{ animation: `wRise .45s var(--ease-standard) ${420 + i * 120}ms both` }}>
            <span aria-hidden className={`absolute top-[3px] -left-6 size-[15px] rounded-full border-2 border-white ${i === 0 ? 'bg-selected' : 'bg-[var(--willow-400)]'}`} style={{ boxShadow: '0 0 0 1px rgba(18,18,18,.12)' }} />
            <span className="block font-mono text-[10.5px] tracking-[.08em] text-ink-2">
              {s.week === 0 ? 'TODAY' : `WEEK ${s.week} · ${weeksFrom(s.week).toUpperCase()}`}
            </span>
            <span className="mt-0.5 block text-[13px] leading-[1.45]">{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
