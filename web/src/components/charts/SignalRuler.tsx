import { useState } from 'react'

import { clamp } from '../../lib/format'

export type RulerItem = {
  id: string
  label: string
  /** change ÷ normal range: inside ±1 is within the person's own noise. */
  ratio: number
  /** The value and change in words for the hover card and screen readers ("20.4 · −1.7 since baseline"). */
  detail: string
  /** A real change in the direction the person wants (ember), the other way (outlined), or within noise. */
  tone: 'improved' | 'otherWay' | 'noise'
}

/*
 * Four tests: it tells the person where every reading of the day sits against their own noise, on one line
 * (new: the tiles show them one at a time); a first-time user reads it from the band and the two words on it;
 * it sits in the hero's empty space and covers nothing; it uses the band, the ◆ and the mono labels the rest
 * of the app already uses.
 */

const H = 124
const MID = H / 2
const LIMIT = 1.8

/**
 * The signal ruler: every metric of a check-in as one dot on a single line. The centre is the baseline, the
 * shaded block is the person's normal range (±1 MDC), and each dot sits at change ÷ range. Dots outside the
 * block are the real changes (ember ◆ for the wanted direction). On load the dots slide out from the centre,
 * so the picture is the change itself being drawn. Dots keep their true place; names take four rows (two
 * above, two below), pushed apart to a minimum spacing, each joined to its dot by a hairline.
 */
