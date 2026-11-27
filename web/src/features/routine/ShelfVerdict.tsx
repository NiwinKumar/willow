import { ArrowLeftRight, X } from 'lucide-react'
import { useMemo } from 'react'

import type { RoutineCheck, RoutineEntry, Session } from '../../data/types'
import type { EffectRow } from '../../lib/effect'
import { REVIEW_WEEKS } from '../../lib/effect'
import { localDay } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { outcomeFor } from '../../lib/outcome'
import { routineEffect } from '../../lib/routineEffect'
import { VERDICT_LABEL } from './feel'
import { ProductImage } from './productUi'
import { compactName, entryName, imageOf, metaLine } from './routineModel'
import { isBasic, verdictDue, type EvidenceClock } from './actives'
import { ProductChecked, type ChecksMap } from './checked'
import { trialWindow } from './trialWindow'

type Group = 'earning' | 'shifted' | 'noClear' | 'early'
type ShelfRow = { e: RoutineEntry; group: Group; line: string; due: Date | null; firstLook: Date | null; shared: string | null; away: boolean }

const GROUPS: { id: Group; title: string; hint: string; glyph: string }[] = [
  { id: 'earning', title: 'Earning its place', hint: 'A change beyond your normal range after you started it.', glyph: '◆' },
  { id: 'shifted', title: 'Changed, not better or worse', hint: 'Skin tone shifted beyond your normal range. Willow never calls lighter or darker better.', glyph: '◆' },
  { id: 'noClear', title: 'No clear change after its full window', hint: 'Its usual trial length has passed with nothing beyond your normal range. You can stop, or try a swap.', glyph: '○' },
  { id: 'early', title: 'Too early', hint: 'Still inside its window, or not enough check-ins yet.', glyph: '◌' },
]

const DAY = 86_400_000

/**
 * Sorts each non-basic routine product into one of three groups from Willow's own measurements (lib/effect.ts,
 * the same reading as Home's routine effect) and its evidence clock. Basics (cleanser, moisturiser, sunscreen)
 * are never judged: they show nothing measurable by design, so they never get a "stop".
 */
function shelfOf(entries: RoutineEntry[], sessions: Session[], check: RoutineCheck | undefined, clock: EvidenceClock | null, now = Date.now()): { rows: ShelfRow[]; basics: RoutineEntry[] } {
  const live = entries.filter((e) => !e.ended_at)
  const effect = routineEffect(live, sessions, check)
  const byId = new Map<string, EffectRow>(effect.rows.map((r) => [r.e.id, r]))
  const judged = live.filter((e) => !isBasic(e.category))
  const rows = judged.map<ShelfRow>((e) => {
    const r = byId.get(e.id)
    const due = verdictDue(e, clock)
    const weeks = Math.floor((now - new Date(e.started_at).getTime()) / (7 * DAY))
    const windowOver = due ? due.due.getTime() <= now : weeks >= REVIEW_WEEKS
    // Another product started within two weeks: a change can't be told apart between them.
    const near = r && r.effect === 'helping' ? judged.find((x) => x.id !== e.id && Math.abs(new Date(x.started_at).getTime() - new Date(e.started_at).getTime()) <= 14 * DAY) : undefined
    const shared = near ? `Shared with ${compactName(near)}: started within two weeks of each other` : null
    if (r && r.effect === 'helping') return { e, group: 'earning', line: r.o.text, due: null, firstLook: null, shared, away: false }
    if (r && r.effect === 'changed') return { e, group: 'shifted', line: r.o.text, due: null, firstLook: null, shared: null, away: false }
    if (r && (r.effect === 'steady' || r.effect === 'away') && windowOver) return { e, group: 'noClear', line: r.effect === 'away' ? `${r.o.text}` : `Nothing beyond your normal range after ${weeks} weeks`, due: null, firstLook: null, shared: null, away: r.effect === 'away' }
    const o = r?.o ?? outcomeFor(e, sessions)
    const line = due && !windowOver ? `Verdict due ${fmtDate(localDay(due.due))} · ${due.weeks}-week window for ${due.active.toLowerCase()}` : o.text
    return { e, group: 'early', line, due: due && !windowOver ? due.due : null, firstLook: due?.firstLook ?? null, shared: null, away: false }
  })
  return { rows, basics: live.filter((e) => isBasic(e.category)) }
}

/**
 * "Is it working?" (Routine tab): the shelf verdict. Three groups, each product with its reading in words and
 * the person's own feel answer; "No clear change" offers Stop and See a swap. Timing is an association.
 */
