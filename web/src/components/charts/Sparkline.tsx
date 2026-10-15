import { smoothPath, spread } from './chartMath'

/**
 * A small trend line (cards, lists). Gaps are bridged; the last reading gets a dot. Decorative unless
 * `label` is given, which becomes its accessible name.
 */
export function Sparkline({ values, width = 120, height = 36, stroke = 'currentColor', label }: { values: (number | null)[]; width?: number; height?: number; stroke?: string; label?: string }) {
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (!real.length) return null
  const lo = Math.min(...real)
  const hi = Math.max(...real)
  const span = hi - lo || 1
  const X = spread(values.length, 3, width - 3)
  const Y = (v: number) => height - 3 - ((v - lo) / span) * (height - 6)
  const pts = values.flatMap((v, i) => (v === null || !Number.isFinite(v) ? [] : [{ x: X(i), y: Y(v) }]))
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="block overflow-visible">
      {pts.length > 1 ? <path d={smoothPath(pts)} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" /> : null}
      <circle cx={last.x} cy={last.y} r={3} fill={stroke} />
    </svg>
  )
}
