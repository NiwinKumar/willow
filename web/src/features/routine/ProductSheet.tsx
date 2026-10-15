import { ExternalLink, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useMaybeShell } from '../../components/shell/ShellContext'
import { Button } from '../../components/ui/Button'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Sheet } from '../../components/ui/Sheet'
import { VerdictGlyph } from '../../components/willow/Verdict'
import { useOwner, useRoutine } from '../../data/hooks'
import type { Product, RoutineEntry } from '../../data/types'
import { api } from '../../lib/api'
import { CONCERN_LABEL } from '../../lib/catalog'
import { fmtDate, fmtPrice, plural } from '../../lib/format'
import { outcomeFor, type Outcome } from '../../lib/outcome'
import { useQuery } from '../../lib/query'
import { useOutcomes } from '../../lib/useOutcomes'
import { CategoryOrb } from './productUi'
import { activeLabel, categoryOf, entryName, metaLine, OUTCOME_GLYPH, useOutcomeSessions } from './routineModel'
import { failureText, useRoutineWrites } from './writes'

export type ProductTarget = { entry: RoutineEntry } | { product: Product } | { productId: string }

const WHEN = [
  { value: 'am', label: 'Morning' },
  { value: 'pm', label: 'Evening' },
  { value: 'both', label: 'Both' },
] as const
type When = (typeof WHEN)[number]['value']
const toWhen = (s: ('am' | 'pm')[]): When => (s.length === 2 ? 'both' : s[0] === 'pm' ? 'pm' : 'am')
const toSlots = (w: When): ('am' | 'pm')[] => (w === 'both' ? ['am', 'pm'] : [w])

/**
 * "Product information" side sheet (design: Willow App Routine, infoOpen): what the catalog says, what
 * your readings did since you started it, the synthetic cohort, and where to buy. A routine entry also gets
 * its own controls: when you use it, stop using, remove.
 */
export function ProductSheet({ target, onClose, onAdd }: { target: ProductTarget | null; onClose: () => void; onAdd?: (p: Product) => void }) {
  return (
    <Sheet open={target !== null} onClose={onClose} title="Product information" variant="side">
      {target ? <Body target={target} onClose={onClose} onAdd={onAdd} /> : null}
    </Sheet>
  )
}

