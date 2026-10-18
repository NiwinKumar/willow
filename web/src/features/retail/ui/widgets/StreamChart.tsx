import { useId } from 'react'

import { SrTable } from './Widget'

/** One day's running totals (everything counted from the start up to the end of that day), one value per band. */
export type StreamDay = { label: string; values: number[] }
export type StreamBand = { id: string; label: string }

/** The design's geometry (Willow Retail, "Users reaching a real change"): five x positions, three tick lines. */
const X = [0, 120, 260, 400, 560]
const FRAC = [0, 0.22, 0.46, 0.71, 1]
const TICK = [1, 2, 3]
const MAX_W = 190
/** Each band's own weight of the one colour, outermost first: a light-to-strong ramp, as the design's three oranges. */
const OPACITY = [0.5, 0.78, 1]

/** The running total at a fractional day (linear between day ends; 0 at the start). */
function at(totals: number[], t: number): number {
  const lo = Math.floor(t)
  const hi = Math.min(totals.length, Math.ceil(t))
  const a = lo === 0 ? 0 : totals[lo - 1]
  const b = hi === 0 ? 0 : totals[hi - 1]
  return a + (b - a) * (t - lo)
}

/** One band: the top edge left to right, then the bottom edge back, each joined by S-curves with level handles (the design's `flow`). */
function band(w: number[], cy: number): string {
  const top = X.map((x, i) => [x, cy - w[i] / 2] as const)
  const bot = X.map((x, i) => [x, cy + w[i] / 2] as const).reverse()
  const seg = (a: readonly (readonly [number, number])[]) =>
    a.map((p, i) => (i === 0 ? `${p[0]},${p[1].toFixed(1)}` : `C${(a[i - 1][0] + p[0]) / 2},${a[i - 1][1].toFixed(1)} ${(a[i - 1][0] + p[0]) / 2},${p[1].toFixed(1)} ${p[0]},${p[1].toFixed(1)}`)).join(' ')
  return `M${seg(top)} L${seg(bot)}Z`
}

/**
 * The stream from the Retail design ("Users reaching a real change"): nested bands that grow from a hairline at the
 * left to the full width at the right, a soft glow under the outer band, and three tick lines with a pill above
 * (the running total of the outer band) and one below (the day). Band width is the running total, so the bands nest
 * exactly as the totals do (clicked and added are parts of shown). The chart bleeds to the card's edges: put it
 * in a container with negative side margins.
 */
export function StreamChart({ days, bands, caption, height = 300 }: { days: StreamDay[]; bands: StreamBand[]; caption: string; /** The drawing's height in its 560-wide box: 300 is the design's, less is a shorter stream for a compact card. */ height?: number }) {
  const id = useId().replace(/:/g, '')
  const H = height
  const cy = H / 2
  const maxW = Math.min(MAX_W, H - 110)
  const lowY = H - 50
  const n = days.length
  const totals = bands.map((_, k) => days.map((d) => d.values[k] ?? 0))
  const peak = Math.max(1, totals[0][n - 1] ?? 0)
  // widths at the five x positions; a band never leaves the one outside it, and a non-zero total is at least a hairline
  const widths = bands.map((_, k) =>
    FRAC.map((f, i) => {
      const v = at(totals[k], f * n)
      return i === 0 ? 3 : v > 0 ? Math.max(3, (v / peak) * maxW) : 0
    }),
  )
  widths.forEach((w, k) => k > 0 && w.forEach((v, i) => (w[i] = Math.min(v, widths[k - 1][i]))))
  const ticks = TICK.map((t) => ({ x: X[t], day: Math.max(1, Math.round(FRAC[t] * n)), shown: Math.round(at(totals[0], FRAC[t] * n)) })).filter((t, i, a) => a.findIndex((u) => u.day === t.day) === i)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <svg viewBox={`0 0 560 ${H}`} role="img" aria-label={caption} className="block h-auto w-full">
        <defs>
          <filter id={`${id}-glow`} x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation={22} />
          </filter>
        </defs>
        <g className="wg-stream-in">
          <path d={band(widths[0], cy)} fill="var(--proof-leaf)" opacity={0.22} filter={`url(#${id}-glow)`} />
          {bands.map((b, k) => (
            <path key={b.id} d={band(widths[k], cy)} fill="var(--proof-leaf)" opacity={OPACITY[k] ?? 1} />
          ))}
        </g>
        {ticks.map((t) => (
          <g key={t.day}>
            <line x1={t.x} x2={t.x} y1={52} y2={lowY} stroke="var(--bg-surface)" strokeWidth={2} />
            <rect x={t.x - 42} y={20} width={84} height={32} rx={16} fill="var(--bg-surface)" stroke="var(--line-strong)" />
            <text x={t.x} y={41} textAnchor="middle" fontSize={13} fill="var(--text-primary)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {t.shown.toLocaleString('en-GB')}
            </text>
            <rect x={t.x - 42} y={lowY} width={84} height={32} rx={16} fill="var(--bg-surface)" stroke="var(--line-strong)" />
            <text x={t.x} y={lowY + 21} textAnchor="middle" fontSize={13} fill="var(--text-primary)">
              Day {t.day}
            </text>
          </g>
        ))}
      </svg>
      <SrTable caption={caption} head={['Day', ...bands.map((b) => b.label)]} rows={days.map((d) => [d.label, ...bands.map((_, k) => totals[k][days.indexOf(d)])])} />
    </div>
  )
}