export function SignalRuler({ items, delay = 400, className = '' }: { items: RulerItem[]; delay?: number; className?: string }) {
  const [hot, setHot] = useState<string | null>(null)
  // From ratio to a percent across the track: ±1 (the band) is 16% either side of the centre.
  const xTrue = (r: number) => 50 + (clamp(r, -LIMIT, LIMIT) / LIMIT) * 46
  const sorted = [...items].sort((a, b) => a.ratio - b.ratio)
  // Dots are spread to a minimum spacing, in order, within their own zone (left of the band, inside it, right of
  // it), so two readings that fell on the same spot both show; a dot never crosses the band's edge.
  const dotX = new Map<string, number>()
  const GAP = 6
  const pack = (group: RulerItem[], lo: number, hi: number) => {
    let pos = group.map((it) => xTrue(it.ratio))
    for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + GAP)
    if (!pos.length) return
    const shift = Math.min(0, hi - pos[pos.length - 1]) + Math.max(0, lo - pos[0])
    pos = pos.map((v) => v + shift)
    if (pos[pos.length - 1] - pos[0] > hi - lo) pos = pos.map((_, i) => lo + ((hi - lo) * i) / Math.max(1, pos.length - 1))
    group.forEach((it, i) => dotX.set(it.id, pos[i]))
  }
  pack(sorted.filter((it) => it.ratio < -1), 2, xTrue(-1) - 3.5)
  pack(sorted.filter((it) => Math.abs(it.ratio) <= 1), xTrue(-1) + 3, xTrue(1) - 3)
  pack(sorted.filter((it) => it.ratio > 1), xTrue(1) + 3.5, 98)
  const x = (r: number, id?: string) => (id && dotX.has(id) ? dotX.get(id)! : xTrue(r))
  const rows = [-1, 1]
  const place = new Map<string, { tx: number; row: number }>()
  const byX = [...items].sort((a, b) => x(a.ratio, a.id) - x(b.ratio, b.id))
  rows.forEach((row, k) => {
    let last = -Infinity
    byX.forEach((it, i) => {
      if (i % 2 !== k) return
      const tx = Math.min(98, Math.max(x(it.ratio, it.id), last + 12))
      place.set(it.id, { tx, row })
      last = tx
    })
  })
  const yOf = (row: number) => MID + row * 28 + (row < 0 ? -2 : 12)
  const summary = items.map((it) => `${it.label}: ${it.detail}`).join('; ')
  return (
    <div role="img" aria-label={`Every reading against your normal range. ${summary}`} className={`relative select-none ${className}`} style={{ height: H }}>
      {/* the line, the normal range named on itself, and the baseline tick */}
      <span aria-hidden className="absolute top-1/2 right-0 left-0 h-[2px] -translate-y-1/2 rounded-full bg-ink/15" />
      <span aria-hidden className="absolute top-1/2 h-[22px] -translate-y-1/2 rounded-[11px] bg-white/80 shadow-[inset_0_0_0_1px_rgba(18,18,18,.08)]" style={{ left: `${xTrue(-1)}%`, width: `${xTrue(1) - xTrue(-1)}%` }} />
      <span aria-hidden className="absolute top-1/2 left-1/2 h-[30px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/60" />
      <span aria-hidden className="absolute left-1/2 -translate-x-1/2 font-mono text-[9.5px] tracking-[.1em] text-ink/70 uppercase" style={{ top: MID + 18 }}>
        baseline
      </span>
      {/* leaders: x in percent of the width, y in px (the box is H tall, the viewBox matches) */}
      <svg aria-hidden viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {items.map((it) => {
          const p = place.get(it.id)!
          if (Math.abs(p.tx - x(it.ratio, it.id)) < 0.5) return null
          return <line key={it.id} x1={x(it.ratio, it.id)} y1={MID + (p.row < 0 ? -12 : 12)} x2={p.tx} y2={p.row < 0 ? yOf(p.row) - 10 : yOf(p.row)} stroke="currentColor" strokeOpacity={hot === it.id ? 0.8 : 0.25} strokeWidth="1" vectorEffect="non-scaling-stroke" className="animate-[wFadeIn_.5s_both]" style={{ animationDelay: `${delay + 700}ms` }} />
        })}
      </svg>
      {items.map((it, i) => {
        const p = place.get(it.id)!
        const ember = it.tone === 'improved'
        const out = Math.abs(it.ratio) > 1
        const on = hot === it.id
        return (
          <span key={it.id} aria-hidden onPointerEnter={() => setHot(it.id)} onPointerLeave={() => setHot((h) => (h === it.id ? null : h))} className="contents">
            {/* the dot: ◆ for a real change the wanted way, ◇ the other way, ○ within noise; slides out from the centre */}
            <span
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 animate-[wFromCentre_1.1s_var(--ease-standard)_both] motion-reduce:animate-none"
              style={{ left: `${x(it.ratio, it.id)}%`, animationDelay: `${delay + i * 60}ms`, zIndex: on ? 5 : out ? 3 : 2 }}
            >
              <span className={`grid size-[22px] place-items-center rounded-full transition-[scale,box-shadow] duration-200 ease-standard ${on ? 'scale-125' : ''} ${ember ? 'bg-signal text-white shadow-[0_6px_16px_-6px_var(--signal-change-glow)]' : it.tone === 'otherWay' ? 'bg-white text-ink shadow-[inset_0_0_0_1.5px_var(--text-primary)]' : 'bg-white/90 text-ink/70 shadow-[inset_0_0_0_1.5px_rgba(18,18,18,.3)]'}`}>
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                  {out ? <path d="M6 1 11 6 6 11 1 6z" fill={ember ? '#fff' : 'none'} stroke={ember ? 'none' : 'currentColor'} strokeWidth="1.4" /> : <circle cx="6" cy="6" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />}
                </svg>
              </span>
            </span>
            {/* the name in its row; on hover the detail joins it */}
            <span
              className={`absolute w-max max-w-[160px] -translate-x-1/2 animate-[wWord_.5s_both] text-center text-[12px] leading-[1.2] whitespace-nowrap transition-[color] duration-200 ${p.row < 0 ? '-translate-y-full' : ''} ${on ? 'font-medium text-ink' : out ? 'text-ink' : 'text-ink-2'}`}
              style={{ left: `${p.tx}%`, top: yOf(p.row), animationDelay: `${delay + 600 + i * 40}ms`, zIndex: on ? 6 : 4 }}
            >
              {it.label}
              <span className={`block font-mono text-[10px] tracking-[.02em] text-ink/70 transition-[opacity,max-height] duration-200 ${on ? 'max-h-4 opacity-100' : 'max-h-0 opacity-0'}`}>{it.detail}</span>
            </span>
          </span>
        )
      })}
    </div>
  )
}
