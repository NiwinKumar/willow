import { smoothPath } from './chartMath'

/**
 * A small readable trend: one metric over time (x is real time), the person's baseline as a dashed line,
 * their normal range around it as a soft band, the first reading as a ring and the latest as a dot. A line
 * that leaves the band has moved beyond normal variation. Whoever uses it explains the dashed line and the
 * band once (a legend), so the chart carries no text. Decorative unless `label` is given.
 */
export function TrendChart({ points, baseline, band, width = 190, height = 56, stroke = 'currentColor', label }: {
  points: { t: number; v: number }[]
  baseline: number | null
  band: number | null
  width?: number
  height?: number
  stroke?: string
  label?: string
}) {
  if (points.length < 2) return null
  const plotW = width
  const vals = [...points.map((p) => p.v), ...(baseline !== null ? [baseline - (band ?? 0), baseline + (band ?? 0)] : [])]
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || 1
  const padY = 6
  const Y = (v: number) => height - padY - ((v - lo) / span) * (height - padY * 2)
  const t0 = points[0].t
  const tSpan = points[points.length - 1].t - t0 || 1
  const X = (t: number) => 5 + ((t - t0) / tSpan) * (plotW - 10)
  const pts = points.map((p) => ({ x: X(p.t), y: Y(p.v) }))
  const first = pts[0]
  const last = pts[pts.length - 1]
  const by = baseline !== null ? Y(baseline) : null
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="block overflow-visible">
      {by !== null && band !== null && band > 0 ? <rect x={0} y={Y(baseline! + band)} width={plotW} height={Math.max(3, Y(baseline! - band) - Y(baseline! + band))} rx={4} fill="currentColor" opacity={0.14} /> : null}
      {by !== null ? <line x1={0} x2={plotW} y1={by} y2={by} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.25} strokeDasharray="4 3" /> : null}
      <path d={smoothPath(pts)} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={first.x} cy={first.y} r={3} fill="var(--surface, #fff)" stroke={stroke} strokeWidth={1.75} />
      <circle cx={last.x} cy={last.y} r={4} fill={stroke} />
    </svg>
  )
}
