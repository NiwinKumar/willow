import { useNavigate } from 'react-router-dom'

import { ProductImage } from '../../components/willow/ProductImage'
import type { RoutineEntry, Session } from '../../data/types'
import { imageOf } from '../routine/routineModel'
import { parseDate } from '../../lib/format'
import { dayOf, shortName, splitVerdicts, today, usable } from './derive'

/*
 * Four tests: it shows the whole journey at a glance, baseline to today, with every check-in and every product
 * start on one line (new: nothing on Home showed the shape of the journey); the dots use the calendar's
 * colours and the legend words a first-timer already knows; it is one short band and opens a day on click;
 * same tokens, same squircle, same mono labels. The line draws and the dots land in date order.
 */

type Dot = { day: string; at: number; kind: 'baseline' | 'changed' | 'normal' | 'other'; words: string; n: number }
type Start = { day: string; at: number; name: string; entry: RoutineEntry }

const DOT: Record<Dot['kind'], { bg: string; ring: string }> = {
  baseline: { bg: 'var(--signal-baseline)', ring: 'rgba(18,18,18,.5)' },
  changed: { bg: 'linear-gradient(135deg, #FFB27A, var(--signal-change))', ring: 'rgba(255,106,0,.35)' },
  normal: { bg: 'linear-gradient(135deg, #D8B8FF, #B9A4FF)', ring: 'rgba(122,92,255,.3)' },
  other: { bg: '#E3E1DC', ring: 'rgba(18,18,18,.2)' },
}
const WORDS: Record<Dot['kind'], string> = { baseline: 'Baseline', changed: 'Real change', normal: 'Within normal range', other: 'Not measured' }

