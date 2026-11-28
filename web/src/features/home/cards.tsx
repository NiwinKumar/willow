import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { TrendChart } from '../../components/charts'
import { ProductImage } from '../../components/willow/ProductImage'
import type { MetricId, RoutineEntry, Session, Site } from '../../data/types'
import { CONCERN_METRICS } from '../../lib/catalog'
import type { Effect, EffectFlag, EffectRow, RoutineEffect } from '../../lib/effect'
import { plural } from '../../lib/format'
import { OUTCOME_SITES } from '../../lib/outcome'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { imageOf } from '../routine/routineModel'
import { fmtSigned, METRIC_META, unitOf, fmtReading } from '../../lib/metrics'
import { CHANGE_WORDS, VERDICT_WORDS, changeWay, verdictKind } from '../../lib/verdict'
import { brandedName, byGoals, checkInsSince, countWord, firstRead, FIRST_READ_CHECKINS, FIRST_READ_DAYS, metricAura, shortDay, spanOfUse } from './derive'
import type { GoalTrend } from './goals'
import { useFitCount, useHomeFit } from './fit'
import { CardHead, Pill, VerdictLine } from './parts'

/** Standard Home card shell: surface, radius 30, rise in. */
export function HomeCard({ label, className = '', delay = 0, children }: { label: string; className?: string; delay?: number; children: ReactNode }) {
  return (
    <section aria-label={label} className={`card flex min-w-0 animate-[wRise_.55s_both] flex-col gap-2.5 p-5 ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </section>
  )
}

/** Rows What changed lists before folding the rest into one line. */
const ROWS = 3
/** A comfortable height for one What changed row (its 56px minimum and some air), when counting what fits. */
const CHANGED_ROW_PX = 66

/**
 * How many rows of about `rowPx` (with `gap` between) fit the list's height, never fewer than `min` nor more
 * than `max`. The list is flex-basis 0 with overflow hidden, so the rows it renders never push the card taller:
 * its height comes from the column, and only whole rows are drawn in it (none half hidden, none focusable
 * out of sight). Re-renders only when the count changes, not on every resize.
 */
function useRowsThatFit(min: number, max: number, rowPx: number, gap: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [n, setN] = useState(min)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const fit = Math.floor((e.contentRect.height + gap) / (rowPx + gap))
      setN(Math.max(min, Math.min(max, fit)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [min, max, rowPx, gap])
  return { ref, n: Math.min(n, Math.max(min, max)) }
}

/** What changed: the latest measured check-in (of the place Home reads) against the baseline, changed measures first, with how far each moved. */
export function ChangedCard({ session, baseline, goals, onOpen, onFull, onAsk, className, rows: count = ROWS }: { session: Session; baseline: Session | null; goals: string[]; onOpen: (metricId: string) => void; onFull: () => void; onAsk?: () => void; className?: string; rows?: number }) {
  const metrics = byGoals(session.result?.metrics ?? [], goals).map((m) => ({ m, kind: verdictKind(m, session) }))
  const sorted = [...metrics.filter((x) => x.kind === 'changed'), ...metrics.filter((x) => x.kind !== 'changed')]
  // As many rows as the card's height holds (at least `count`): a card stretched to its column's height shows
  // more of the check-in's measures instead of a gap under them.
  const fit = useHomeFit()
  const { ref: tallRef, n: tallN } = useRowsThatFit(count, sorted.length, CHANGED_ROW_PX, 6)
  // Fitted to the screen: whatever whole rows the card's height holds, one at least.
  const { ref: fitRef, n: fitN } = useFitCount<HTMLDivElement>(sorted.length, { enabled: fit, start: count })
  const n = fit ? fitN : tallN
  const listRef = fit ? fitRef : tallRef
  const rows = sorted.slice(0, n)
  const rest = sorted.slice(n)
  const small = 'inline-flex min-h-9 items-center rounded-pill px-3 text-[12.5px] whitespace-nowrap transition-[background] duration-300'
  return (
    <HomeCard label="Since your baseline" className={`gap-2 p-4 ${className ?? ''}`} delay={120}>
      <div className={`flex items-center justify-between gap-x-3 gap-y-1.5 ${fit ? '' : 'flex-wrap'}`}>
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 text-h3 font-normal">Since your baseline</h2>
          <span className="text-[11px] text-ink-2">
            {baseline ? `vs baseline · ${shortDay(baseline.created_at)}` : shortDay(session.created_at)}
            {rest.length ? ` · ${rest.length} more in the result` : ''}
          </span>
        </div>
        <div className="flex gap-1.5">
          {onAsk ? (
            <button type="button" onClick={onAsk} className={`${small} text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.14)] hover:bg-ink/5`}>
              {fit ? 'Ask' : 'Ask about this'}
            </button>
          ) : null}
          <button type="button" onClick={onFull} className={`${small} bg-selected text-inverse hover:bg-[#2a2a2a]`}>
            Full result
          </button>
        </div>
      </div>
      <div ref={listRef} className="relative flex min-h-0 flex-[1_1_0] flex-col gap-1.5 overflow-hidden" style={fit ? undefined : { minHeight: count * 56 + (count - 1) * 6 }}>
        {rows.map(({ m, kind }, i) => {
          const unit = m.value === null ? '' : unitOf(m).trim()
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpen(m.id)}
              aria-label={`${METRIC_META[m.id].label}: ${fmtReading(m.value, m)}${unit ? ` ${unit}` : ''}. Open in the result.`}
              className="flex min-h-14 max-h-24 flex-1 animate-[wRise_.5s_both] items-center gap-3 rounded-[18px] squircle bg-ink/[.035] py-2.5 pr-4 pl-2.5 text-left text-ink transition-[background-color] duration-300 ease-standard hover:bg-ink/[.07]"
              style={{ animationDelay: `${i < count ? i * 70 + 120 : (i - count) * 50}ms` }}
            >
              <span aria-hidden className="size-9 flex-none rounded-[12px] squircle shadow-[inset_0_0_10px_2px_rgba(255,255,255,.5)]" style={{ background: metricAura(m.id) }} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px]">{METRIC_META[m.id].label}</span>
                <VerdictLine kind={kind} way={changeWay(m)} className="text-[12px] text-ink-2" />
              </span>
              <span className="flex flex-none flex-col items-end gap-0.5">
                {/* metric-num (DESIGN.md): Geist Mono 15 with the unit; the dot-matrix face is for large numerals only. */}
                <span className="flex items-baseline gap-[3px] tnum">
                  <span className="font-mono text-[15px] font-medium">{fmtReading(m.value, m)}</span>
                  {unit ? <span className="text-[11px] text-ink-2">{unit}</span> : null}
                </span>
                {m.delta !== null && kind !== 'baseline' && kind !== 'notCompared' ? (
                  <span className={`font-mono text-[11.5px] tnum ${kind === 'changed' ? 'text-signal-ink' : 'text-ink-2'}`}>
                    {fmtSigned(m.delta, m)}
                    {unit && unit !== '°' ? ` ${unit}` : ''}
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
    </HomeCard>
  )
}

export type SetupRow = { t: string; d: string; state: 'done' | 'part' | 'todo'; part?: number; onClick: () => void; action?: { label: string; onClick: () => void } }

/** Set up Willow: what is still missing before results mean something. */
export function SetupCard({ rows, className }: { rows: SetupRow[]; className?: string }) {
  const done = rows.filter((r) => r.state === 'done').length
  const pct = Math.round(((done + rows.reduce((a, r) => a + (r.state === 'part' ? (r.part ?? 0.5) : 0), 0)) / rows.length) * 100)
  return (
    <HomeCard label="Setup" className={className} delay={120}>
      <CardHead title="Set up Willow" note={`${done} of ${rows.length}`} />
      <div aria-hidden className="h-[5px] overflow-hidden rounded-[5px] bg-ink/[.08]">
        <span className="block h-full rounded-[5px] transition-[width] duration-[800ms] ease-standard" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #FFB27A, #F25FA8)' }} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {rows.map((r) => (
          <li key={r.t} className="flex items-center gap-1.5">
            <button type="button" onClick={r.onClick} className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] squircle px-1.5 py-[7px] text-left text-ink transition-[background] duration-[250ms] hover:bg-ink/5">
              <span
                aria-hidden
                className={`grid size-[22px] flex-none place-items-center rounded-full border-[1.5px] text-[11px] ${r.state === 'done' ? 'border-ink bg-selected text-inverse' : 'border-ink/25 text-ink'}`}
              >
                {r.state === 'done' ? '✓' : r.state === 'part' ? '◐' : ''}
              </span>
              <span className="flex flex-1 flex-col">
                <span className={`text-[13.5px] ${r.state === 'done' ? 'text-ink-2 line-through' : ''}`}>
                  {r.t}
                  <span className="sr-only">{r.state === 'done' ? ', done' : r.state === 'part' ? ', started' : ', to do'}</span>
                </span>
                <span className="text-[11.5px] text-ink-2">{r.d}</span>
              </span>
              {r.action ? null : (
                <span aria-hidden className="text-[13px] text-ink-2">
                  →
                </span>
              )}
            </button>
            {r.action ? (
              <Pill tone="outline" className="shrink-0" onClick={r.action.onClick}>
                {r.action.label}
              </Pill>
            ) : null}
          </li>
        ))}
      </ul>
    </HomeCard>
  )
}