export function ShelfVerdict({ entries, sessions, check, clock, checks, onOpen, onStop, onSwap }: {
  entries: RoutineEntry[]
  sessions: Session[]
  check: RoutineCheck | undefined
  clock: EvidenceClock | null
  checks: ChecksMap
  onOpen: (e: RoutineEntry) => void
  onStop: (e: RoutineEntry) => void
  onSwap: (e: RoutineEntry) => void
}) {
  const { rows, basics } = useMemo(() => shelfOf(entries, sessions, check, clock), [entries, sessions, check, clock])
  let n = 0
  return (
    <div className="flex flex-col gap-3">
      {GROUPS.map((g) => {
        const list = rows.filter((r) => r.group === g.id)
        if (!list.length) return null
        return (
          <section key={g.id} aria-labelledby={`shelf-${g.id}`} className="card flex flex-col gap-1 p-4 sm:p-5" style={{ animation: `wRise .5s ${n++ * 80}ms both` }}>
            <h2 id={`shelf-${g.id}`} className="m-0 flex items-baseline gap-2 text-[18px] font-normal tracking-[-0.01em]">
              <span aria-hidden className="text-[14px]">
                {g.glyph}
              </span>
              {g.title}
              <span className="font-mono text-[12px] text-ink-2">{list.length}</span>
            </h2>
            <span className="pb-1.5 text-[13px] leading-[1.45] text-ink-2">{g.hint}</span>
            <ul className="m-0 flex list-none flex-col p-0">
              {list.map((r, i) => (
                <li key={r.e.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line py-2.5 first:border-t-0" style={{ animation: `wRise .45s ${Math.min(i, 8) * 60 + 120}ms both` }}>
                  <ProductImage product={imageOf(r.e)} size={40} decorative />
                  <span className="flex min-w-[180px] flex-1 flex-col gap-0.5">
                    <button type="button" onClick={() => onOpen(r.e)} title={entryName(r.e)} className="hit44 truncate text-left text-[15px] leading-[1.3] underline-offset-4 hover:underline">
                      {compactName(r.e)}
                    </button>
                    <span className="text-[12.5px] leading-[1.4] text-ink-2">
                      {r.line}
                      {r.e.feel ? ` · you said: ${VERDICT_LABEL[r.e.feel.verdict].toLowerCase()}` : ''}
                    </span>
                    {r.shared ? <span className="text-[12px] leading-[1.4] text-ink-2">{r.shared}</span> : null}
                    {r.e.product_id ? <ProductChecked check={checks[r.e.product_id]} /> : null}
                  </span>
                  {r.due ? <WindowBar start={r.e.started_at} due={r.due} firstLook={r.firstLook} /> : null}
                  {g.id === 'noClear' ? (
                    <span className="flex shrink-0 gap-1.5">
                      <button type="button" onClick={() => onStop(r.e)} className="hit44 inline-flex min-h-9 items-center gap-1 rounded-pill px-3 text-[12.5px] shadow-[inset_0_0_0_1px_var(--line-strong)] transition-[background-color,scale] duration-200 ease-standard hover:bg-ink/5 active:scale-[.97]">
                        <X size={13} strokeWidth={1.8} aria-hidden />
                        Stop
                      </button>
                      {r.e.product_id ? (
                        <button type="button" onClick={() => onSwap(r.e)} className="hit44 inline-flex min-h-9 items-center gap-1 rounded-pill bg-selected px-3 text-[12.5px] text-inverse transition-[scale] duration-200 ease-standard active:scale-[.97]">
                          <ArrowLeftRight size={13} strokeWidth={1.8} aria-hidden />
                          See a swap
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {rows.length === 0 ? (
        <section className="card flex flex-col gap-1 p-5" style={{ animation: 'wRise .5s both' }}>
          <span className="text-[17px]">Nothing to judge yet</span>
          <span className="text-[13.5px] leading-[1.5] text-ink-2">Serums and treatments get a verdict here once their window has passed. Your basics are never judged.</span>
        </section>
      ) : null}
      {basics.length ? (
        <p className="m-0 px-1 text-[12.5px] leading-[1.5] text-ink-2">
          Not judged: {basics.map((e) => `${compactName(e)} (${metaLine('', e.category)})`).join(', ')}. Cleansers, moisturisers and sunscreens do their job every day without a change Willow can measure, so they never get a “stop”.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Too early: how far the product is through its usual trial window, so "too early" reads as "week 3 of 24"
 * instead of a date to do sums with. A grey track (not ember: nothing has changed), an ink fill that grows in
 * once, and a notch where the first look falls (its date is in the tooltip). The words say it too, for anyone who skips the bar.
 * Four tests: tells how far along each trial is at a glance; labelled in words; sits at the row's right edge and
 * never moves after it fills; ink and grey from the tokens, the same track as the product-test dots.
 */
function WindowBar({ start, due, firstLook }: { start: string; due: Date; firstLook: Date | null }) {
  const w = trialWindow(start, due, firstLook)
  if (!w) return null
  return (
    <span className="flex w-full shrink-0 flex-col gap-1.5 pl-[52px] sm:w-[200px] sm:pl-0" title={firstLook ? `First look ${fmtDate(localDay(firstLook))} · verdict ${fmtDate(localDay(due))}` : `Verdict ${fmtDate(localDay(due))}`}>
      <span className="flex items-baseline gap-2 text-[12px] text-ink-2">
        <span className="tabular-nums">{w.week ? `Week ${w.week} of ${w.weeks}` : `${w.weeks}-week window`}</span>
      </span>
      <span aria-hidden className="relative block h-1.5 overflow-hidden rounded-pill bg-sunken shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <span className="absolute inset-y-0 left-0 origin-left rounded-pill bg-ink motion-safe:animate-[wFill_.9s_var(--ease-standard)_.25s_both]" style={{ width: `${Math.max(w.done, 0.02) * 100}%` }} />
        {w.look !== null ? <span className="absolute inset-y-0 w-px bg-ink/40" style={{ left: `${w.look * 100}%` }} /> : null}
      </span>
    </span>
  )
}
