import { SrTable } from './Widget'

export type BlobLayer = { id: string; label: string; tone: 'leaf' | 'grey'; /** one value per axis, 0–1 of the peak */ values: number[] }

/** The design's geometry (Willow Retail, "Goal demand by month"): a 520 box, blobs from r 100 outwards, rings at 155 and 210. */
const C = 260
const R0 = 100
const SCALE = 110
const TONE = { leaf: 'var(--proof-leaf)', grey: 'var(--pf-base)' } as const

/** A closed smooth curve through the points (Catmull-Rom at 1/6 tension, as the design's `polar`). */
function blob(vals: number[]): string {
  const n = vals.length
  const pts = vals.map((v, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    const r = R0 + v * SCALE
    return [C + r * Math.cos(a), C + r * Math.sin(a)] as const
  })
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return `${d}Z`
}

/**
 * The radial blob chart from the Retail design ("Goal demand by month"): one axis per category around a hollow
 * centre, each layer a soft closed shape whose distance from the centre is its value, two guide rings (the peak and
 * half of it), the category names around the edge and a dotted number in the middle. Layers overlap with some
 * transparency, so where two agree you see both. Needs three or more axes.
 */
export function BlobRadial({
  axes,
  layers,
  rings,
  centre,
  centreCaption,
  caption,
  format,
  compact = false,
}: {
  axes: string[]
  layers: BlobLayer[]
  /** The labels of the outer ring (the peak) and the inner (half of it). */
  rings: [string, string]
  centre: string
  centreCaption: string
  caption: string
  /** One reading in words for the hidden table (a value 0–1 of the peak → "64%"). */
  format: (v: number) => string
  /** A smaller drawing for a half-width card: the names and labels grow in the drawing so they stay readable. */
  compact?: boolean
}) {
  const n = axes.length
  const k = compact ? 1.45 : 1
  return (
    <div className={`mx-auto w-full ${compact ? 'max-w-[300px]' : 'max-w-[460px]'}`}>
      <svg viewBox={compact ? '-50 -5 620 530' : '0 0 520 520'} role="img" aria-label={caption} className="block h-auto w-full overflow-visible">
        <circle cx={C} cy={C} r={210} fill="none" stroke="var(--text-primary)" strokeOpacity={0.12} />
        <circle cx={C} cy={C} r={155} fill="none" stroke="var(--text-primary)" strokeOpacity={0.12} />
        <g className="wg-stream-in">
          {layers.map((l) => (
            <path key={l.id} d={blob(l.values)} fill={TONE[l.tone]} fillOpacity={0.4} stroke={TONE[l.tone]} strokeOpacity={0.9} strokeWidth={1.5} />
          ))}
        </g>
        <circle cx={C} cy={C} r={92} fill="var(--bg-surface)" />
        <text x={266} y={56} fontSize={11 * k} fill="var(--text-secondary)">
          {rings[0]}
        </text>
        <text x={266} y={110} fontSize={11 * k} fill="var(--text-secondary)">
          {rings[1]}
        </text>
        {axes.map((a, i) => {
          const t = -Math.PI / 2 + (i / n) * Math.PI * 2
          return (
            <text key={a} x={(C + 240 * Math.cos(t)).toFixed(0)} y={(265 + 240 * Math.sin(t)).toFixed(0)} textAnchor="middle" fontSize={14 * k} fill="var(--text-primary)">
              {a}
            </text>
          )
        })}
        <text x={C} y={254} textAnchor="middle" fontSize={40} fontWeight={800} fill="var(--text-primary)" style={{ fontFamily: 'var(--font-dot)', fontVariationSettings: "'ROND' 100" }}>
          {centre}
        </text>
        <text x={C} y={282} textAnchor="middle" fontSize={13 * (compact ? 1.2 : 1)} fill="var(--text-secondary)">
          {centreCaption}
        </text>
      </svg>
      <SrTable caption={caption} head={['Group', ...layers.map((l) => l.label)]} rows={axes.map((a, i) => [a, ...layers.map((l) => format(l.values[i]))])} />
    </div>
  )
}