const EFFECT_STROKE: Record<Effect, string> = { helping: 'var(--willow-700)', away: 'var(--aura-coral)', changed: 'currentColor', steady: 'currentColor', early: 'currentColor' }
const EFFECT_WORD: Record<Effect, { glyph: string; word: string }> = {
  helping: { glyph: '◆', word: 'helping' },
  away: { glyph: '▲', word: 'moving the other way' },
  changed: { glyph: '◆', word: 'shifted' },
  steady: { glyph: '○', word: 'no change yet' },
  early: { glyph: '◌', word: 'too early' },
}

/**
 * Routine effect: how much the routine is moving your skin, product by product. Each row is a product with the
 * measurement it targets (a trend line since the day it started, against your own normal range), and a short
 * flag when a product moved the other way, shows nothing after weeks of use, or overlaps another. All of it
 * comes from lib/effect.ts (measured numbers and rules, never a model); timing is an association, not proof.
 */
/**
 * What each row says happened, as an association: the reading a product targets moved (or did not) while it
 * was in use. Never "helping": that would say the product caused it, right above "an association, not proof".
 */
const EFFECT_LINE: Record<Effect, string> = {
  helping: 'Improved since you started it',
  away: 'Moved the other way since you started it',
  changed: 'Shifted since you started it',
  steady: 'No change beyond your normal range',
  early: 'Too early to tell',
}

