import { useId, useLayoutEffect, useRef, useState } from 'react'

import { labelIndices, timelineGeometry } from './chartMath'

export type TimelinePoint = {
  /** null: no reading this session (a gap; the line bridges it). */
  value: number | null
  /** Short x label (a date, "+24 h"). */
  label: string
  /** Why there is no reading ("photo not usable"); drawn under the gap. */
  why?: string | null
  /** Longer name for the hidden data table ("14 Oct 2026, 13:59"). */
  name?: string
  /** The value as that session's own screen writes it (its own precision); else `format(value)`. */
  text?: string
}

const MONO = 'var(--font-mono)'
const MUTED = 'var(--text-disabled)'
const LIME = 'var(--signal-baseline)'

/**
 * A metric over sessions, as the design draws it on a dark card: the normal range as a blurred
 * violet-to-pink band around the baseline, a dashed baseline, routine markers, a white line that draws in,
 * value pills, and gaps for sessions without a reading. Accessible: a one-sentence summary and a visually
 * hidden table carry the same numbers.
 */
export function TimelineChart({
  points,
  baseIndex,
  band,
  markers = [],
  format,
  bandValue,
  unit = '',
  highlight = null,
  glow = false,
  bandLabel = true,
  summary,
  caption,
}: {
  points: TimelinePoint[]
  baseIndex: number | null
  /** The baseline session's mdc95 (normal range ±band); null draws "NO NORMAL RANGE". */
  band: number | null
  /** Routine changes at fractional session indices. */
  markers?: { at: number; label: string }[]
  format: (v: number) => string
  /** The band as the screen around the chart writes it (a session's own precision); else `format(band)`. */
  bandValue?: string
  /** Unit written above the y axis. */
  unit?: string
  /** The session on screen: a ring around its dot. */
  highlight?: number | null
  /** The history card's blurred band (the detail sheet draws it flat). */
  glow?: boolean
  /** Write "NORMAL RANGE ±x" inside the plot (off where the card's legend already says it). */
  bandLabel?: boolean
  /** One sentence for screen readers. */
  summary: string
  /** Caption of the hidden table. */
  caption: string
}) {
  const id = useId().replace(/:/g, '')
  // The plot is drawn in a 600-wide box and scaled to fit; on a phone (~340px) that would shrink the type to 6px.
  // Text, pills and dots scale back up by the same factor (capped), so labels read at their intended size.
  const fig = useRef<HTMLElement>(null)
  const [w, setW] = useState(600)
  useLayoutEffect(() => {
    const el = fig.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width || 600))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const k = Math.min(1.75, Math.max(1, 600 / w))
  const fs = (px: number) => px * k
  const values = points.map((p) => p.value)
  const g = timelineGeometry(values, baseIndex, band)
  const base = g.base
  const hasBand = band !== null && base !== null
  const baseY = base !== null ? g.Y(base) : g.Y((g.min + g.max) / 2)
  const many = points.length > 7
  const picked = labelIndices(points.length, w < 480 ? 4 : 7, [baseIndex, highlight])
  // Two dates closer than a label's width would print over each other ("25 NOV28 NOV"): walking back from the
  // latest, a label too close to the one after it is dropped (the baseline's is kept).
  const shownLabels = new Set<number>()
  {
    let next = Infinity
    for (let i = points.length - 1; i >= 0; i--) {
      if (!picked.has(i)) continue
      const x = g.X(i)
      if (next - x >= 52 * k || i === baseIndex) {
        shownLabels.add(i)
        next = x
      }
    }
  }
  // Value pills on the baseline, the session on screen and the latest only: with every point labelled the pills
  // collide; the hidden table (and each day's page) has every value.
  const pill = (i: number) => points.length <= 3 || i === baseIndex || i === highlight || i === points.length - 1
  // A point beyond the normal range is the one data accent (DESIGN.md: ember means real change only).
  const beyond = (v: number) => hasBand && Math.abs(v - base!) > band!
  const EMBER = 'var(--signal-change)'
  return (
    <figure ref={fig} className="m-0">
      <svg viewBox="0 0 600 300" aria-hidden className="block h-auto w-full overflow-visible">
        <defs>
          <filter id={`${id}b`} x="-10%" y="-60%" width="120%" height="220%">
            <feGaussianBlur stdDeviation={9} />
          </filter>
          <linearGradient id={`${id}g`} x1={0} x2={1}>
            <stop offset={0} stopColor="var(--aura-violet)" />
            <stop offset={0.5} stopColor="var(--aura-sky)" />
            <stop offset={1} stopColor="var(--aura-pink)" />
          </linearGradient>
        </defs>
        {g.ticks.map((t, i) => (
          <g key={`t${i}`}>
            <line x1={64} x2={580} y1={g.Y(t)} y2={g.Y(t)} stroke="#fff" strokeOpacity={0.07} />
            <text x={56} y={g.Y(t) + 4} textAnchor="end" fill={MUTED} fontSize={fs(11)} fontFamily={MONO}>
              {format(t)}
            </text>
          </g>
        ))}
        {unit ? (
          <text x={56} y={22} textAnchor="end" fill={MUTED} fontSize={fs(11)} fontFamily={MONO}>
            {unit}
          </text>
        ) : null}
        {hasBand ? (
          <rect x={64} y={g.Y(base + band)} width={516} height={g.Y(base - band) - g.Y(base + band)} rx={12} fill={`url(#${id}g)`} opacity={glow ? 0.55 : 0.35} filter={glow ? `url(#${id}b)` : undefined} />
        ) : null}
        {base !== null ? (
          <>
            {bandLabel || !hasBand ? <text x={578} y={hasBand ? g.Y(base - band) + 16 : baseY + 20} textAnchor="end" fill={hasBand ? 'var(--aura-lilac)' : 'var(--action-primary)'} fontSize={fs(10)} fontFamily={MONO} letterSpacing=".04em">
              {hasBand ? `NORMAL RANGE ±${bandValue ?? format(band)}${unit === '°' ? '°' : unit ? ` ${unit.toUpperCase()}` : ''}` : 'NO NORMAL RANGE YET'}
            </text> : null}
            <line x1={64} x2={580} y1={baseY} y2={baseY} stroke="#fff" strokeOpacity={0.4} strokeDasharray="2 6" />
          </>
        ) : null}
        {markers.map((m, j) => {
          const x = g.X(m.at)
          return (
            <g key={`m${j}`}>
              <line x1={x} x2={x} y1={34 + (j % 3) * 16} y2={250} stroke={LIME} strokeOpacity={0.7} strokeDasharray="3 5" />
              <text x={x > 380 ? x - 6 : x + 6} y={30 + (j % 3) * 16} textAnchor={x > 380 ? 'end' : 'start'} fill={LIME} fontSize={fs(10)} fontFamily={MONO}>
                {m.label}
              </text>
            </g>
          )
        })}
        {g.points.length > 1 ? (
          <path key={g.path} d={g.path} fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={1400} className="animate-[wDraw_1.6s_cubic-bezier(.3,.7,.2,1)_both]" />
        ) : null}
        {g.points.map((p) => {
          const isBase = p.i === baseIndex
          return (
            <g key={`d${p.i}`}>
              <line x1={p.x} x2={p.x} y1={p.y} y2={250} stroke="#fff" strokeOpacity={0.16} />
              {p.i === highlight ? <circle cx={p.x} cy={p.y} r={13} fill="none" stroke="#fff" strokeWidth={1.5} /> : null}
              <circle cx={p.x} cy={p.y} r={(isBase ? 8 : 6.5) * Math.min(k, 1.35)} fill={isBase ? LIME : beyond(p.v) ? EMBER : '#E6E6E6'} stroke="var(--action-selected)" strokeWidth={3} className="animate-[wDotIn_.4s_both]" style={{ animationDelay: `${300 + p.i * 90}ms`, transformBox: 'fill-box', transformOrigin: 'center' }} />
              {pill(p.i) ? (
                <>
                  <rect x={p.x - 30 * k} y={p.y - 16 - 26 * k} width={60 * k} height={26 * k} rx={13 * k} fill="#fff" />
                  <text x={p.x} y={p.y - 16 - 8 * k} textAnchor="middle" fontSize={fs(12)} fontFamily={MONO} fill="var(--text-primary)">
                    {points[p.i].text ?? format(p.v)}
                  </text>
                </>
              ) : null}
            </g>
          )
        })}
        {points.map((p, i) =>
          p.value === null ? (
            <g key={`g${i}`}>
              <circle cx={g.X(i)} cy={baseY} r={6} fill="none" stroke={MUTED} strokeDasharray="2 3" />
              {!many || shownLabels.has(i) ? (
                <text x={g.X(i)} y={baseY + 24} textAnchor="middle" fontSize={fs(10)} fontFamily={MONO} fill={MUTED}>
                  — {p.why ?? 'no reading'}
                </text>
              ) : null}
            </g>
          ) : null,
        )}
        {points.map((p, i) =>
          shownLabels.has(i) ? (
            <text key={`x${i}`} x={g.X(i)} y={270 + 12 * k} textAnchor="middle" fontSize={fs(11)} fontFamily={MONO} fill={i === baseIndex ? LIME : MUTED}>
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Check-in</th>
            <th scope="col">Value{unit ? ` (${unit.trim()})` : ''}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">
                {p.name ?? p.label}
                {i === baseIndex ? ' (baseline)' : ''}
              </th>
              <td>{p.value === null ? `no reading${p.why ? `: ${p.why}` : ''}` : (p.text ?? format(p.value))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