function Body({ target, onClose, onAdd }: { target: ProductTarget; onClose: () => void; onAdd?: (p: Product) => void }) {
  const uid = useOwner()
  const shell = useMaybeShell()
  const routine = useRoutine()
  const sessions = useOutcomeSessions()
  const outcomes = useOutcomes()
  const writes = useRoutineWrites()
  const productId = 'entry' in target ? target.entry.product_id : 'product' in target ? target.product.product_id : target.productId
  const fetched = useQuery(['catalog-product', productId], (t) => api.catalogProduct(t, productId!), { enabled: Boolean(uid && productId) && !('product' in target), staleMs: 30 * 60_000 })
  const product: Product | null = 'product' in target ? target.product : (fetched.data ?? null)
  // The routine entry for this product, if it is in use (by id for an entry, by catalog id otherwise).
  const entry = 'entry' in target ? (routine.data?.find((e) => e.id === target.entry.id) ?? target.entry) : (routine.data?.find((e) => e.product_id === productId && !e.ended_at) ?? null)
  const inUse = entry !== null && !entry.ended_at
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const category = product?.category ?? entry?.category ?? 'other'
  const brand = product?.brand ?? entry?.brand ?? ''
  const name = product?.name ?? (entry ? entryName(entry) : '')
  const concerns = product?.concerns ?? entry?.concerns ?? []
  const actives = product?.key_actives ?? entry?.key_actives ?? []
  const inci = product?.inci ?? entry?.inci ?? []
  const cohort = product ? outcomes?.byProduct[product.product_id] : undefined
  const outcome: Outcome | null = entry ? outcomeFor(entry, sessions) : null

  const run = async (key: string, fn: () => Promise<unknown>, fail: string) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError(failureText(e, fail))
      return false
    } finally {
      setBusy(null)
    }
  }

  if (productId && !product && fetched.status === 'loading')
    return (
      <div aria-busy className="flex flex-col gap-3">
        <span className="skeleton block h-[220px] rounded-xl" />
        <span className="skeleton block h-5 w-1/2" />
        <span className="skeleton block h-8 w-3/4" />
      </div>
    )

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="relative grid min-h-[250px] place-items-center rounded-xl pb-6 squircle" style={{ background: `radial-gradient(60% 60% at 50% 55%, ${categoryOf(category).c[0]}, transparent 72%), var(--bg-sunken)` }}>
        <CategoryOrb category={category} size={120} breathe />
        <span className="absolute inset-x-5 bottom-3.5 text-[12px] text-ink-2">No product photos in Willow · the colour shows the category</span>
      </div>

      <div className="flex flex-col gap-1.5 px-2 py-1.5">
        <span className="text-[14px] text-ink-2">{metaLine(brand, category, product?.size)}</span>
        <h3 className="text-[26px] leading-[1.1] font-normal tracking-[-0.02em]">{name}</h3>
        {product ? (
          <span className="text-[16px]">
            {fmtPrice(product.price)} <span className="text-[14px] text-ink-2">· catalog price, checked {fmtDate(product.last_verified, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </span>
        ) : (
          <span className="text-[14px] text-ink-2">Your own product · not in the catalog</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 px-1">
        {inUse ? (
          <span className="flex min-h-12 items-center rounded-pill bg-lime px-[18px] text-[14px]">✓ In your routine since {fmtDate(entry.started_at)}</span>
        ) : product && onAdd ? (
          <Button variant="ink" onClick={() => onAdd(product)}>
            Add to routine
          </Button>
        ) : null}
        {shell && name ? (
          <Button
            variant="outline"
            onClick={() => {
              shell.openAdvisor(`Tell me about the ${[brand, name].filter(Boolean).join(' ')}`, name)
              onClose()
            }}
          >
            Ask the advisor
          </Button>
        ) : null}
      </div>

      {inUse ? (
        <div className="card flex flex-col gap-3 bg-sunken px-5 py-4">
          <span className="text-[14px] text-ink-2">When you use it</span>
          <SegmentedControl
            label="When you use it"
            options={WHEN.map((w) => ({ value: w.value, label: w.label }))}
            value={toWhen(entry.slots)}
            onChange={(w) => void run('slots', () => writes.setSlots(entry, toSlots(w)), "Couldn't change when you use it. Try again.")}
          />
          {entry.recent_use ? (
            <span className="text-[13px] text-ink-2">
              Used on {entry.recent_use.days_used} of {plural(entry.recent_use.of_days, 'day', 'days')} lately (from your ticks).
            </span>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" loading={busy === 'stop'} onClick={() => void run('stop', () => writes.stop(entry).then(onClose), "Couldn't stop it. Try again.")}>
              Stop using
            </Button>
            {confirmRemove ? null : (
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmRemove(true)}>
                Remove (added by mistake)
              </Button>
            )}
          </div>
          {confirmRemove ? (
            <div role="alert" className="flex flex-col gap-2 rounded-md bg-avoid-bg p-3.5 text-[14px] text-avoid">
              <span>This deletes {entryName(entry)} and every day you ticked it. Stop using keeps its history instead.</span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ink" loading={busy === 'remove'} onClick={() => void run('remove', () => writes.remove(entry), "Couldn't remove it. Nothing was deleted; try again.").then((ok) => ok && onClose())}>
                  Delete it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-[13px] text-avoid">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card flex flex-col gap-2.5 bg-sunken px-5 py-4">
        {concerns.length ? (
          <>
            <span className="text-[14px] text-ink-2">Concerns</span>
            <span className="flex flex-wrap gap-1.5">
              {concerns.map((c) => (
                <span key={c} className="rounded-pill bg-canvas px-3 py-1.5 text-[13px]">
                  {(CONCERN_LABEL[c] ?? c).replace(/^./, (x) => x.toUpperCase())}
                </span>
              ))}
            </span>
          </>
        ) : null}
        {actives.length ? (
          <>
            <span className="text-[14px] text-ink-2">Actives</span>
            <span className="flex flex-wrap gap-1.5">
              {actives.map((a) => (
                <span key={a.name} className="rounded-pill bg-lime px-3 py-1.5 text-[13px]">
                  {activeLabel(a)}
                </span>
              ))}
            </span>
          </>
        ) : null}
        {inci.length ? (
          <details className="text-[14px] leading-[1.55]">
            <summary className="flex min-h-10 cursor-pointer items-center">Full ingredient list · {product ? 'from catalog' : 'as saved'}</summary>
            <p className="mt-1.5 text-ink-2">{inci.join(', ')}</p>
          </details>
        ) : null}
      </div>

      {inUse && outcome ? (
        <div className="card flex flex-col gap-1.5 bg-sunken px-5 py-4">
          <span className="font-mono text-[12px] text-ink-2">■ YOUR READINGS SINCE START</span>
          <span className="flex items-center gap-2 text-[15px]">
            <VerdictGlyph kind={OUTCOME_GLYPH[outcome.kind]} />
            {outcome.text}
          </span>
          <span className="text-[13px] leading-[1.5] text-ink-2">{outcome.detail}</span>
        </div>
      ) : null}

      {product ? (
        <div className="flex flex-col gap-3 rounded-lg squircle bg-selected px-5 py-4 text-inverse">
          <span className="font-mono text-[12px] tracking-[.06em] text-cta">{outcomes?.synthetic ? '■ SIMULATED COHORT · SYNTHETIC DATA' : '■ COHORT OUTCOMES'}</span>
          {cohort ? (
            <>
              <span className="flex flex-wrap items-baseline gap-2.5">
                <span className="font-dot text-[56px] leading-none">{Math.round(cohort.rate * 100)}%</span>
                <span className="text-[14px] text-[#BDBAB4]">of {cohort.n} people</span>
              </span>
              <span aria-hidden className="block h-2.5 overflow-hidden rounded-[10px] bg-[#2A2A2A]">
                <span className="block h-full rounded-[10px]" style={{ width: `${Math.round(cohort.rate * 100)}%`, background: 'linear-gradient(90deg, var(--aura-violet), var(--aura-pink), var(--aura-coral))' }} />
              </span>
              <span className="text-[14px] leading-[1.5] text-[#E4E1DB]">
                were still improved beyond photo noise at week 8 on what it targets.{cohort.weeks !== null ? ` The improvement typically began around week ${cohort.weeks}.` : ''}
              </span>
            </>
          ) : (
            <span className="text-[15px] leading-[1.5]">{outcomes ? 'No outcome data shown. Fewer than 10 people in the cohort used this, or outcomes aren’t tracked for this category.' : 'Cohort outcomes are not available right now.'}</span>
          )}
        </div>
      ) : null}

      {product?.stores.length ? (
        <div className="flex flex-col gap-2">
          <span className="px-1.5 text-[14px] text-ink-2">Where to buy</span>
          {product.stores.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`${s.store}, opens in new tab`} className="card flex min-h-[54px] items-center justify-between bg-sunken px-5 text-[15px] no-underline hover:bg-muted">
              {s.store}
              <ExternalLink size={16} strokeWidth={1.5} aria-hidden className="text-ink-2" />
            </a>
          ))}
          <span className="px-1.5 text-[12px] text-ink-2">Store links only: the price above is the catalog's one checked price. No ads, no commissions.</span>
        </div>
      ) : null}
    </div>
  )
}
