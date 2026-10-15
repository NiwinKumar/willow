import { clamp } from '../../lib/format'

/**
 * Chart geometry ported from the design ("Willow App", chart()/armSvg()), generalised: any number of
 * points, missing values (gaps), one point, no baseline, no band. Pure functions, no React.
 */

export type XY = { x: number; y: number }

/**
 * Smooth line through points with horizontal tangents at every point (the design's cubic): it never
 * overshoots a value vertically, so a dip on the line is always a real dip in the data.
 */
export function smoothPath(pts: XY[]): string {
  return pts
    .map((p, k) => {
      if (!k) return `M${r(p.x)},${r(p.y)}`
      const q = pts[k - 1]
      const cx = r((q.x + p.x) / 2)
      return `C${cx},${r(q.y)} ${cx},${r(p.y)} ${r(p.x)},${r(p.y)}`
    })
    .join(' ')
}

const r = (n: number) => Math.round(n * 100) / 100

/** x positions spread evenly between `from` and `to`; a single point sits in the middle. */
export function spread(n: number, from: number, to: number): (i: number) => number {
  if (n <= 1) return () => (from + to) / 2
  return (i) => from + (i * (to - from)) / (n - 1)
}

export type TimelineGeometry = {
  X: (i: number) => number
  Y: (v: number) => number
  min: number
  max: number
  /** Data min, middle, data max (the design's three gridlines). */
  ticks: number[]
  path: string
  points: (XY & { i: number; v: number })[]
  base: number | null
}

/**
 * The history / metric-detail chart (viewBox 600×300): x 100..540, y 240 (low) .. 70 (high). The domain
 * holds every value and, with a band, 1.6 bands either side of the baseline; then 15% padding.
 */
export function timelineGeometry(values: (number | null)[], baseIndex: number | null, band: number | null): TimelineGeometry {
  const n = values.length
  const base = baseIndex !== null && baseIndex >= 0 ? (values[baseIndex] ?? null) : null
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v))
  const ext = [...real, ...(band !== null && base !== null ? [base - band * 1.6, base + band * 1.6] : [])]
  let min = ext.length ? Math.min(...ext) : 0
  let max = ext.length ? Math.max(...ext) : 1
  if (max - min < 1e-6) {
    min -= 1
    max += 1
  }
  const pad = (max - min) * 0.15
  const ticks = [min, (min + max) / 2, max]
  min -= pad
  max += pad
  const X = spread(n, 100, 540)
  const Y = (v: number) => 240 - ((v - min) / (max - min)) * 170
  const points = values.flatMap((v, i) => (v === null || !Number.isFinite(v) ? [] : [{ x: X(i), y: Y(v), i, v }]))
  return { X, Y, min, max, ticks, path: smoothPath(points), points, base }
}

/** Indices whose x label is drawn: at most `max`, always the first, the last and any `keep` (baseline, current). */
export function labelIndices(n: number, max: number, keep: (number | null | undefined)[] = []): Set<number> {
  const out = new Set<number>()
  if (n <= max) {
    for (let i = 0; i < n; i++) out.add(i)
    return out
  }
  const step = Math.ceil((n - 1) / (max - 1))
  for (let i = 0; i < n; i += step) out.add(i)
  out.add(n - 1)
  for (const k of keep) if (k !== null && k !== undefined && k >= 0 && k < n) out.add(k)
  // A kept label too close to a spaced one wins; drop its neighbour so labels never collide.
  const sorted = [...out].sort((a, b) => a - b)
  const minGap = Math.max(1, Math.floor(step / 2))
  for (let k = 1; k < sorted.length; k++) {
    const a = sorted[k - 1]
    const b = sorted[k]
    if (b - a < minGap) {
      const drop = keep.includes(b) || b === n - 1 ? a : b
      if (drop !== 0 && drop !== n - 1 && !keep.includes(drop)) out.delete(drop)
    }
  }
  return out
}

/**
 * Where a date falls on an index axis (routine markers between sessions): a fractional index between the
 * two sessions around it, or null outside the series.
 */
export function fractionalIndex(dates: number[], t: number): number | null {
  if (dates.length < 2 || t < dates[0] || t > dates[dates.length - 1]) return null
  for (let i = 1; i < dates.length; i++) {
    if (t <= dates[i]) {
      const span = dates[i] - dates[i - 1]
      return span <= 0 ? i : i - 1 + (t - dates[i - 1]) / span
    }
  }
  return null
}

export type ArmGeometry = {
  X: (i: number) => number
  Y: (v: number) => number
  ticks: number[]
  lines: { path: string; last: (XY & { v: number }) | null }[]
}

/**
 * The forearm chart (viewBox 600×260): whole-unit domain with one unit of room (floor/ceil ± 1),
 * x from 80 to 530, y 220 (low) .. 40 (high).
 */
export function armGeometry(series: (number | null)[][]): ArmGeometry {
  const all = series.flat().filter((v): v is number => v !== null && Number.isFinite(v))
  const amin = all.length ? Math.floor(Math.min(...all)) - 1 : 0
  const amax = all.length ? Math.ceil(Math.max(...all)) + 1 : 2
  const n = Math.max(1, ...series.map((s) => s.length))
  const X = spread(n, 80, 530)
  const Y = (v: number) => 220 - ((v - amin) / (amax - amin || 1)) * 180
  const lines = series.map((s) => {
    const pts = s.flatMap((v, i) => (v === null ? [] : [{ x: X(i), y: Y(v), v }]))
    return { path: smoothPath(pts), last: pts[pts.length - 1] ?? null }
  })
  return { X, Y, ticks: [amin + 1, (amin + amax) / 2, amax - 1], lines }
}

/** Marker position (percent) for a change of `ratio` normal ranges: the band edge is ±15%, kept inside 6..94. */
export function bandPosition(ratio: number | null): number {
  return ratio === null || !Number.isFinite(ratio) ? 50 : clamp(50 + ratio * 15, 6, 94)
}
