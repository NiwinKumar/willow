import { useState, type CSSProperties } from 'react'

import { SrTable, Widget, type WidgetMenu } from './Widget'

export type Ring = { id: string; label: string; value: number; display: string; detail: string; color: string }

const GAP = 7
const THICK = 15

/**
 * Concentric rounded arcs, one per group, the outer ring first. `sweep` is the full length of a
 * ring in degrees (180 = a half circle, 300 = a near-full dial); each arc covers its value's share of it. Hover
 * or focus a legend row (or an arc) to bring that ring forward.
 */
export function RingStack({
  title,
  rings,
  sweep = 180,
  center,
  caption,
  ariaLabel,
  menu,
}: {
  title: string
  rings: Ring[]
  sweep?: number
  center?: { value: string; label: string }
  caption?: string
  ariaLabel: string
  menu?: WidgetMenu
}) {
  const [pick, setPick] = useState<string | null>(null)
  const R0 = 118
  const semi = sweep <= 180
  // Degrees clockwise from 3 o'clock; a partial dial opens at the bottom, so it is centred on 12 o'clock.
  const start = 180 + (180 - sweep) / 2
  const rad = (deg: number) => (deg * Math.PI) / 180
  const cx = 150
  const cy = semi ? 140 : 150
  const arc = (r: number, from: number, to: number) => {
    const a0 = rad(from)
    const a1 = rad(to)
    const large = to - from > 180 ? 1 : 0
    return `M${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}`
  }
  const vb = semi ? '0 0 300 164' : '0 0 300 300'
  return (
    <Widget title={title} label={ariaLabel} menu={menu} className="wg-rings">
      <div className="wg-rings-plot">
        <svg viewBox={vb} role="img" aria-label={`${title}: ${rings.map((r) => `${r.label} ${r.display}`).join(', ')}`}>
          {rings.map((r, i) => {
            const rr = R0 - i * (THICK + GAP)
            const end = start + sweep * Math.max(0.004, Math.min(1, r.value))
            const dim = pick !== null && pick !== r.id
            return (
              <g key={r.id} className="wg-ring-arc" style={{ opacity: dim ? 0.3 : 1, '--i': i } as CSSProperties} onPointerEnter={() => setPick(r.id)} onPointerLeave={() => setPick(null)}>
                <path d={arc(rr, start, start + sweep)} fill="none" stroke="var(--bg-sunken)" strokeWidth={THICK} strokeLinecap="round" />
                <path className="v" d={arc(rr, start, end)} pathLength={1} fill="none" stroke={r.color} strokeWidth={THICK} strokeLinecap="round" style={{ strokeDasharray: 1 }} />
              </g>
            )
          })}
          {center ? (
            <>
              <text x={cx} y={semi ? cy - 18 : cy + 4} textAnchor="middle" fontSize={40} fontWeight={500} letterSpacing={-1.5} fill="var(--text-primary)">
                {center.value}
              </text>
              <text x={cx} y={semi ? cy + 2 : cy + 26} textAnchor="middle" fontSize={11.5} fill="var(--text-secondary)">
                {center.label}
              </text>
            </>
          ) : null}
        </svg>
      </div>
      <ul className="m-0 flex list-none flex-col p-0" onPointerLeave={() => setPick(null)}>
        {rings.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onPointerEnter={() => setPick(r.id)}
              onFocus={() => setPick(r.id)}
              onBlur={() => setPick(null)}
              className="grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border-0 bg-transparent px-1 py-[5px] text-left text-[13px] text-[var(--wg-fg)] transition-opacity"
              style={{ opacity: pick !== null && pick !== r.id ? 0.4 : 1 }}
            >
              <i aria-hidden className="size-2.5 rounded-full" style={{ background: r.color }} />
              <span className="truncate">
                {r.label} <span className="text-[var(--wg-fg2)]">{r.detail}</span>
              </span>
              <b className="font-medium">{r.display}</b>
            </button>
          </li>
        ))}
      </ul>
      {caption ? <p className="wg-cap m-0">{caption}</p> : null}
      <SrTable caption={title} head={['Group', 'Value', 'Detail']} rows={rings.map((r) => [r.label, r.display, r.detail])} />
    </Widget>
  )
}
