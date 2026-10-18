import type { ReactNode } from 'react'

import { TrendChart } from '../../components/charts'
import { ProductImage } from '../../components/willow/ProductImage'
import type { Session } from '../../data/types'
import { effectHeadline, type Effect, type RoutineEffect } from '../../lib/effect'
import { imageOf } from '../routine/routineModel'
import { fmtSigned, METRIC_META, unitOf, fmtReading } from '../../lib/metrics'
import { CHANGE_WORDS, VERDICT_WORDS, changeWay, verdictKind } from '../../lib/verdict'
import { byGoals, metricAura, shortDay, shortName } from './derive'
import type { GoalTrend } from './goals'
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

/** What changed: the latest measured face check-in against the baseline, changed measures first, with how far each moved. */
export function ChangedCard({ session, baseline, goals, onOpen, onFull, onAsk, className, rows: count = ROWS }: { session: Session; baseline: Session | null; goals: string[]; onOpen: (metricId: string) => void; onFull: () => void; onAsk?: () => void; className?: string; rows?: number }) {
  const metrics = byGoals(session.result?.metrics ?? [], goals).map((m) => ({ m, kind: verdictKind(m, session) }))
  const sorted = [...metrics.filter((x) => x.kind === 'changed'), ...metrics.filter((x) => x.kind !== 'changed')]
  const rows = sorted.slice(0, count)
  const rest = sorted.slice(count)
  const small = 'inline-flex min-h-9 items-center rounded-pill px-3 text-[12.5px] whitespace-nowrap transition-[background] duration-300'
  return (
    <HomeCard label="Since your baseline" className={`gap-2 p-4 ${className ?? ''}`} delay={120}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
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
              Ask about this
            </button>
          ) : null}
          <button type="button" onClick={onFull} className={`${small} bg-selected text-inverse hover:bg-[#2a2a2a]`}>
            Full result
          </button>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        {rows.map(({ m, kind }, i) => {
          const unit = m.value === null ? '' : unitOf(m).trim()
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpen(m.id)}
              aria-label={`${METRIC_META[m.id].label}: ${fmtReading(m.value, m)}${unit ? ` ${unit}` : ''}. Open in the result.`}
              className="flex min-h-14 max-h-24 flex-1 animate-[wRise_.5s_both] items-center gap-3 rounded-[18px] squircle bg-ink/[.035] py-2.5 pr-4 pl-2.5 text-left text-ink transition-[background,translate] duration-300 ease-standard hover:translate-x-0.5 hover:bg-ink/[.07]"
              style={{ animationDelay: `${i * 70 + 120}ms` }}
            >
              <span aria-hidden className="size-9 flex-none rounded-[12px] squircle shadow-[inset_0_0_10px_2px_rgba(255,255,255,.5)]" style={{ background: metricAura(m.id) }} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px]">{METRIC_META[m.id].label}</span>
                <VerdictLine kind={kind} way={changeWay(m)} className="text-[12px] text-ink-2" />
              </span>
              <span className="flex flex-none flex-col items-end gap-0.5">
                <span className="flex items-baseline gap-[3px]">
                  <span className="font-dot text-[18px]">{fmtReading(m.value, m)}</span>
                  {unit ? <span className="text-[10.5px] text-ink-2">{unit}</span> : null}
                </span>
                {m.delta !== null && kind !== 'baseline' && kind !== 'notCompared' ? <span className="text-[11px] text-ink-2">{fmtSigned(m.delta, m)}</span> : null}
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
export function RoutineEffectCard({ effect, onOpen, onAsk, className }: { effect: RoutineEffect; onOpen: () => void; onAsk: (question: string) => void; className?: string }) {
  const shown = effect.rows.slice(0, 4)
  return (
    <section
      aria-label="Routine effect"
      className={`@container relative isolate flex min-w-0 animate-[wRise_.55s_.28s_both] flex-col gap-2 overflow-hidden rounded-lg squircle p-4 text-ink ${className ?? ''}`}
      style={{ background: 'radial-gradient(100% 90% at 0% 0%, #E6F3FF 0%, transparent 60%), radial-gradient(90% 100% at 100% 100%, #D8B8FF 0%, transparent 62%), #EAF2FF', boxShadow: 'inset 0 0 44px 8px rgba(255,255,255,.45), 0 26px 54px -42px rgba(61,123,255,.55)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-h3 font-normal">Is your routine working?</h2>
        <button type="button" onClick={onOpen} className="min-h-9 shrink-0 text-[13px] text-ink-2 hover:text-ink">
          Routine →
        </button>
      </div>
      <p className="m-0 -mt-1 text-[12.5px] leading-[1.35] text-ink-2 text-balance">{effectHeadline(effect.counts)}</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {shown.map((r) => (
          <li key={r.e.id} className="flex min-w-0 flex-col gap-1.5 rounded-[18px] squircle bg-white/55 py-2 pr-2 pl-2">
            <div className="flex items-center gap-2.5">
              <ProductImage product={imageOf(r.e)} size={32} decorative />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px]">{shortName(r.e)}</span>
                <span className="truncate text-[11px] text-ink-2" title={r.o.detail}>
                  <span aria-hidden>{EFFECT_WORD[r.effect].glyph} </span>
                  {r.line}
                  {r.metric ? ` · ${METRIC_META[r.metric].label}` : ''} · day {r.days}
                </span>
              </span>
              {r.points.length > 1 ? (
                <span className="hidden flex-none text-ink-2 @min-[380px]:block" title={r.reading ?? undefined}>
                  <TrendChart points={r.points} baseline={r.baseline} band={r.band} width={96} height={30} stroke={EFFECT_STROKE[r.effect]} label={`${r.metric ? METRIC_META[r.metric].label : 'Reading'} since you started, with your baseline and normal range`} />
                </span>
              ) : null}
            </div>
            {r.flag ? (
              // Every row looks the same; a flag is a small note under the name (lined up with it), its button compact.
              <div className="ml-[42px] flex items-center gap-2 rounded-[12px] bg-[#FFE3CF]/80 py-1.5 pr-1.5 pl-2.5">
                <span className="line-clamp-2 min-w-0 flex-1 text-[11.5px] leading-[1.35]" title={r.flag.text}>
                  <span aria-hidden>△ </span>
                  {r.flag.text}
                </span>
                <button type="button" onClick={() => onAsk(r.flag!.question)} className="inline-flex min-h-8 flex-none items-center rounded-pill bg-white/85 px-3 text-[12px] whitespace-nowrap text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.08)] transition-colors hover:bg-white">
                  Ask Wisp
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <span className="mt-auto text-[11px] leading-[1.35] text-ink-2">Dashed: your baseline. Shaded: your normal range. Timing is an association, not proof.</span>
    </section>
  )
}

/** Your goals: each measure the person chose, as a trend since the baseline against their own normal range. */
export function GoalsCard({ trends, baseline, onOpen, onProgress, onAsk, className }: { trends: GoalTrend[]; baseline: Session | null; onOpen: (metricId: string) => void; onProgress: () => void; onAsk?: () => void; className?: string }) {
  const small = 'inline-flex min-h-9 items-center rounded-pill px-3 text-[12.5px] whitespace-nowrap transition-[background] duration-300'
  return (
    <HomeCard label="Your goals" className={`@container gap-2 p-4 ${className ?? ''}`} delay={320}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 text-h3 font-normal">Your goals</h2>
          <span className="text-[11px] text-ink-2">
            {baseline ? `since baseline · ${shortDay(baseline.created_at)} · ` : ''}dashed: baseline · shaded: normal
          </span>
        </div>
        <div className="flex gap-1.5">
          {onAsk ? (
            <button type="button" onClick={onAsk} className={`${small} text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.14)] hover:bg-ink/5`}>
              Ask about goals
            </button>
          ) : null}
          <button type="button" onClick={onProgress} className={`${small} bg-selected text-inverse hover:bg-[#2a2a2a]`}>
            See progress
          </button>
        </div>
      </div>
      <ul className="m-0 flex flex-1 list-none flex-col gap-1.5 p-0">
        {trends.slice(0, 3).map((t) => (
          <li key={t.id} className="flex flex-1">
            <button
              type="button"
              onClick={() => onOpen(t.id)}
              aria-label={`${t.label}: ${t.line}. Open in the result.`}
              title={t.reading ?? undefined}
              className="flex min-h-14 max-h-24 flex-1 items-center gap-3 rounded-[18px] squircle bg-ink/[.035] py-2.5 pr-4 pl-2.5 text-left text-ink transition-[background,translate] duration-300 ease-standard hover:translate-x-0.5 hover:bg-ink/[.07]"
            >
              <span aria-hidden className="size-9 flex-none rounded-[12px] squircle shadow-[inset_0_0_10px_2px_rgba(255,255,255,.5)]" style={{ background: metricAura(t.id) }} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px]">{t.label}</span>
                <span className="flex items-center gap-1.5 truncate text-[12px] text-ink-2">
                  <span aria-hidden className={`flex-none ${t.kind === 'changed' && t.way !== 'otherWay' ? 'text-signal' : ''}`}>
                    {t.way ? CHANGE_WORDS[t.way].glyph : VERDICT_WORDS[t.kind].glyph}
                  </span>
                  <span className="truncate">{t.line}</span>
                </span>
              </span>
              {t.points.length > 1 ? (
                <span className="hidden flex-none text-ink-2 @min-[380px]:block">
                  <TrendChart points={t.points} baseline={t.baseline} band={t.band} width={120} height={36} stroke={t.kind === 'changed' && t.way !== 'otherWay' ? 'var(--signal-change)' : 'currentColor'} label={`${t.label} across your check-ins, with your baseline and normal range`} />
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </HomeCard>
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
