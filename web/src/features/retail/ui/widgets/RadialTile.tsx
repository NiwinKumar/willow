import type { ReactNode } from 'react'

import { Widget, type WidgetMenu } from './Widget'

const R = 70
const SWEEP = 270

/** A tile with one share as an open ring and the figure inside; `foot` says what it is a share of. */
export function RadialTile({ title, value, share, foot, ariaLabel, menu }: { title: string; value: string; share: number; foot: ReactNode; ariaLabel: string; menu?: WidgetMenu }) {
  const rad = (d: number) => (d * Math.PI) / 180
  const start = 135
  const arc = (to: number) => {
    const a0 = rad(start)
    const a1 = rad(to)
    return `M${100 + R * Math.cos(a0)},${100 + R * Math.sin(a0)}A${R},${R} 0 ${to - start > 180 ? 1 : 0} 1 ${100 + R * Math.cos(a1)},${100 + R * Math.sin(a1)}`
  }
  const end = start + SWEEP * Math.max(0.004, Math.min(1, share))
  return (
    <Widget title={title} label={ariaLabel} menu={menu} className="wg-radial">
      <div className="wg-radial-plot">
        <svg viewBox="0 0 200 200" role="img" aria-label={`${title}: ${value}`}>
          <path d={arc(start + SWEEP)} fill="none" stroke="var(--bg-sunken)" strokeWidth={14} strokeLinecap="round" />
          <path d={arc(end)} pathLength={1} fill="none" stroke="var(--proof-leaf)" strokeWidth={14} strokeLinecap="round" style={{ strokeDasharray: 1, animation: 'wgDraw 1s cubic-bezier(.2,.7,.2,1) both' }} />
          <text x={100} y={112} textAnchor="middle" fontSize={40} fontWeight={500} letterSpacing={-1.5} fill="var(--text-primary)">
            {value}
          </text>
        </svg>
      </div>
      <p className="wg-cap m-0">{foot}</p>
    </Widget>
  )
}
