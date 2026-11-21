import { useLayoutEffect, useRef, useState } from 'react'

import { parseDate } from '../../lib/format'

/*
 * Four tests: it shows every month of the journey at once, with how many check-ins each holds, and jumps to
 * one in a tap (new: the calendar only stepped a month at a time); month names and dots need no explaining;
 * one short row above the calendar; the dock's black pill, the mono labels and the calendar's own dots.
 */

/** The months of the journey as one row of pills, dots for the check-ins in each; the black pill glides to the month on screen. */
export function MonthStrip({ months, current, counts, onPick }: { months: string[]; current: string; counts: Record<string, number>; onPick: (month: string) => void }) {
  const row = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number; glide: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = row.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!el) return
    setPill((p) => ({ x: el.offsetLeft, w: el.offsetWidth, glide: p !== null }))
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current, months.length])
  if (months.length < 2) return null
  const label = (m: string) => parseDate(`${m}-01`).toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()
  // The year is written only where it changes, and only when the journey spans two.
  const spansYears = new Set(months.map((m) => m.slice(0, 4))).size > 1
  const year = (m: string, i: number) => (spansYears && (i === 0 || months[i - 1].slice(0, 4) !== m.slice(0, 4)) ? m.slice(0, 4) : null)
  return (
    <div ref={row} role="tablist" aria-label="Month" className="no-scrollbar glass-pill relative flex max-w-full gap-0.5 overflow-x-auto rounded-pill p-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,.75)]">
      {pill ? <span aria-hidden className={`pointer-events-none absolute top-1 bottom-1 left-0 rounded-pill bg-selected shadow-[0_8px_18px_-10px_rgba(0,0,0,.5)] ${pill.glide ? 'transition-[translate,width] duration-[360ms] ease-[cubic-bezier(.34,1.2,.5,1)] motion-reduce:transition-none' : ''}`} style={{ translate: `${pill.x}px 0`, width: pill.w }} /> : null}
      {months.map((m, i) => {
        const on = m === current
        const n = counts[m] ?? 0
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={on}
            aria-current={on ? 'true' : undefined}
            aria-label={`${parseDate(`${m}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}, ${n} check-in${n === 1 ? '' : 's'}`}
            onClick={() => onPick(m)}
            className={`relative z-[1] flex min-h-9 shrink-0 flex-col items-center justify-center gap-[3px] rounded-pill px-3 font-mono text-[10.5px] tracking-[.08em] transition-[color,scale] duration-300 active:scale-[.97] ${on ? 'text-inverse' : 'text-ink-2 hover:text-ink'}`}
          >
            <span className="flex items-baseline gap-1">
              {label(m)}
              {year(m, i) ? <span className="opacity-60">{year(m, i)!.slice(2)}</span> : null}
            </span>
            <span aria-hidden className="flex h-[5px] gap-[3px]">
              {Array.from({ length: Math.min(n, 6) }, (_, k) => (
                <span key={k} className={`size-[4px] rounded-full ${on ? 'bg-lime' : 'bg-ink/35'}`} />
              ))}
              {n > 6 ? <span className="-mt-[3px] text-[8px] leading-none">+</span> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
