import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { RoutineEntry, Session } from '../../data/types'
import { fmtDate } from '../../lib/format'
import { METRIC_META, fmtSigned, unitOf } from '../../lib/metrics'
import { outcomeFor } from '../../lib/outcome'
import { shortName } from '../home/derive'
import { ProductImage } from './productUi'
import { entryName, imageOf, type Finding } from './routineModel'
import { alternatesWith, restsOn } from './schedule'

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
  const tonight = tonightOf(findings, entries, usedLastNight)
  const gaps = findings.filter((f) => f.kind === 'Gap').slice(0, tonight ? 1 : 2)
  const changes = entries
    .map((e) => ({ e, o: outcomeFor(e, sessions) }))
    .flatMap(({ e, o }) => {
      if (o.kind !== 'real') return []
      // The session the outcome judged (not simply the newest photo, which may be within range again).
      const latest = o.session
      const m = latest.result?.metrics.find((x) => x.id === o.metric)
      return m && m.delta !== null ? [{ e, o, latest, m }] : []
    })
    .slice(0, 3 - gaps.length - (tonight ? 1 : 0))
  if (gaps.length + changes.length === 0 && !tonight) return null

  const alternate = async (on: RoutineEntry, off: RoutineEntry) => {
    setBusy(true)
    try {
      await onAlternate(on, off)
    } finally {
      setBusy(false)
    }
  }
  const row = 'flex items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-1'
  const tag = 'font-mono text-[10.5px] tracking-[.08em] text-ink-2'
  const title = 'text-[15px] leading-[1.3] text-pretty'
  const act = 'hit44 min-h-9 shrink-0 rounded-pill px-3.5 text-[13px] transition-colors'
  return (
    <section aria-labelledby="suggested-h" className="card flex flex-col gap-1 p-5">
      <h2 id="suggested-h" className="pb-2 text-[20px] font-normal tracking-[-0.01em]">
        Suggested today
      </h2>
      <ul className="flex flex-col">
        {tonight ? (
          <li className={row}>
            <span aria-hidden className="relative h-10 w-[58px] shrink-0">
              <span className="absolute top-0 left-0">
                <ProductImage product={imageOf(tonight.on)} size={40} />
              </span>
              <span className="absolute top-[10px] left-[26px] rounded-full shadow-[0_0_0_2px_var(--bg-surface)]">
                <ProductImage product={imageOf(tonight.off)} size={30} muted rest />
              </span>
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={tag}>TONIGHT</span>
              <span className={title}>{tonight.done ? `${shortName(tonight.on)} tonight. ${shortName(tonight.off)} rests.` : `${shortName(tonight.on)} and ${shortName(tonight.off)} on the same night.`}</span>
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
            <ProductImage product={imageOf(e)} size={40} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={tag}>
                ◆ CHANGED · {METRIC_META[o.metric].label.toUpperCase()} {fmtSigned(m.delta, m)}
                {unitOf(m) ? ` ${unitOf(m)}` : ''}
              </span>
              <span className={title} title={`It moved beyond your normal range since you started it on ${fmtDate(e.started_at)}. Timing is an association, not proof.`}>
                {METRIC_META[o.metric].label} changed after you started {entryName(e)}.
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

/**
 * Tonight's pair: two evening products already alternating (done), else the first conflict the check says to
 * alternate. In a new pair the product not used last night goes tonight.
 */
function tonightOf(findings: Finding[], entries: RoutineEntry[], usedLastNight: (id: string) => boolean): { on: RoutineEntry; off: RoutineEntry; done: boolean; finding?: Finding } | null {
  const pm = entries.filter((e) => e.slots.includes('pm') && !e.ended_at)
  for (const a of pm)
    for (const b of pm)
      if (a.id < b.id && alternatesWith(a, b)) {
        const [on, off] = restsOn(a) ? [b, a] : [a, b]
        return { on, off, done: true }
      }
  const f = findings.find((x) => x.kind === 'Conflict' && x.alternate && x.entries.length === 2 && x.entries.every((e) => e.slots.includes('pm')))
  if (!f) return null
  const [a, b] = f.entries
  const [on, off] = usedLastNight(b.id) && !usedLastNight(a.id) ? [a, b] : [b, a]
  return { on, off, done: false, finding: f }
}