/** The row's line in a word or two (Home fitted to the screen); never "helping", as above. */
const EFFECT_SHORT: Record<Effect, string> = { helping: 'Improved', away: 'Moved the other way', changed: 'Shifted', steady: 'No change', early: 'Too early to tell' }

/** The headline counts every product that can be judged, and the list below can show every one of them. */
export function effectSummary(c: Record<Effect, number>): string {
  const judged = c.helping + c.away + c.changed + c.steady
  if (judged === 0) return 'Too early to say how your readings moved with your routine.'
  if (c.helping === 0 && c.away === 0) return c.changed ? 'Some readings shifted while you used these products.' : 'Nothing has moved beyond your normal range yet.'
  return `For ${c.helping} of ${judged} ${judged === 1 ? 'product' : 'products'}, the reading it targets improved beyond your normal range since you started it.`
}

/** The headline in a few words, for Home fitted to the screen. */
function effectSummaryShort(c: Record<Effect, number>): string {
  const judged = c.helping + c.away + c.changed + c.steady
  if (judged === 0) return 'Too early to say yet'
  if (c.helping === 0 && c.away === 0) return c.changed ? 'Some readings shifted' : 'Nothing beyond your normal range yet'
  return `For ${c.helping} of ${judged}, the reading it targets improved`
}

/** A flag in a few words (fitted to the screen); the full note is its tooltip and accessible name. */
const FLAG_SHORT: Record<EffectFlag['kind'], string> = { away: 'Moved the other way', review: 'May not be needed', overlap: 'Shares an active' }

/** Rows shown before "Show all": the flagged and changed ones come first (lib/effect.ts order). */
const EFFECT_ROWS = 4

/** The places that measure what a product targets (its concerns, lib/catalog), where its check-ins are counted. */
function targetSites(e: RoutineEntry): Site[] {
  const metrics = [...new Set(e.concerns.flatMap((c) => CONCERN_METRICS[c] ?? []))] as MetricId[]
  const sites = [...new Set(metrics.flatMap((m) => METRIC_META[m]?.sites ?? []))].filter((x) => OUTCOME_SITES.includes(x))
  return sites.length ? sites : ['face_full']
}

const EASE = [0.2, 0.8, 0.2, 1] as const
/** The height the first-read path needs to read well (its heading and three steps). */
const FIRST_READ_PATH_PX = 200

/** The measured height of a box, updated when it changes by a whole pixel. */
function useBoxHeight() {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setH(Math.round(e.contentRect.height)))
    ro.observe(el)
    return () => ro.disconnect()
  })
  return { ref, h }
}

