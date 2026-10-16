import { useLayoutEffect, useRef, useState } from 'react'

import { pct } from './format'

export type CurveSeries = {
  id: string
  /** Direct label at the line's end ("Users", "Non-users"). */
  label: string
  values: (number | null)[]
  /** signal = ember (a real-change share); muted = grey dashed (the comparison). One accent per chart. */
  tone: 'signal' | 'muted'
  /** The group size, shown in the label ("Users · n=212"). */
  n?: number | null
}

/**
 * Cumulative share by week (e.g. share of a product's users whose lasting change had begun by week k), as
 * step lines, with direct labels, a % y axis, a week x axis and a visually hidden data table. Null weeks break
 * the line. Width follows the container; height is fixed so the layout never shifts.
 */
export function CurveChart({ weeks, series, height = 200, title }: { weeks: number[]; series: CurveSeries[]; height?: number; title: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(560)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const pad = { l: 36, r: 108, t: 10, b: 26 }
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const peak = Math.max(0.1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)))
  const top = Math.min(1, Math.ceil(peak * 10 + 0.5) / 10)
  // x is proportional to the week number, so uneven weeks (2, 4, 8) keep their real spacing.
  const w0 = weeks[0] ?? 0
  const span = Math.max(1, (weeks.at(-1) ?? 1) - w0)
  const x = (i: number) => pad.l + (weeks.length <= 1 ? 0 : ((weeks[i] - w0) / span) * iw)
  const y = (v: number) => pad.t + ih - (v / top) * ih
  const grid = [0, top / 2, top]

  const pathOf = (vals: (number | null)[]) => {
    let d = ''
    let open = false
    vals.forEach((v, i) => {
      if (v === null) {
        open = false
        return
      }
      if (!open) {
        d += `M${x(i)},${y(v)}`
        open = true
      } else d += `H${x(i)}V${y(v)}`
    })
    return d
  }
  // Direct labels at the last value, pushed apart when they would overlap.
  const ends = series
    .map((s) => {
      const i = s.values.map((v, j) => (v === null ? -1 : j)).filter((j) => j >= 0).pop()
      return i === undefined ? null : { s, i, ly: y(s.values[i]!) }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.ly - b.ly)
  for (let k = 1; k < ends.length; k++) ends[k].ly = Math.max(ends[k].ly, ends[k - 1].ly + 26)

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div ref={box} className="w-full">
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden className="block overflow-visible">
          {grid.map((g) => (
            <g key={g}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(g)} y2={y(g)} stroke="var(--line-subtle)" />
              <text x={pad.l - 8} y={y(g) + 4} textAnchor="end" fontSize={11} fontFamily="var(--font-mono)" fill="var(--text-secondary)">
                {pct(g)}
              </text>
            </g>
          ))}
          <line x1={pad.l} x2={pad.l + iw} y1={pad.t + ih} y2={pad.t + ih} stroke="var(--line-strong)" />
          {weeks.map((wk, i) => (
            <text key={wk} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--text-secondary)">
              {i === 0 ? `WK ${wk}` : wk}
            </text>
          ))}
          {series.map((s) => (
            <path
              key={s.id}
              d={pathOf(s.values)}
              fill="none"
              stroke={s.tone === 'signal' ? 'var(--signal-change)' : 'var(--text-secondary)'}
              strokeWidth={s.tone === 'signal' ? 2 : 1.5}
              strokeDasharray={s.tone === 'muted' ? '4 3' : undefined}
              strokeLinejoin="round"
            />
          ))}
          {ends.map(({ s, i, ly }) => (
            <g key={s.id}>
              <circle cx={x(i)} cy={y(s.values[i]!)} r={3.5} fill={s.tone === 'signal' ? 'var(--signal-change)' : 'var(--text-secondary)'} stroke="var(--bg-surface)" strokeWidth={1.5} />
              <text x={x(i) + 10} y={ly + 4} fontSize={12} fill="var(--text-primary)">
                {s.label} <tspan fontFamily="var(--font-mono)">{pct(s.values[i])}</tspan>
              </text>
              {s.n ? (
                <text x={x(i) + 10} y={ly + 17} fontSize={10.5} fontFamily="var(--font-mono)" fill="var(--text-secondary)">
                  n={s.n}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            {series.map((s) => (
              <th key={s.id} scope="col">
                {s.label}
                {s.n ? ` (n=${s.n})` : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((wk, i) => (
            <tr key={wk}>
              <th scope="row">Week {wk}</th>
              {series.map((s) => (
                <td key={s.id}>{s.values[i] === null ? 'Fewer than 10 people' : pct(s.values[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
