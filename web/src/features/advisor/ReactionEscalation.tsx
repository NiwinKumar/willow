import { useState } from 'react'

import { useRoutine } from '../../data/hooks'
import { OUTCOME_COPY } from '../../lib/reactions'
import { ReactionSheet, type ReactionTarget } from '../routine/ReactionSheet'
import { compactName, entryName } from '../routine/routineModel'

const LINES: { k: string; t: string }[] = [
  { k: 'Swelling, blisters, hives, eyes or lips affected, or trouble breathing', t: OUTCOME_COPY.urgent.title },
  { k: 'Strong or lasting redness, itch or stinging', t: OUTCOME_COPY.stop.title },
  { k: 'Mild stinging or dryness', t: OUTCOME_COPY.mild.title },
]

/**
 * Under any answer about a reaction, Wisp shows these fixed words (the same rule as "I had a reaction", in
 * code, never generated) and a way to log it against a product in the routine.
 */
export function ReactionEscalation() {
  const routine = useRoutine()
  const current = (routine.data ?? []).filter((e) => !e.ended_at).slice(0, 8)
  const [target, setTarget] = useState<ReactionTarget | null>(null)
  return (
    <section aria-label="If it is a reaction" className="flex flex-col gap-2 rounded-[18px] bg-caution-bg p-3.5" style={{ animation: 'wRise .45s var(--ease-standard) both' }}>
      <span className="font-mono text-[10.5px] tracking-[.08em] text-caution">■ IF IT’S A REACTION</span>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] leading-[1.45]">
        {LINES.map((l, i) => (
          <li key={l.k} style={{ animation: `wRise .4s ${100 + i * 70}ms both` }}>
            <span className="text-ink">{l.k}: </span>
            <span className="text-ink-2">{l.t}</span>
          </li>
        ))}
      </ul>
      {current.length ? (
        <div className="flex flex-col gap-1.5 pt-0.5">
          <span className="text-[12.5px] text-ink-2">Log it against the product, so Willow stops suggesting it:</span>
          <span className="flex flex-wrap gap-1.5">
            {current.map((e) => (
              <button key={e.id} type="button" title={entryName(e)} onClick={() => setTarget({ product_id: e.product_id, entry_id: e.id, name: entryName(e) })} className="min-h-9 max-w-[220px] truncate rounded-pill bg-white/85 px-3 text-[12.5px] transition-[background-color,scale] duration-200 ease-standard hover:bg-white active:scale-[.97]">
                {compactName(e)}
              </button>
            ))}
          </span>
        </div>
      ) : null}
      <span className="text-[11.5px] text-ink-2">Fixed guidance, not written by AI. Not a medical assessment.</span>
      <ReactionSheet target={target} onClose={() => setTarget(null)} />
    </section>
  )
}
