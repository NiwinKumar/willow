import type { ReactNode } from 'react'

import type { Session } from '../../data/types'
import { fmtValue, METRIC_META, unitOf } from '../../lib/metrics'
import { verdictKind } from '../../lib/verdict'
import { byGoals, metricAura, shortDay } from './derive'
import { CardHead, Pill, VerdictLine } from './parts'

/** Standard Home card shell: surface, radius 30, rise in. */
export function HomeCard({ label, className = '', delay = 0, children }: { label: string; className?: string; delay?: number; children: ReactNode }) {
  return (
    <section aria-label={label} className={`card flex min-w-0 animate-[wRise_.55s_both] flex-col gap-2.5 p-5 ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </section>
  )
}

/** What changed: the latest measured face check-in's first three measures, in goal order, against the baseline. */
export function ChangedCard({ session, baseline, goals, onOpen, onFull, onAsk, className }: { session: Session; baseline: Session | null; goals: string[]; onOpen: (metricId: string) => void; onFull: () => void; onAsk?: () => void; className?: string }) {
  const rows = byGoals(session.result?.metrics ?? [], goals).slice(0, 3)
  const note = baseline ? `vs baseline · ${shortDay(baseline.created_at)}` : shortDay(session.created_at)
  return (
    <HomeCard label="What changed" className={className} delay={120}>
      <CardHead title="What changed" note={note} />
      <div className="flex flex-col gap-1.5">
        {rows.map((m, i) => {
          const kind = verdictKind(m, session)
          const unit = m.value === null ? '' : unitOf(m).trim()
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpen(m.id)}
              aria-label={`${METRIC_META[m.id].label}: ${fmtValue(m.value, m)}${unit ? ` ${unit}` : ''}. Open in the result.`}
              className="flex min-h-11 animate-[wRise_.5s_both] items-center gap-2.5 rounded-[18px] squircle bg-ink/[.035] py-2 pr-2.5 pl-2 text-left text-ink transition-[background,translate] duration-300 ease-standard hover:translate-x-0.5 hover:bg-ink/[.07]"
              style={{ animationDelay: `${i * 70 + 120}ms` }}
            >
              <span aria-hidden className="size-8 flex-none rounded-[12px] squircle shadow-[inset_0_0_10px_2px_rgba(255,255,255,.5)]" style={{ background: metricAura(m.id) }} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13.5px]">{METRIC_META[m.id].label}</span>
                <VerdictLine kind={kind} className="text-[11.5px] text-ink-2" />
              </span>
              <span className="flex items-baseline gap-[3px]">
                <span className="font-dot text-[18px]">{fmtValue(m.value, m)}</span>
                {unit ? <span className="text-[10.5px] text-ink-2">{unit}</span> : null}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5">
        <Pill onClick={onFull}>Full result</Pill>
        {onAsk ? (
          <Pill tone="outline" onClick={onAsk}>
            Ask about this
          </Pill>
        ) : null}
      </div>
    </HomeCard>
  )
}

export type SetupRow = { t: string; d: string; state: 'done' | 'part' | 'todo'; part?: number; onClick: () => void }

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
          <li key={r.t}>
            <button type="button" onClick={r.onClick} className="flex min-h-11 w-full items-center gap-2.5 rounded-[14px] squircle px-1.5 py-[7px] text-left text-ink transition-[background] duration-[250ms] hover:bg-ink/5">
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
              <span aria-hidden className="text-[13px] text-ink-2">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </HomeCard>
  )
}

/** Next step: the routine check's first finding, in words, with what to do about it. */
export function NextStepCard({ title, body, onRoutine, onAsk, className }: { title: string; body: string; onRoutine: () => void; onAsk: () => void; className?: string }) {
  return (
    <HomeCard label="Next step" className={className} delay={280}>
      <span className="self-start rounded-pill bg-lime px-2.5 py-[5px] font-mono text-[10.5px] tracking-[.08em]">■ NEXT STEP</span>
      <span className="text-[17px] leading-[1.3] tracking-[-0.01em]">{title}</span>
      <span className="text-[13px] leading-normal text-[#3E3C38]">{body}</span>
      <div className="mt-auto flex flex-wrap gap-1.5">
        <Pill onClick={onRoutine}>Look at routine</Pill>
        <Pill tone="outline" onClick={onAsk}>
          Ask the advisor
        </Pill>
      </div>
    </HomeCard>
  )
}

export type RecentRow = { key: string; at: number; d: string; t: string; x: string; onClick?: () => void }

/** Recent: sessions, notes, baselines and routine changes, newest first, each opening its place. */
export function RecentCard({ rows, onAll, className }: { rows: RecentRow[]; onAll: () => void; className?: string }) {
  return (
    <HomeCard label="Recent activity" className={`gap-2 ${className ?? ''}`} delay={320}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-h3 font-normal">Recent</h2>
        <button type="button" onClick={onAll} className="min-h-11 px-0 py-1 text-[13px] text-ink-2 hover:text-ink">
          All in Progress →
        </button>
      </div>
      {rows.length ? (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-x-4 p-0">
          {rows.map((a) => {
            const inner = (
              <>
                <span className="pt-[3px] font-mono text-[10.5px] text-ink-2">{a.d}</span>
                <span aria-hidden className="mt-1.5 size-[7px] rounded-full bg-selected" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13.5px]">{a.t}</span>
                  <span className="truncate text-[12px] text-ink-2">{a.x}</span>
                </span>
              </>
            )
            const cls = 'grid w-full grid-cols-[56px_10px_1fr] items-start gap-2.5 rounded-[14px] px-1.5 py-[7px] text-left text-ink'
            return (
              <li key={a.key}>
                {a.onClick ? (
                  <button type="button" onClick={a.onClick} className={`${cls} min-h-11 transition-[background] duration-200 hover:bg-ink/[.04]`}>
                    {inner}
                  </button>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">Nothing yet. Your check-ins, notes and routine changes will show here.</p>
      )}
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
