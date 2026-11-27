import { useId } from 'react'

/*
 * Small inline data marks for KPI tiles and rows (Home, and for P2B where a figure wants its trend):
 * `Sparkline` (a series as a line over a soft area, the last point marked), `ProofRing` (a share as a ring, leaf
 * on a hairline track) and `Meter` (a share as a thin bar). Each draws in once (stroke or scale, 600 ms, the
 * kit's standard ease; still under reduced motion), carries a plain-words aria-label, and takes the numbers it
 * draws as props. Colour: `tone="leaf"` for the viewer's own / proven, `"ink"` for neutral, `"base"` for the rest.
 */

const STROKE = { leaf: 'var(--proof-leaf)', ink: 'var(--text-secondary)', base: 'var(--pf-base)' } as const
type Tone = keyof typeof STROKE

/** A null value is a gap (a suppressed month), never a zero. */
export function Sparkline({ values, label, width = 96, height = 28, tone = 'ink', area = true, className = '' }: { values: (number | null)[]; label: string; width?: number; height?: number; tone?: Tone; area?: boolean; className?: string }) {
  const gid = useId().replace(/:/g, '')
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length < 2) return null
  const max = Math.max(...nums)
  const min = Math.min(0, ...nums)
  const span = max - min || 1
  const pad = 2.5
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2)
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2)
  // Runs of non-null points (a suppressed month breaks the line).
  const runs: [number, number][][] = []
  let cur: [number, number][] = []
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) runs.push(cur)
      cur = []
    } else cur.push([x(i), y(v)])
  })
  if (cur.length) runs.push(cur)
  const lastI = values.findLastIndex((v) => v !== null)
  const last = values[lastI] as number
  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`block shrink-0 overflow-visible ${className}`}>
      <defs>
        <linearGradient id={`sg${gid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={STROKE[tone]} stopOpacity={0.18} />
          <stop offset="100%" stopColor={STROKE[tone]} stopOpacity={0} />
        </linearGradient>
      </defs>
      {runs.map((r, i) => {
        const d = r.map(([px, py], j) => `${j ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
        return (
          <g key={i}>
            {area && r.length > 1 ? <path d={`${d}L${r.at(-1)![0].toFixed(1)},${height}L${r[0][0].toFixed(1)},${height}Z`} fill={`url(#sg${gid})`} className="animate-[wFadeIn_.6s_ease_both]" /> : null}
            <path d={d} fill="none" stroke={STROKE[tone]} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="proof-draw" />
          </g>
        )
      })}
      <circle cx={x(lastI)} cy={y(last)} r={2.25} fill={STROKE[tone]} className="animate-[wFadeIn_.3s_.45s_ease_both]" />
    </svg>
  )
}

/** A share (0-1) as a ring with its figure in the middle; `of` reads as "of 12" under it when there is room. */
export function ProofRing({ value, size = 44, label, center }: { value: number | null; size?: number; label: string; center?: string }) {
  const r = size / 2 - 3
  const c = 2 * Math.PI * r
  const v = value === null ? 0 : Math.max(0, Math.min(1, value))
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth={4} />
        {v > 0 ? <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--proof-leaf)" strokeWidth={4} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} className="proof-ring" style={{ ['--c' as string]: c }} /> : null}
      </svg>
      {center ? <span aria-hidden className="absolute text-[11px] font-semibold text-ink tnum">{center}</span> : null}
    </span>
  )
}

/** A share (0-1) as a thin bar on a hairline track. */
export function Meter({ value, tone = 'leaf', label, className = '' }: { value: number | null; tone?: Tone; label: string; className?: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(1, value))
  return (
    <span role="img" aria-label={label} className={`block h-1.5 overflow-hidden rounded-pill bg-sunken ${className}`}>
      <span className="block h-full origin-left rounded-pill animate-[wGrowX_.6s_var(--ease-standard)_both]" style={{ width: `${v * 100}%`, background: STROKE[tone] }} />
    </span>
  )
}
