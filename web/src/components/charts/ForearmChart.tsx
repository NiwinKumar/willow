import { useId } from 'react'

import { armGeometry, labelIndices } from './chartMath'

export type ArmSeries = {
  name: string
  /** One value per x label; null where there is no reading (drawn as a gap with `gapText`). */
  values: (number | null)[]
  color: string
  gapText?: string
}

const MONO = 'var(--font-mono)'
const MUTED = 'var(--text-disabled)'

/**
 * Two (or more) thick glowing lines on black, as the design's treated-vs-control chart: whole-unit
 * gridlines, an end dot and end value per line, and a dashed ring where a line has no reading.
 */
export function ForearmChart({ series, labels, format, unit = '', summary, caption }: { series: ArmSeries[]; labels: string[]; format: (v: number) => string; unit?: string; summary: string; caption: string }) {
  const id = useId().replace(/:/g, '')
  const g = armGeometry(series.map((s) => s.values))
  const shown = labelIndices(labels.length, 6)
  return (
    <figure className="m-0">
      <svg viewBox="0 0 600 260" aria-hidden className="block h-auto w-full overflow-visible">
        <defs>
          <filter id={`${id}glow`} x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur stdDeviation={6} />
          </filter>
        </defs>
        {g.ticks.map((t, i) => (
          <g key={`t${i}`}>
            <line x1={60} x2={580} y1={g.Y(t)} y2={g.Y(t)} stroke="#fff" strokeOpacity={0.08} />
            <text x={52} y={g.Y(t) + 4} textAnchor="end" fill={MUTED} fontSize={11} fontFamily={MONO}>
              {Number.isInteger(t) ? t.toFixed(0) : t.toFixed(1)}
              {unit}
            </text>
          </g>
        ))}
        {series.map((s, k) => {
          const line = g.lines[k]
          return (
            <g key={s.name}>
              {line.path ? (
                <>
                  <path d={line.path} fill="none" stroke={s.color} strokeWidth={12} strokeLinecap="round" opacity={0.45} filter={`url(#${id}glow)`} />
                  <path d={line.path} fill="none" stroke={s.color} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={1400} className="animate-[wDraw_1.8s_cubic-bezier(.3,.7,.2,1)_both]" />
                </>
              ) : null}
              {line.last ? (
                <>
                  <circle cx={line.last.x} cy={line.last.y} r={8} fill="#fff" />
                  <text x={Math.min(line.last.x + 14, 540)} y={line.last.y + 4 + (k ? 14 : -10) * (series.length > 1 ? 1 : 0)} fill={s.color} fontSize={12} fontFamily={MONO}>
                    {format(line.last.v)}
                    {unit}
                  </text>
                </>
              ) : null}
              {s.values.map((v, i) => {
                if (v !== null) return null
                // The gap sits at the line's previous value (or its next one at the start).
                const near = s.values.slice(0, i).reverse().find((x) => x !== null) ?? s.values.slice(i + 1).find((x) => x !== null) ?? null
                const y = near !== null ? g.Y(near) : 130
                return (
                  <g key={`g${i}`}>
                    <circle cx={g.X(i)} cy={y} r={8} fill="none" stroke={MUTED} strokeDasharray="2 3" />
                    <text x={g.X(i)} y={y - 16} textAnchor="middle" fill={MUTED} fontSize={11} fontFamily={MONO}>
                      — {s.gapText ?? 'no reading'}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
        {labels.map((l, i) =>
          shown.has(i) ? (
            <text key={`x${i}`} x={g.X(i)} y={252} textAnchor="middle" fill={MUTED} fontSize={11} fontFamily={MONO}>
              {l}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={i}>
              <th scope="row">{l}</th>
              {series.map((s) => (
                <td key={s.name}>{s.values[i] === null || s.values[i] === undefined ? 'no reading' : `${format(s.values[i]!)}${unit}`}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
