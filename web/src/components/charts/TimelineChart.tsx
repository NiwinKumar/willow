import { useId } from 'react'

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
  /** One sentence for screen readers. */
  summary: string
  /** Caption of the hidden table. */
  caption: string
}) {
  const id = useId().replace(/:/g, '')
  const values = points.map((p) => p.value)
  const g = timelineGeometry(values, baseIndex, band)
  const base = g.base
  const hasBand = band !== null && base !== null
  const baseY = base !== null ? g.Y(base) : g.Y((g.min + g.max) / 2)
  const many = points.length > 7
  const shownLabels = labelIndices(points.length, 7, [baseIndex, highlight])
  // Value pills crowd past 7 points: then only the baseline, the current one and the last carry one.
  const pill = (i: number) => !many || i === baseIndex || i === highlight || i === points.length - 1
  return (
    <figure className="m-0">
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
            <text x={56} y={g.Y(t) + 4} textAnchor="end" fill={MUTED} fontSize={11} fontFamily={MONO}>
              {format(t)}
            </text>
          </g>
        ))}
        {unit ? (
          <text x={56} y={22} textAnchor="end" fill={MUTED} fontSize={11} fontFamily={MONO}>
            {unit}
          </text>
        ) : null}
        {hasBand ? (
          <rect x={64} y={g.Y(base + band)} width={516} height={g.Y(base - band) - g.Y(base + band)} rx={12} fill={`url(#${id}g)`} opacity={glow ? 0.55 : 0.35} filter={glow ? `url(#${id}b)` : undefined} />
        ) : null}
        {base !== null ? (
          <>
            <text x={578} y={hasBand ? g.Y(base - band) + 16 : baseY + 20} textAnchor="end" fill={hasBand ? 'var(--aura-lilac)' : 'var(--action-primary)'} fontSize={10} fontFamily={MONO} letterSpacing=".04em">
              {hasBand ? `NORMAL RANGE ±${bandValue ?? format(band)}${unit === '°' ? '°' : unit ? ` ${unit.toUpperCase()}` : ''}` : 'NO NORMAL RANGE YET'}
            </text>
            <line x1={64} x2={580} y1={baseY} y2={baseY} stroke="#fff" strokeOpacity={0.4} strokeDasharray="2 6" />
          </>
        ) : null}
        {markers.map((m, k) => {
          const x = g.X(m.at)
          return (
            <g key={`m${k}`}>
              <line x1={x} x2={x} y1={34 + (k % 3) * 16} y2={250} stroke={LIME} strokeOpacity={0.7} strokeDasharray="3 5" />
              <text x={x > 380 ? x - 6 : x + 6} y={30 + (k % 3) * 16} textAnchor={x > 380 ? 'end' : 'start'} fill={LIME} fontSize={10} fontFamily={MONO}>
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
              <circle cx={p.x} cy={p.y} r={isBase ? 8 : 6.5} fill={isBase ? LIME : '#E6E6E6'} stroke="var(--action-selected)" strokeWidth={3} />
              {pill(p.i) ? (
                <>
                  <rect x={p.x - 30} y={p.y - 42} width={60} height={26} rx={13} fill="#fff" />
                  <text x={p.x} y={p.y - 24} textAnchor="middle" fontSize={12} fontFamily={MONO} fill="var(--text-primary)">
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
                <text x={g.X(i)} y={baseY + 24} textAnchor="middle" fontSize={10} fontFamily={MONO} fill={MUTED}>
                  — {p.why ?? 'no reading'}
                </text>
              ) : null}
            </g>
          ) : null,
        )}
        {points.map((p, i) =>
          shownLabels.has(i) ? (
            <text key={`x${i}`} x={g.X(i)} y={282} textAnchor="middle" fontSize={11} fontFamily={MONO} fill={i === baseIndex ? LIME : MUTED}>
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
