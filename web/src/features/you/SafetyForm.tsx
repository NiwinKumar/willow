import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { useOwner } from '../../data/hooks'
import { invalidate } from '../../lib/query'
import { AVOID_OPTIONS, EMPTY_SAFETY, LIFE_STAGES, MARKETS, marketFromLocale, putSafety, useSafety, type AvoidId, type SafetyProfile } from '../../lib/safety'
import { useAuth } from '../../lib/useAuth'
import { chip } from './settingsClasses'

const YES_NO = [
  { v: true, label: 'Yes' },
  { v: false, label: 'No' },
] as const

/**
 * The safety questions (life stage, ingredients to avoid, reacts easily, prescription treatment, market),
 * as one small form used by the "Check products for me" sheet and by You. Saves the whole safety object
 * (PUT /v1/me/profile {safety}); products set aside by a reaction and the age answer are kept as they are.
 */
export function SafetyForm({ initial, onSaved, onCancel, submit = 'Save' }: { initial: SafetyProfile | null; onSaved?: () => void; onCancel?: () => void; submit?: string }) {
  const uid = useOwner()
  const { getIdToken } = useAuth()
  const base = initial ?? EMPTY_SAFETY
  const [s, setS] = useState<SafetyProfile>(() => ({ ...base, market: base.market ?? marketFromLocale() }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<SafetyProfile>) => setS((x) => ({ ...x, ...patch }))
  const toggleAvoid = (id: AvoidId) => set({ avoid: s.avoid.includes(id) ? s.avoid.filter((a) => a !== id) : [...s.avoid, id] })

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await putSafety(await getIdToken(), { ...s, life_stage: s.life_stage ?? 'none', reactive: s.reactive ?? false, rx_treatment: s.rx_treatment ?? false })
      invalidate(['safety'])
      invalidate(['me', uid])
      toast('Saved · products are now checked against your answers')
      onSaved?.()
    } catch {
      setError(navigator.onLine ? 'Couldn’t save your answers. Nothing changed; try again.' : 'You’re offline. Nothing was saved; try again when you’re connected.')
    } finally {
      setBusy(false)
    }
  }

  const q = 'flex flex-col gap-1.5'
  const label = 'text-[14px] text-ink-2'
  return (
    <div className="flex flex-col gap-4">
      <div className={q}>
        <span id="sf-life" className={label}>
          Are you pregnant, breastfeeding or trying to conceive?
        </span>
        <div role="radiogroup" aria-labelledby="sf-life" className="flex flex-wrap gap-1.5">
          {LIFE_STAGES.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={s.life_stage === l.id} onClick={() => set({ life_stage: l.id })} className={chip(s.life_stage === l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className={q}>
        <span id="sf-avoid" className={label}>
          Anything you avoid? Pick any.
        </span>
        <div role="group" aria-labelledby="sf-avoid" className="flex flex-wrap gap-1.5">
          {AVOID_OPTIONS.map((a) => (
            <button key={a.id} type="button" aria-pressed={s.avoid.includes(a.id)} title={a.hint} onClick={() => toggleAvoid(a.id)} className={chip(s.avoid.includes(a.id))}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <YesNo id="sf-reactive" q="Does your skin react easily to new products?" value={s.reactive} onChange={(v) => set({ reactive: v })} />
      <YesNo id="sf-rx" q="Do you use a prescription skin treatment?" value={s.rx_treatment} onChange={(v) => set({ rx_treatment: v })} />
      <div className={q}>
        <span id="sf-market" className={label}>
          Where do you buy skincare?
        </span>
        <div role="radiogroup" aria-labelledby="sf-market" className="flex flex-wrap gap-1.5">
          {MARKETS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={s.market === m.id} onClick={() => set({ market: m.id })} className={chip(s.market === m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <span className="text-[12.5px] leading-[1.45] text-ink-2">Used only to check ingredient lists with fixed rules from published sources. It never changes a measurement. Labels can be incomplete.</span>
      {error ? (
        <p role="alert" className="m-0 rounded-[14px] bg-avoid-bg px-3.5 py-2.5 text-[13px] text-avoid">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="ink" loading={busy} onClick={() => void save()}>
          {submit}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Not now
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function YesNo({ id, q, value, onChange }: { id: string; q: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-[14px] text-ink-2">
        {q}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {YES_NO.map((o) => (
          <button key={o.label} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} className={chip(value === o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** "Check products for me": the safety questions in a small sheet. */
export function SafetySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const safety = useSafety()
  return (
    <Sheet open={open} onClose={onClose} title="Check products for me" variant="modal" size="sm">
      {open ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[14px] leading-[1.5]">Five quick questions. Willow then marks every product: no flags for you, check this, or not advised for you, with the reason and its source.</p>
          <SafetyForm initial={safety.data ?? null} onSaved={onClose} onCancel={onClose} submit="Save and check" />
        </div>
      ) : null}
    </Sheet>
  )
}