/** The journey from the baseline to today: check-ins as dots on one line, product starts as ticks beneath. */
export function JourneyStrip({ sessions, baseline, entries, goals, className = '' }: { sessions: Session[]; baseline: Session; entries: RoutineEntry[]; goals: string[]; className?: string }) {
  const navigate = useNavigate()
  const t0 = parseDate(dayOf(baseline.created_at)).getTime()
  const t1 = parseDate(today()).getTime()
  const span = Math.max(1, t1 - t0)
  const at = (day: string) => Math.min(1, Math.max(0, (parseDate(day).getTime() - t0) / span))
  // One dot per day, the day's best news first.
  const byDay = new Map<string, Session[]>()
  for (const s of sessions) {
    const d = dayOf(s.created_at)
    if (parseDate(d).getTime() < t0) continue
    byDay.set(d, [...(byDay.get(d) ?? []), s])
  }
  const dots: Dot[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => {
      const kind: Dot['kind'] = list.some((s) => s.id === baseline.id || s.is_baseline) ? 'baseline' : list.some((s) => usable(s) && splitVerdicts(s, goals).changed.length) ? 'changed' : list.some(usable) ? 'normal' : 'other'
      return { day, at: at(day), kind, words: WORDS[kind], n: list.length }
    })
  const starts: Start[] = entries
    .map((e) => ({ day: e.started_at.slice(0, 10), at: at(e.started_at.slice(0, 10)), name: shortName(e), entry: e }))
    .filter((s) => parseDate(s.day).getTime() >= t0)
    .sort((a, b) => a.day.localeCompare(b.day))
  if (dots.length < 2) return null
  const days = Math.round(span / 86_400_000)
  const fmt = (d: string) => parseDate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const changed = dots.filter((d) => d.kind === 'changed').length
  // Starts closer than 2.6% to the one before step to the next of three rows, so their photos never overlap.
  const startRow: number[] = []
  starts.forEach((s, i) => {
    let row = 0
    while (row < 2 && starts.some((o, j) => j < i && startRow[j] === row && Math.abs(o.at - s.at) < 0.026)) row++
    startRow.push(row)
  })
  const tall = Math.max(0, ...startRow)
  return (
    <section aria-label="Your journey" className={`card flex animate-[wRise_.55s_.1s_both] flex-col gap-2 px-5 pt-4 pb-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ YOUR JOURNEY · {days} DAYS</span>
        <span className="text-[12.5px] text-ink-2">
          {dots.length} check-ins · {changed ? `${changed} with a real change · ` : ''}
          {starts.length ? `${starts.length} product${starts.length === 1 ? '' : 's'} started` : 'no products started yet'}
        </span>
      </div>
      <div className="relative mx-2" style={{ height: 76 + tall * 26 }}>
        {/* the line, drawn from the baseline to today */}
        <span aria-hidden className="absolute top-[28px] right-0 left-0 h-[2px] origin-left animate-[wLine_1.2s_.3s_var(--ease-standard)_both] rounded-full bg-ink/15" />
        <span aria-hidden className="absolute top-[28px] right-0 size-[10px] -translate-y-1/2 translate-x-1/2 animate-[wDotIn_.4s_1.4s_var(--ease-bounce)_both] rounded-full border-[1.5px] border-dashed border-ink/60 bg-surface" title="Today" />
        <span aria-hidden className="absolute top-[2px] left-0 font-mono text-[10px] tracking-[.06em] text-ink-2 uppercase">{fmt(dots[0].day)} · baseline</span>
        <span aria-hidden className="absolute top-[4px] right-0 font-mono text-[10px] tracking-[.06em] text-ink-2 uppercase">Today</span>
        {dots.map((d) => (
          <button
            key={d.day}
            type="button"
            onClick={() => navigate(`/progress/${d.day}`, { state: { fromCalendar: true } })}
            aria-label={`${parseDate(d.day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${d.words}${d.n > 1 ? `, ${d.n} check-ins` : ''}. Open that day`}
            className="group absolute top-[28px] grid size-11 -translate-x-1/2 -translate-y-1/2 animate-[wDotIn_.45s_var(--ease-bounce)_both] place-items-center"
            style={{ left: `${d.at * 100}%`, animationDelay: `${350 + d.at * 1100}ms`, zIndex: d.kind === 'changed' ? 3 : 2 }}
          >
            <span className={`rounded-full transition-[scale,box-shadow] duration-200 ease-standard group-hover:scale-125 group-active:scale-95 ${d.kind === 'changed' ? 'size-[16px]' : d.kind === 'baseline' ? 'size-[14px]' : 'size-[11px]'}`} style={{ background: DOT[d.kind].bg, boxShadow: `0 0 0 2px var(--bg-surface), 0 0 0 3.5px ${DOT[d.kind].ring}` }} />
            <span aria-hidden className="pointer-events-none absolute bottom-[calc(100%-2px)] left-1/2 w-max -translate-x-1/2 translate-y-1 rounded-[12px] bg-selected px-2.5 py-1.5 text-[11.5px] leading-[1.3] text-inverse opacity-0 shadow-[0_14px_28px_-14px_rgba(0,0,0,.5)] transition-[opacity,translate] duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:opacity-100">
              {fmt(d.day)} · {d.words}
            </span>
          </button>
        ))}
        {starts.map((s, i) => (
          <span key={`${s.day}${s.name}`} className="group absolute top-[38px] flex -translate-x-1/2 animate-[wRise_.4s_both] flex-col items-center" style={{ left: `${s.at * 100}%`, animationDelay: `${500 + s.at * 1100}ms`, zIndex: 4 }} title={`Started ${s.name}, ${fmt(s.day)}`}>
            <span aria-hidden className="w-[1.5px] rounded-full bg-willow-500" style={{ height: 10 + startRow[i] * 26 }} />
            <span className="block rounded-full shadow-[0_0_0_2px_var(--bg-surface),0_0_0_3px_var(--willow-500)] transition-[scale] duration-200 group-hover:scale-125">
              <ProductImage product={imageOf(s.entry)} size={20} decorative />
            </span>
            <span className="sr-only">Started {s.name}, {fmt(s.day)}</span>
            <span aria-hidden className="pointer-events-none absolute top-[calc(100%+4px)] left-1/2 w-max -translate-x-1/2 rounded-[10px] bg-selected px-2 py-1 text-[11px] text-inverse opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              {s.name} · {fmt(s.day)}
            </span>
          </span>
        ))}
      </div>
    </section>
  )
}
