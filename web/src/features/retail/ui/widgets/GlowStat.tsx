import { useId, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import { nearest, smooth, stepKey, useWidth, type XY } from './math'
import { SrTable, Widget, type WidgetMenu } from './Widget'

export type GlowPoint = { x: number; y: number; label: string }
export type GlowChip = { text: string; tone: 'up' | 'down' | 'flat' }

const CHIP = {
  up: { bg: 'var(--bg-surface)', fg: 'var(--proof-leaf)', edge: 'var(--proof-leaf-line)' },
  down: { bg: 'var(--bg-surface)', fg: 'var(--pf-red)', edge: 'var(--pf-red)' },
  flat: { bg: 'var(--bg-surface)', fg: 'var(--text-primary)', edge: 'var(--line-strong)' },
} as const

const H = 128
const PAD = { l: 8, r: 36, t: 44 }

/**
 * The hero number with the series drawn as one smooth line. Move over the line (or use
 * the arrow keys) and the marker follows: the line stays bright up to it and dims after, and the chip says what
 * that reading is. Without a pick the marker rests on the latest reading.
 */
export function GlowStat({
  title,
  value,
  unit,
  lead,
  sub,
  points,
  chipOf,
  ariaLabel,
  menu,
}: {
  title: string
  value: string
  unit?: string
  /** Bold lead of the line under the number ("+47 pts"). */
  lead?: ReactNode
  sub?: ReactNode
  points: GlowPoint[]
  chipOf: (i: number) => GlowChip
  ariaLabel: string
  menu?: WidgetMenu
}) {
  const [box, w] = useWidth<HTMLDivElement>(200, 360)
  const gid = useId().replace(/:/g, '')
  const [pick, setPick] = useState<number | null>(null)
  const n = points.length
  const i = pick ?? n - 1
  const iw = w - PAD.l - PAD.r
  const top = Math.max(0.05, ...points.map((p) => p.y)) * 1.06
  const x0 = points[0]?.x ?? 0
  const span = Math.max(1e-6, (points.at(-1)?.x ?? 1) - x0)
  const px = (p: GlowPoint) => PAD.l + ((p.x - x0) / span) * iw
  const py = (p: GlowPoint) => H - (p.y / top) * (H - PAD.t - 8)
  const xy: XY[] = points.map((p) => [px(p), py(p)])
  const d = smooth(xy)
  const mx = xy[i]?.[0] ?? 0
  const my = xy[i]?.[1] ?? H
  const chip = n ? chipOf(i) : null
  const cw = chip ? Math.max(58, chip.text.length * 6.9 + 18) : 0
  const cx = Math.min(Math.max(mx, cw / 2 + 2), w - cw / 2 - 2)

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setPick(nearest(xy.map((q) => q[0]), e.clientX - r.left))
  }
  const key = (e: KeyboardEvent) => {
    const next = stepKey(e.key, i, n)
    if (next === null) return
    e.preventDefault()
    setPick(next)
  }

  return (
    <Widget title={title} label={ariaLabel} menu={menu} className="wg-glow">
      <div className="wg-glow-body">
        <div className="wg-glow-copy">
          <p className="wg-big m-0 text-[clamp(44px,13cqw,60px)]">
            {value}
            {unit ? <span className="wg-unit ml-1 text-[0.42em]">{unit}</span> : null}
          </p>
          {lead || sub ? (
            <p className="wg-glow-sub">
              {lead ? <b>{lead}</b> : null} {sub}
            </p>
          ) : null}
        </div>
        <div ref={box} className="wg-glow-chart">
          {n > 1 ? (
            <div role="group" tabIndex={0} aria-label={`${title}. Use the left and right arrow keys to read each point.`} onKeyDown={key} onBlur={() => setPick(null)} className="rounded-[20px]">
              <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} onPointerMove={move} onPointerLeave={() => setPick(null)} aria-hidden>
                <defs>
                  <clipPath id={`l-${gid}`}>
                    <rect x={-40} y={-40} width={mx + 40} height={H + 80} />
                  </clipPath>
                  <clipPath id={`r-${gid}`}>
                    <rect x={mx} y={-40} width={w - mx + 40} height={H + 80} />
                  </clipPath>
                  <linearGradient id={`a-${gid}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" style={{ stopColor: 'var(--proof-leaf)' }} stopOpacity={0.22} />
                    <stop offset="1" style={{ stopColor: 'var(--proof-leaf)' }} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={d} fill="none" style={{ stroke: 'var(--line-strong)' }} strokeWidth={2.4} strokeLinecap="round" clipPath={`url(#r-${gid})`} />
                <g clipPath={`url(#l-${gid})`}>
                  <path d={`${d}L${xy.at(-1)![0]},${H}L${xy[0][0]},${H}Z`} fill={`url(#a-${gid})`} />
                  <path d={d} pathLength={1} fill="none" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--proof-leaf)', strokeDasharray: 1, animation: 'wgDraw 1.1s cubic-bezier(.2,.7,.2,1) both' }} />
                </g>
                <line x1={mx} x2={mx} y1={my + 9} y2={H} style={{ stroke: 'var(--line-strong)' }} strokeDasharray="3 4" />
                <circle cx={mx} cy={my} r={11} style={{ fill: 'var(--proof-leaf-soft)' }} />
                <circle cx={mx} cy={my} r={5.5} strokeWidth={2.5} style={{ fill: 'var(--bg-surface)', stroke: 'var(--proof-leaf)' }} />
                {chip ? (
                  <g transform={`translate(${cx - cw / 2},${my - 40})`} style={{ transition: 'transform .16s ease' }}>
                    <path d={`M${Math.min(Math.max(mx - (cx - cw / 2), 12), cw - 12) - 5},27 l5,6 l5,-6`} style={{ fill: CHIP[chip.tone].bg, stroke: CHIP[chip.tone].edge }} />
                    <rect width={cw} height={28} rx={6} style={{ fill: CHIP[chip.tone].bg, stroke: CHIP[chip.tone].edge }} />
                    <text x={cw / 2} y={18.5} textAnchor="middle" fontSize={12.5} fontWeight={600} style={{ fill: CHIP[chip.tone].fg }}>
                      {chip.text}
                    </text>
                  </g>
                ) : null}
                <rect x={0} y={0} width={w} height={H} fill="transparent" />
              </svg>
              <p aria-live="polite" className="wg-sr">
                {points[i].label}: {chip?.text}
              </p>
            </div>
          ) : null}
        </div>
      </div>
      <SrTable caption={title} head={['Reading', 'Value']} rows={points.map((p, k) => [p.label, chipOf(k).text])} />
    </Widget>
  )
}
