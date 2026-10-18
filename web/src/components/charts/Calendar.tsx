import { ChevronLeft, ChevronRight, Pointer } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { useMediaQuery } from '../../lib/useMediaQuery'

export type CalendarDay = {
  /** Cell fill (a status gradient). */
  bg: string
  /** Small dots under the number (routine started, note…), colours only; the aria label says what they mean. */
  dots?: string[]
  /** Full accessible name: "Tuesday 14 October, Face, Changed. Open details". */
  label: string
  onPick: () => void
}

/**
 * Month grid from the design's History calendar: Monday first, session days are coloured buttons, today
 * without a session is a dashed "take one" button, other days are quiet numbers (future ones lighter).
 */
export function Calendar({
  month,
  days,
  today,
  current,
  onToday,
  todayLabel = 'Today, no photo yet. Take one',
  dots = {},
  canPrev,
  canNext,
  onPrev,
  onNext,
  legend,
  nudge,
  hint,
}: {
  /** YYYY-MM */
  month: string
  /** YYYY-MM-DD → cell */
  days: Record<string, CalendarDay>
  /** Today's YYYY-MM-DD (local). */
  today: string
  /** The day being looked at (ringed). */
  current?: string | null
  onToday?: () => void
  todayLabel?: string
  /** Dots for days without a session (a routine started that day). */
  dots?: Record<string, string[]>
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  /** Colour key content (opened from the dots button). */
  legend?: ReactNode
  /** A session day that bounces now and then to show it can be opened (until the person has opened one). */
  nudge?: string
  /** A short line with a pointer icon under the month title, saying days can be opened. */
  hint?: ReactNode
}) {
  const compact = useMediaQuery('(max-width: 639px)')
  const [keyOpen, setKeyOpen] = useState(false)
  // The bouncing day stops for good once a pointer or the keyboard reaches it; reduced motion never bounces.
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [reached, setReached] = useState(false)
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const dim = new Date(y, m, 0).getDate()
  const monthName = first.toLocaleDateString('en-GB', { month: 'long' })
  const week = compact ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  const cell = 'aspect-[4/3] min-h-[42px] rounded-[clamp(12px,1.6vw,18px)] p-[clamp(5px,.9vw,9px)] flex flex-col justify-between text-left'
  // Days that open are real buttons that answer the finger: a 2px lift on hover, a 0.96 press, 150ms. The
  // entrance holds only `backwards` so its end state does not pin `scale` and the press can still play.
  // Reduced motion keeps the press as a dim instead of movement. Plain days stay flat, hairline-outlined spans.
  const tap =
    'cursor-pointer animate-[wDotIn_.45s_cubic-bezier(.2,.8,.2,1)_backwards] transition-[translate,scale,opacity] duration-150 ease-standard hover:-translate-y-0.5 active:scale-[.96] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 motion-reduce:active:opacity-80'
  const dotRow = (list: string[] | undefined) => (
    <span aria-hidden className="flex min-h-1.5 gap-[3px]">
      {(list ?? []).map((c, i) => (
        <span key={i} className="size-1.5 rounded-full" style={{ background: c }} />
      ))}
    </span>
  )
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 aria-live="polite" className="m-0 font-serif text-[clamp(36px,4vw,52px)] leading-none font-normal">
            {monthName}
          </h2>
          <span className="font-dot text-[22px] font-extrabold text-ink-2">{y}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {legend ? (
            <div className="relative" onMouseEnter={() => setKeyOpen(true)} onMouseLeave={() => setKeyOpen(false)}>
              <button
                type="button"
                aria-expanded={keyOpen}
                aria-label="Colour key"
                onClick={() => setKeyOpen((o) => !o)}
                onKeyDown={(e) => e.key === 'Escape' && setKeyOpen(false)}
                className="flex h-11 items-center gap-[3px] rounded-pill bg-sunken px-3.5 hover:bg-muted"
              >
                {['var(--signal-baseline)', '#FF9A6A', '#C3AEFF', '#8EC2FF'].map((c) => (
                  <span key={c} aria-hidden className="size-[9px] rounded-full" style={{ background: c }} />
                ))}
              </button>
              {keyOpen ? (
                <div role="tooltip" className="absolute top-[calc(100%+8px)] right-0 z-[12] flex w-[236px] animate-[wRise_.25s_both] flex-col gap-[9px] rounded-[24px] bg-surface/95 p-3.5 text-[13px] shadow-[0_24px_50px_-20px_rgba(0,0,0,.35),inset_0_0_0_1px_rgba(18,18,18,.05)] backdrop-blur-[18px]">
                  {legend}
                </div>
              ) : null}
            </div>
          ) : null}
          <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous month" className="grid size-11 place-items-center rounded-full bg-sunken transition-colors hover:bg-muted disabled:opacity-40">
            <ChevronLeft size={18} aria-hidden />
          </button>
          <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next month" className="grid size-11 place-items-center rounded-full bg-sunken transition-colors hover:bg-muted disabled:opacity-40">
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
      </div>
      {hint ? (
        <p className="m-0 flex w-fit items-center gap-2 rounded-pill bg-sunken px-3.5 py-2 text-[13px] text-ink">
          <Pointer size={15} aria-hidden />
          {hint}
        </p>
      ) : null}
      <div aria-hidden className="grid grid-cols-7 gap-1.5">
        {week.map((w, i) => (
          <span key={i} className="text-center font-mono text-[10px] tracking-[.08em] text-ink-2">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} aria-hidden />
        ))}
        {Array.from({ length: dim }, (_, k) => {
          const d = k + 1
          const iso = `${month}-${String(d).padStart(2, '0')}`
          const day = days[iso]
          const isToday = iso === today
          const delay = { animationDelay: `${d * 14}ms` }
          if (day)
            return (
              <button
                key={iso}
                type="button"
                onClick={day.onPick}
                aria-label={day.label}
                aria-current={iso === current ? 'date' : undefined}
                className={`${cell} ${tap} text-ink`}
                onPointerEnter={iso === nudge ? () => setReached(true) : undefined}
                onFocus={iso === nudge ? () => setReached(true) : undefined}
                style={{ ...delay, ...(iso === nudge && !reached && !reduce ? { animation: 'wDotIn .45s cubic-bezier(.2,.8,.2,1) backwards, wNudge 2.8s ease-in-out 1.6s infinite' } : {}), background: day.bg, boxShadow: iso === current ? '0 0 0 2px var(--bg-surface), 0 0 0 3.5px var(--text-primary)' : 'inset 0 0 0 1px rgba(255,255,255,.5), 0 10px 22px -16px rgba(0,0,0,.45)' }}
              >
                <span className={`text-[clamp(12px,1.3vw,15px)] ${isToday ? 'font-semibold' : ''}`}>{d}</span>
                {dotRow(day.dots)}
              </button>
            )
          if (isToday && onToday)
            return (
              <button key={iso} type="button" onClick={onToday} aria-label={todayLabel} aria-current="date" className={`${cell} ${tap} border-[1.5px] border-dashed border-ink bg-white/40`} style={delay}>
                <span className="text-[clamp(12px,1.3vw,15px)] font-semibold">{d}</span>
                {dotRow(dots[iso])}
              </button>
            )
          return (
            <span key={iso} className={`${cell} border border-ink/6 text-[clamp(12px,1.3vw,15px)] ${iso > today ? 'text-ink-3' : 'text-ink-2'}`}>
              <span>{d}</span>
              {dotRow(dots[iso])}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** One row of the colour key: a swatch and its words. */
export function KeyRow({ swatch, children }: { swatch: React.CSSProperties; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className="h-4 w-[22px] shrink-0 rounded-[6px]" style={swatch} />
      {children}
    </span>
  )
}
