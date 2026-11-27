import { AlertCircle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Chip'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Sheet } from '../../components/ui/Sheet'
import { LEVEL_LOOK, useLogReaction, localOutcome, SIGNS, type ReactionLevel, type ReactionOutcome, type ReactionSign } from '../../lib/reactions'
import { useRoutine } from '../../data/hooks'
import { failureText, useRoutineWrites } from './writes'

/** What "I had a reaction" was pressed on. */
export type ReactionTarget = { product_id: string | null; entry_id?: string | null; name: string }

const SINCE = [
  { value: '0', label: 'Today' },
  { value: '1', label: '1 to 2 days' },
  { value: '3', label: '3 days or more' },
] as const


/**
 * "I had a reaction": signs, how strong, since when → POST /v1/me/reactions → the fixed outcome (urgent / stop /
 * mild), shown first and plainly. The words come from a rule in code (lib/reactions.ts mirrors the api), so
 * the advice shows even if saving fails.
 */
export function ReactionSheet({ target, onClose }: { target: ReactionTarget | null; onClose: () => void }) {
  return (
    <Sheet open={target !== null} onClose={onClose} title="I had a reaction" variant="modal" size="sm">
      {target ? <ReactionFlow key={`${target.product_id}:${target.entry_id}`} target={target} onClose={onClose} /> : null}
    </Sheet>
  )
}

function ReactionFlow({ target, onClose }: { target: ReactionTarget; onClose: () => void }) {
  const log = useLogReaction()
  const routine = useRoutine()
  const writes = useRoutineWrites()
  const [signs, setSigns] = useState<ReactionSign[]>([])
  const [strength, setStrength] = useState<'mild' | 'strong'>('mild')
  const [since, setSince] = useState<(typeof SINCE)[number]['value']>('0')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ outcome: ReactionOutcome; saved: boolean; note?: string } | null>(null)
  const [stopped, setStopped] = useState(false)

  const toggle = (s: ReactionSign) => setSigns((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))
  const body = { signs, strength, since_days: Number(since) }

  const submit = async () => {
    setBusy(true)
    try {
      // A routine entry outside the catalog is logged by its entry id (the api accepts it for the person's own entries).
      const id = target.product_id ?? target.entry_id
      if (!id) {
        setResult({ outcome: localOutcome(body), saved: false, note: 'Not saved: this product isn’t in the catalog.' })
        return
      }
      const res = await log({ product_id: id, entry_id: target.entry_id ?? null, ...body })
      setResult({ outcome: res.outcome, saved: true })
    } catch (e) {
      setResult({ outcome: localOutcome(body), saved: false, note: failureText(e, 'Couldn’t save this to your reactions. The advice above still applies.') })
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const o = result.outcome
    const look = LEVEL_LOOK[o.level]
    const entry = target.entry_id ? routine.data?.find((e) => e.id === target.entry_id && !e.ended_at) : routine.data?.find((e) => e.product_id === target.product_id && !e.ended_at)
    return (
      <div className="flex flex-col gap-3">
        <ReactionOutcomeCard outcome={o} look={look} />
        {o.level !== 'mild' && result.saved ? <span className="text-[13px] text-ink-2">Added to your avoid list. Willow won’t suggest {target.name} to you again.</span> : null}
        {result.note ? (
          <span role="status" className="text-[13px] text-ink-2">
            {result.note}
          </span>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          {o.level !== 'mild' && entry && !stopped ? (
            <Button
              variant="ink"
              size="sm"
              onClick={() => {
                setStopped(true)
                void writes.stop(entry)
              }}
            >
              Mark it stopped in my routine
            </Button>
          ) : null}
          <Button variant={o.level !== 'mild' && entry && !stopped ? 'outline' : 'ink'} size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="text-[15px] leading-[1.4] text-pretty">{target.name}</span>
      <div className="flex flex-col gap-1.5">
        <span id="rx-signs" className="text-[14px] text-ink-2">
          What do you notice? Pick all that fit.
        </span>
        <div role="group" aria-labelledby="rx-signs" className="flex flex-wrap gap-1.5">
          {SIGNS.map((s) => (
            <Chip key={s.id} selected={signs.includes(s.id)} onToggle={() => toggle(s.id)}>
              {s.label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] text-ink-2">How strong?</span>
        <SegmentedControl label="How strong" size="sm" value={strength} onChange={setStrength} options={[{ value: 'mild', label: 'Mild' }, { value: 'strong', label: 'Strong' }]} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] text-ink-2">Since when?</span>
        <SegmentedControl label="Since when" size="sm" value={since} onChange={setSince} options={SINCE.map((s) => ({ value: s.value, label: s.label }))} />
      </div>
      <Button variant="ink" loading={busy} disabled={!signs.length} onClick={() => void submit()}>
        See what to do
      </Button>
      <span className="flex gap-2 text-[12.5px] leading-[1.45] text-ink-2">
        <AlertCircle size={14} strokeWidth={1.7} aria-hidden className="mt-0.5 shrink-0" />
        Not a medical assessment. Trouble breathing, or swelling of the eyes or lips: get medical help now.
      </span>
    </div>
  )
}

/** The fixed outcome, large and calm: level tag, the one instruction, its steps, how to report. */
export function ReactionOutcomeCard({ outcome, look }: { outcome: ReactionOutcome; look?: (typeof LEVEL_LOOK)[ReactionLevel] }) {
  const l = look ?? LEVEL_LOOK[outcome.level]
  return (
    <div role="alert" className={`flex flex-col gap-2.5 rounded-[20px] p-4 ${l.bg}`} style={{ animation: 'wRise .4s var(--ease-standard) both' }}>
      <span className={`font-mono text-[11px] tracking-[.08em] ${l.fg}`}>■ {l.tag}</span>
      <span className="text-[18px] leading-[1.3] text-pretty text-ink">{outcome.title}</span>
      {outcome.steps.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14px] leading-[1.45] text-ink">
          {outcome.steps.map((s, i) => (
            <li key={s} className="flex gap-2" style={{ animation: `wRise .4s ${120 + i * 80}ms both` }}>
              <span aria-hidden className={l.fg}>
                ·
              </span>
              {s}
            </li>
          ))}
        </ul>
      ) : null}
      {outcome.report ? <span className="text-[13px] leading-[1.45] text-ink-2">{outcome.report}</span> : null}
    </div>
  )
}
