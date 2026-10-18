import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { RoutineEntry, Session } from '../../data/types'
import { fmtDate } from '../../lib/format'
import { METRIC_META, fmtSigned, unitOf } from '../../lib/metrics'
import { ProductImage } from './productUi'
import { compactName, imageOf, type Finding } from './routineModel'
import { suggestionsOf } from './suggestedToday'

/**
 * "Suggested today" as a row of small tiles, built only from what the api answered: tonight's alternating pair
 * ("■ TONIGHT", from the schedules) or a conflict the check says to alternate ("Alternate nights" sets both
 * schedules), a gap from the routine check ("■ MORNING · MISSING") and a product whose start was followed by a
 * real change ("◆"). Nothing to suggest: the section is not shown.
 */
export function Suggestions({ findings, entries, sessions, usedLastNight, onFind, onAlternate }: {
  findings: Finding[]
  entries: RoutineEntry[]
  sessions: Session[]
  /** Ticked as used yesterday evening (decides which of a new pair goes tonight). */
  usedLastNight: (id: string) => boolean
  onFind: (f: Finding) => void
  onAlternate: (tonight: RoutineEntry, rests: RoutineEntry) => Promise<void>
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const { tonight, gaps, changes } = suggestionsOf(findings, entries, sessions, usedLastNight)
  if (gaps.length + changes.length === 0 && !tonight) return null

  const alternate = async (on: RoutineEntry, off: RoutineEntry) => {
    setBusy(true)
    try {
      await onAlternate(on, off)
    } finally {
      setBusy(false)
    }
  }
  const row = 'flex flex-1 items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0'
  const tag = 'truncate font-mono text-[10px] tracking-[.08em] text-ink-2'
  const title = 'line-clamp-2 text-[14px] leading-[1.3] text-pretty'
  const act = 'hit44 min-h-9 shrink-0 rounded-pill px-3 text-[12.5px] whitespace-nowrap transition-colors'
  return (
    <section aria-labelledby="suggested-h" className="card flex flex-col gap-1 p-4">
      <h2 id="suggested-h" className="pb-2 text-[18px] font-normal tracking-[-0.01em]">
        Suggested today
      </h2>
      <ul className="flex flex-1 flex-col">
        {tonight ? (
          <li className={row}>
            <span aria-hidden className="relative h-9 w-[52px] shrink-0">
              <span className="absolute top-0 left-0">
                <ProductImage product={imageOf(tonight.on)} size={36} />
              </span>
              <span className="absolute top-[8px] left-[24px] rounded-full shadow-[0_0_0_2px_var(--bg-surface)]">
                <ProductImage product={imageOf(tonight.off)} size={28} muted rest />
              </span>
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={tag}>TONIGHT</span>
              <span className={title}>{tonight.done ? `${compactName(tonight.on)} tonight. ${compactName(tonight.off)} rests.` : `${compactName(tonight.on)} and ${compactName(tonight.off)} on the same night.`}</span>
            </div>
            {tonight.done ? (
              <span className="shrink-0 text-[13px] text-ink-2">✓ Alternating</span>
            ) : (
              <button type="button" disabled={busy} aria-busy={busy} onClick={() => void alternate(tonight.on, tonight.off)} className={`${act} bg-selected text-inverse disabled:opacity-60`}>
                {busy ? 'Saving…' : 'Alternate nights'}
              </button>
            )}
          </li>
        ) : null}
        {gaps.map((f) => {
          const sun = f.find?.category === 'sunscreen'
          return (
            <li key={f.key} className={row}>
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-ink/35 bg-sunken font-mono text-[11px]">
                {sun ? 'SPF' : '+'}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={tag}>{sun ? 'MORNING · MISSING' : 'MISSING STEP'}</span>
                <span className={title} title={f.fix}>
                  {sun ? 'Add a sunscreen to your mornings.' : f.title}
                </span>
              </div>
              <button type="button" onClick={() => onFind(f)} className={`${act} bg-selected text-inverse`}>
                Find one
              </button>
            </li>
          )
        })}
        {changes.map(({ e, o, latest, m }) => (
          <li key={e.id} className={row}>
            <ProductImage product={imageOf(e)} size={36} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={tag}>
                ◆ CHANGED · {METRIC_META[o.metric].label.toUpperCase()} {fmtSigned(m.delta, m)}
                {unitOf(m) ? ` ${unitOf(m)}` : ''}
              </span>
              <span className={title} title={`It moved beyond your normal range since you started it on ${fmtDate(e.started_at)}. Timing is an association, not proof.`}>
                {METRIC_META[o.metric].label} changed after you started {compactName(e)}.
              </span>
            </div>
            <button type="button" onClick={() => navigate(`/result/${latest.id}`)} className={`${act} shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-ink/5`}>
              See reading
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