/**
 * Is your routine working? One row per product, the rows sharing the card's height so the list fills it
 * however many products there are (one to four, the rest one tap away). Each row: the product, what its
 * target reading did since it started, and on the right either that reading's trend against the person's
 * normal range (once it can be judged; the chart takes the row's height) or how far the product is toward
 * its first read (two weeks of use and two check-ins since it started, lib/outcome.ts). A flag (moved the
 * other way, nothing after weeks, an overlap) is a note under the row, written out in full, with Ask Wisp
 * at its end. Every layout here is fluid (no breakpoint): the card narrows when Wisp opens without a jump.
 * Rows rise in, and move to their new place when the routine check's flags reorder them.
 * Four tests: the meter answers "when will I know?" for a product too new to judge (1); a bar filling
 * toward "first read" and filled pips for check-ins need no legend (2); nothing is clipped, the flag's
 * text is never cut mid-word (3); the row surfaces, pills and chart are the card's own (4).
 */
export function RoutineEffectCard({ effect, sessions, onOpen, onAsk, asOf, asOfTime, legend = true, className }: {
  effect: RoutineEffect
  /** The sessions the effect was read from (counts check-ins since each product started). */
  sessions: Session[]
  onOpen: () => void
  onAsk: (question: string) => void
  /** The day the effect is read as of, when that is not today (the demo journey's last check-in): said once. */
  asOf?: string | null
  asOfTime?: number
  /** Explain the chart marks here (fitted to the screen the goals card beside it does, so it never repeats them). */
  legend?: boolean
  className?: string
}) {
  const [all, setAll] = useState(false)
  const reduce = useReducedMotion()
  // Fitted to the screen: as many rows as the card's height holds, the rest one tap away on Routine.
  const fit = useHomeFit()
  const { ref: listRef, n: fits } = useFitCount<HTMLUListElement>(effect.rows.length, { enabled: fit, start: EFFECT_ROWS })
  const shown = fit ? effect.rows.slice(0, fits) : all ? effect.rows : effect.rows.slice(0, EFFECT_ROWS)
  const hidden = effect.rows.length - (fit ? fits : EFFECT_ROWS)
  const charts = shown.some((r) => r.effect !== 'early' && r.points.length > 1)
  // Decided on all the products, not on the rows drawn (fitted, fewer may be drawn than there are).
  const few = effect.rows.length <= 2 && effect.rows.every((r) => r.effect === 'early')
  const { ref: roomRef, h: room } = useBoxHeight()
  // Fitted, the headline is one short line (the full sentence is the scrolling layout's).
  const summary = fit ? `${effectSummaryShort(effect.counts)}${asOf ? ` · as of ${asOf}` : ''}${hidden > 0 ? ` · ${hidden} more on Routine` : ''}` : `${effectSummary(effect.counts)}${asOf ? ` As of the last check-in, ${asOf}.` : ''}`
  return (
    <section
      aria-label="Routine effect"
      className={`relative isolate flex min-w-0 animate-[wRise_.55s_.28s_both] flex-col gap-2.5 overflow-hidden rounded-lg squircle p-4 text-ink ${className ?? ''}`}
      style={{ background: 'radial-gradient(100% 90% at 0% 0%, #E6F3FF 0%, transparent 60%), radial-gradient(90% 100% at 100% 100%, #D8B8FF 0%, transparent 62%), #EAF2FF', boxShadow: 'inset 0 0 44px 8px rgba(255,255,255,.45), 0 26px 54px -42px rgba(61,123,255,.55)' }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="m-0 text-h3 font-normal">Is your routine working?</h2>
          <button type="button" onClick={onOpen} className="hit44 min-h-9 shrink-0 text-[13px] text-ink-2 transition-colors hover:text-ink">
            Routine →
          </button>
        </div>
        <p key={summary} className="m-0 animate-[wFadeIn_.4s_both] text-[12.5px] leading-[1.35] text-pretty text-ink-2">
          {summary}
        </p>
      </div>
      <ul ref={listRef} className={`m-0 flex list-none flex-col gap-1.5 p-0 ${fit ? (few ? 'min-h-0 flex-none' : 'relative min-h-0 flex-[1_1_0] overflow-hidden') : few ? 'flex-none' : 'flex-auto'}`}>
        <AnimatePresence initial={false}>
          {shown.map((r, i) => (
            <motion.li
              key={r.e.id}
              // The first rows rise in with the card (the app's CSS rise, off the main thread while Home loads);
              // rows that "Show all" reveals open their own height and fade in (an accordion: the card grows
              // with them instead of jumping), and close the same way on "Show fewer". Motion also moves a row
              // to its new place when the routine check's flags reorder the list.
              layout={reduce ? false : 'position'}
              initial={i < EFFECT_ROWS ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              // Fitted, a row leaves at once: the count that fits is measured, and a row still closing would read as overflow.
              exit={fit ? undefined : { height: 0, opacity: 0, transition: { duration: reduce ? 0.1 : 0.24, ease: [0.4, 0, 1, 1] } }}
              transition={{ duration: reduce ? 0.15 : 0.42, ease: EASE, layout: { duration: 0.5, ease: EASE } }}
              className={`flex min-w-0 flex-auto flex-col ${i < EFFECT_ROWS ? '' : 'overflow-hidden'}`}
            >
              <div
                className="flex max-h-[200px] min-h-[60px] min-w-0 flex-auto animate-[wRise_.5s_both] flex-col justify-center gap-2 rounded-[18px] squircle bg-white/55 py-2 pr-2.5 pl-2"
                style={{ animationDelay: `${i < EFFECT_ROWS ? 320 + i * 60 : 60}ms` }}
              >
                <EffectRowBody r={r} sessions={sessions} asOfTime={asOfTime} short={fit} />
                {r.flag && fit ? (
                  <p title={r.flag.text} className="m-0 ml-[42px] flex items-center gap-2 rounded-[12px] bg-[#FFE3CF]/80 py-1 pr-1 pl-2.5 text-[11.5px] leading-[1.3]">
                    <span className="min-w-0 flex-1">
                      <span aria-hidden>△ </span>
                      {FLAG_SHORT[r.flag.kind]}
                      <span className="sr-only">: {r.flag.text}</span>
                    </span>
                    <button type="button" onClick={() => onAsk(r.flag!.question)} className="hit44 inline-flex flex-none items-center gap-0.5 rounded-pill bg-white/85 px-2 py-px text-[11.5px] whitespace-nowrap text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.08)] transition-colors hover:bg-white">
                      Ask Wisp <span aria-hidden>→</span>
                    </button>
                  </p>
                ) : r.flag ? (
                  // The note in full (never cut mid-word); Ask Wisp sits at the end of its text, so it reflows with it.
                  <p className="m-0 ml-[42px] rounded-[12px] bg-[#FFE3CF]/80 px-2.5 py-1.5 text-[11.5px] leading-[1.4] text-pretty">
                    <span aria-hidden>△ </span>
                    {r.flag.text}{' '}
                    <button type="button" onClick={() => onAsk(r.flag!.question)} className="hit44 inline-flex items-center gap-0.5 rounded-pill bg-white/85 px-2 py-px align-baseline text-[11.5px] whitespace-nowrap text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.08)] transition-colors hover:bg-white">
                      Ask Wisp <span aria-hidden>→</span>
                    </button>
                  </p>
                ) : null}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {few ? (
        // One or two products, none judged yet: the card's free height (only when it has some: the wrapper adds
        // nothing to the card's own height, so on a phone it stays compact) becomes the path every row's meter is
        // counting along (the rule in lib/outcome.ts, in words), drawn as steps on a line that spans the space.
        <div ref={roomRef} className="flex min-h-0 flex-[1_1_0] flex-col">
          {room >= FIRST_READ_PATH_PX ? (
        <div className="relative flex flex-auto animate-[wRise_.5s_both] flex-col gap-3 rounded-[18px] squircle bg-white/35 px-3.5 py-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,.55)]">
          <span className="text-[12px] text-ink-2">How a product gets its first read</span>
          <ol className="relative m-0 flex flex-auto list-none flex-col justify-between gap-3 p-0 text-[12.5px] leading-[1.4]">
            <span aria-hidden className="absolute top-3 bottom-3 left-[9.5px] w-px bg-[repeating-linear-gradient(180deg,rgba(18,18,18,.22)_0_4px,transparent_4px_8px)]" />
            {[
              [`${countWord(FIRST_READ_DAYS / 7)} weeks of use`, 'Most changes take at least two weeks to show'],
              [`${countWord(FIRST_READ_CHECKINS)} check-ins after you start it`, 'Each one compared with your baseline'],
              ['A first read', 'Improved, no change, or moved the other way, against your own normal range'],
            ].map(([t, d], i) => (
              <li key={t} className="relative flex items-start gap-2.5">
                <span aria-hidden className={`grid size-5 flex-none place-items-center rounded-full font-mono text-[10.5px] tnum ${i === 2 ? 'bg-selected text-inverse' : 'bg-white shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]'}`}>{i + 1}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>{t}</span>
                  <span className="text-[11.5px] text-pretty text-ink-2">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
          ) : null}
        </div>
      ) : null}
      {hidden > 0 && fit ? null : hidden > 0 ? (
        // The headline counts every product: the rest of them are one tap away, never out of reach.
        <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className="hit44 min-h-9 self-start rounded-pill bg-white/60 px-3 text-[12.5px] text-ink transition-[background,scale] duration-200 ease-standard hover:bg-white/85 active:scale-[.97]">
          {all ? 'Show fewer' : `Show all ${effect.rows.length} products`}
        </button>
      ) : null}
      <div className="flex flex-col gap-1 text-[11px] leading-[1.35] text-ink-2">
        {charts && legend && !fit ? <TrendLegend className="text-[11px]" /> : null}
        <span>Timing is an association, not proof that a product caused it.</span>
      </div>
    </section>
  )
}

/** A row's product and line, and on the right its reading's trend or its way to a first read. */
function EffectRowBody({ r, sessions, asOfTime, short = false }: { r: EffectRow; sessions: Session[]; asOfTime?: number; short?: boolean }) {
  const chart = r.effect !== 'early' && r.points.length > 1
  const read = firstRead(r.days, r.effect === 'early' ? checkInsSince(r.e.started_at, targetSites(r.e), sessions, asOfTime) : FIRST_READ_CHECKINS)
  return (
    <div className="flex flex-auto items-center gap-2.5">
      <ProductImage product={imageOf(r.e)} size={32} decorative />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 break-words">
        {/* brand and short name: two niacinamide serums never read as the same row */}
        <span className="text-[13px] leading-[1.3] text-pretty" title={r.e.custom_name}>
          {brandedName(r.e)}
        </span>
        <span className="text-[11px] leading-[1.35] text-pretty text-ink-2" title={r.o.detail}>
          {/* each part stays whole when the line wraps; a product too new to judge has its days in the meter */}
          <span aria-hidden>{EFFECT_WORD[r.effect].glyph} </span>
          {short ? EFFECT_SHORT[r.effect] : EFFECT_LINE[r.effect]}
          {r.metric ? <> <span className="whitespace-nowrap">· {METRIC_META[r.metric].label}</span></> : null}
          {r.effect === 'early' ? null : <> <span className="whitespace-nowrap">· {spanOfUse(r.days)}</span></>}
        </span>
      </span>
      {chart ? (
        // The trend takes the row's height without adding to it (FillTrend): a row is as tall as its words, or
        // as the card gives it, and the trend fills that, never pushing the card taller.
        <span className={`relative min-h-[34px] max-w-[170px] min-w-[72px] flex-none self-stretch text-ink-2 ${short ? 'w-[28%]' : 'w-[36%]'}`} title={r.reading ?? undefined}>
          <FillTrend points={r.points} baseline={r.baseline} band={r.band} stroke={EFFECT_STROKE[r.effect]} label={`${r.metric ? METRIC_META[r.metric].label : 'Reading'} since you started, with your baseline and normal range`} />
        </span>
      ) : r.effect === 'early' ? (
        <FirstReadMeter days={read.days} checkIns={read.checkIns} daysLeft={read.daysLeft} />
      ) : null}
    </div>
  )
}

/**
 * Toward a first read: a bar for the two weeks of use (it fills as days pass) and a pip per check-in needed
 * since the start. Fills grow in from the left once, then glide to a new value.
 */
function FirstReadMeter({ days, checkIns, daysLeft }: { days: number; checkIns: number; daysLeft: number }) {
  const reduce = useReducedMotion()
  const left = FIRST_READ_CHECKINS - checkIns
  const when = daysLeft > 0 ? `in ${plural(daysLeft, 'day')}` : left > 0 ? `after ${plural(left, 'check-in')}` : 'at the next check-in'
  return (
    <span role="img" aria-label={`First read ${when}: ${days} of ${FIRST_READ_DAYS} days of use, ${checkIns} of ${FIRST_READ_CHECKINS} check-ins since you started it.`} className="flex w-[36%] max-w-[170px] min-w-[96px] flex-none flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-1 text-[10.5px] leading-none text-ink-2">
        <span>First read</span>
        <span className="font-mono tnum">
          {days}/{FIRST_READ_DAYS}d
        </span>
      </span>
      <span className="relative h-1.5 overflow-hidden rounded-pill bg-ink/[.08]">
        <motion.span
          className="absolute inset-0 origin-left rounded-pill bg-[var(--willow-700)]"
          initial={{ transform: 'scaleX(0)' }}
          animate={{ transform: `scaleX(${Math.max(0.04, days / FIRST_READ_DAYS)})` }}
          transition={{ duration: reduce ? 0 : 0.9, ease: EASE, delay: reduce ? 0 : 0.5 }}
        />
      </span>
      <span className="flex items-center gap-1 text-[10.5px] leading-none text-ink-2">
        {Array.from({ length: FIRST_READ_CHECKINS }, (_, i) => (
          <span key={i} aria-hidden className={`size-[7px] rounded-full transition-[background-color,box-shadow] duration-500 ${i < checkIns ? 'bg-[var(--willow-700)]' : 'shadow-[inset_0_0_0_1.25px_rgba(18,18,18,.3)]'}`} />
        ))}
        <span className="ml-0.5 font-mono tnum">{checkIns}/{FIRST_READ_CHECKINS}</span>
        <span>check-ins</span>
      </span>
    </span>
  )
}

/**
 * Your goals: each measure the person chose, as a trend since the baseline against their own normal range.
 * Each row leads with the measure and what happened in words, then the two numbers that matter (baseline →
 * now, with the unit), then the trend at the row's full width with its first and last dates under it. The
 * dashed line and the band are explained once, in a legend at the foot.
 */
export function GoalsCard({ trends, baseline, onOpen, onProgress, onAsk, className }: { trends: GoalTrend[]; baseline: Session | null; onOpen: (metricId: string) => void; onProgress: () => void; onAsk?: () => void; className?: string }) {
  const small = 'inline-flex min-h-9 items-center rounded-pill px-3 text-[12.5px] whitespace-nowrap transition-[background,scale] duration-200 active:scale-[.97]'
  // Fitted to the screen: the goals whose trend the card's height holds (the rest are on Progress).
  const fit = useHomeFit()
  const { ref: listRef, n } = useFitCount<HTMLUListElement>(Math.min(3, trends.length), { enabled: fit, start: 3 })
  const more = Math.min(3, trends.length) - n
  return (
    <HomeCard label="Your goals" className={`gap-3 p-4 ${className ?? ''}`} delay={320}>
      <div className={`flex items-start justify-between gap-x-3 gap-y-2 ${fit ? '' : 'flex-wrap'}`}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 text-h3 font-normal">Your goals</h2>
          <span className="text-[12.5px] text-ink-2">
            {baseline ? `Since your baseline, ${shortDay(baseline.created_at)}` : 'Since your baseline'}
            {more > 0 ? ` · ${more} more on Progress` : ''}
          </span>
        </div>
        <div className="flex gap-1.5">
          {onAsk ? (
            <button type="button" onClick={onAsk} className={`${small} text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.14)] hover:bg-ink/5`}>
              Ask
            </button>
          ) : null}
          <button type="button" onClick={onProgress} className={`${small} bg-selected text-inverse hover:bg-[#2a2a2a]`}>
            See progress
          </button>
        </div>
      </div>
      <ul ref={listRef} className={`m-0 flex list-none flex-col gap-1.5 p-0 ${fit ? 'relative min-h-0 flex-[1_1_0] overflow-hidden' : 'flex-1'}`}>
        {trends.slice(0, n).map((t, i) => {
          const ember = t.kind === 'changed' && t.way !== 'otherWay'
          const first = t.points[0]
          const last = t.points[t.points.length - 1]
          return (
            <li key={t.id} className="flex flex-auto animate-[wRise_.5s_both]" style={{ animationDelay: `${360 + i * 60}ms` }}>
              <button
                type="button"
                onClick={() => onOpen(t.id)}
                aria-label={`${t.label}: ${t.line}.${t.reading ? ` ${t.reading}.` : ''} Open in the result.`}
                className={`group flex flex-1 flex-col rounded-[18px] squircle bg-ink/[.035] px-3.5 text-left ${fit ? 'gap-1.5 pt-2.5 pb-2' : 'gap-2.5 pt-3 pb-2.5'} text-ink transition-[background,scale] duration-200 ease-standard hover:bg-ink/[.06] active:scale-[.99]`}
              >
                <span className="flex items-start gap-3">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="size-2.5 flex-none rounded-full" style={{ background: metricAura(t.id) }} />
                      <span className="truncate text-[14.5px]">{t.label}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[12px] leading-[1.35] text-ink-2">
                      <span aria-hidden className={`flex-none ${ember ? 'text-signal' : ''}`}>
                        {t.way ? CHANGE_WORDS[t.way].glyph : VERDICT_WORDS[t.kind].glyph}
                      </span>
                      {/* fitted to the screen: the verdict's own short words (the full line is the row's label) */}
                      <span className={fit ? 'truncate' : 'line-clamp-2'}>{fit ? (t.way ? CHANGE_WORDS[t.way].label : VERDICT_WORDS[t.kind].label) : t.line}</span>
                    </span>
                  </span>
                  {t.from && t.to ? (
                    <span className="flex flex-none items-baseline gap-1 pt-px font-mono text-[12.5px] whitespace-nowrap tnum">
                      <span className="text-ink-2">{t.from}</span>
                      <span aria-hidden className="text-ink-2">→</span>
                      <span className={ember ? 'text-signal-ink' : ''}>{t.to}</span>
                      {t.unit ? <span className="font-ui text-[11px] text-ink-2">{t.unit}</span> : null}
                    </span>
                  ) : null}
                </span>
                {t.points.length > 1 ? (
                  // The trend fills the row's height without adding to it (FillTrend), so a stretched card
                  // never ratchets taller through its own charts.
                  <span className={`relative flex-1 text-ink-2 ${fit ? 'min-h-[40px]' : 'min-h-[62px]'}`}>
                    <FillTrend points={t.points} baseline={t.baseline} band={t.band} stroke={ember ? 'var(--signal-change)' : 'currentColor'} dates={fit ? undefined : [shortDay(new Date(first.t).toISOString()), shortDay(new Date(last.t).toISOString())]} label={`${t.label} across your check-ins, with your baseline and normal range`} />
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
      <TrendLegend />
    </HomeCard>
  )
}

/**
 * A trend that fills the box it is placed in (absolutely, so it never adds to the box's height) at any size:
 * the chart is redrawn at the measured size, so dots stay round and strokes stay 2.5px, with the first and last
 * dates under it when given. Unlike FluidTrend (capped at 120px tall, and its own height feeding the rows
 * around it), a tall row gets a tall chart and a short one a short chart. Redrawn only when the size changes
 * by a whole pixel.
 */
function FillTrend({ dates, ...rest }: Omit<Parameters<typeof TrendChart>[0], 'width' | 'height'> & { dates?: [string, string] }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width)
      const h = Math.round(e.contentRect.height)
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <span className="absolute inset-0 flex flex-col gap-1 py-0.5">
      <span ref={ref} className="relative min-h-0 flex-1">
        {box.w > 40 && box.h > 16 ? (
          <span className="absolute inset-0 animate-[wFadeIn_.4s_both]">
            <TrendChart {...rest} width={box.w} height={box.h} />
          </span>
        ) : null}
      </span>
      {dates ? (
        <span aria-hidden className="flex justify-between font-mono text-[10.5px] text-ink-2 tnum">
          <span>{dates[0]}</span>
          <span>{dates[1]}</span>
        </span>
      ) : null}
    </span>
  )
}

/** What the dashed line and the band mean, drawn with the same marks as the charts (said once per card). */
export function TrendLegend({ className = '' }: { className?: string }) {
  return (
    <span className={`flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-ink-2 ${className}`}>
      <span className="flex items-center gap-1.5">
        <svg aria-hidden width="16" height="6" viewBox="0 0 16 6" className="text-ink-2">
          <line x1="0" x2="16" y1="3" y2="3" stroke="currentColor" strokeWidth="1.25" strokeDasharray="4 3" />
        </svg>
        Baseline
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-4 rounded-[3px] bg-ink/14" />
        Your normal range
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-signal" />
        Beyond it
      </span>
    </span>
  )
}

/** This week: a light-blue band on the person's check-in day, with the week's real check-ins. */
export function WeekBand({ range, summary, days, onProgress }: { range: string; summary: string; days: { d: string; name: string; on: boolean; today: boolean }[]; onProgress: () => void }) {
  const checked = days.filter((d) => d.on).map((d) => d.name)
  return (
    <section
      aria-label="This week"
      className="flex animate-[wRise_.5s_both] flex-wrap items-center gap-x-7 gap-y-3.5 rounded-lg squircle py-4 pr-[18px] pl-6"
      style={{ background: 'radial-gradient(90% 160% at 0% 0%, #9CD3FF 0%, transparent 60%), radial-gradient(80% 160% at 100% 100%, #D8B8FF 0%, transparent 62%), #CFE6FF', boxShadow: 'inset 0 0 50px 10px rgba(255,255,255,.45), 0 26px 54px -44px rgba(61,123,255,.6)' }}
    >
      <span className="font-mono text-[11px] tracking-[.08em]">■ THIS WEEK · {range}</span>
      <span className="flex-[1_1_320px] text-[16px] leading-[1.35]">{summary}</span>
      <span role="img" aria-label={checked.length ? `Checked in ${checked.join(', ')}` : 'No check-ins yet this week'} className="flex gap-[5px]">
        {days.map((w, i) => (
          <span key={i} className="flex flex-col items-center gap-1">
            <span aria-hidden className={`size-[22px] rounded-[8px] squircle ${w.on ? 'bg-selected' : 'bg-ink/12'}`} style={{ boxShadow: w.today ? '0 0 0 3px rgba(255,255,255,.85)' : 'none' }} />
            <span aria-hidden className="font-mono text-[10px]">
              {w.d}
            </span>
          </span>
        ))}
      </span>
      <Pill onClick={onProgress}>See progress</Pill>
    </section>
  )
}
