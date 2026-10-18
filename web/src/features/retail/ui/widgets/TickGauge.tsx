import type { CSSProperties } from 'react'

import { SrTable, Widget } from './Widget'

const N = 56
const CX = 150
const CY = 150
const R_IN = 78
const R_OUT = 120

/**
 * A half-circle of ticks the share lights ticks from the left, the rest stay as faint
 * stubs. The figure sits in the middle, a notch marks where the lit ticks end, with a callout when there is room for it. `legend` names the
 * two parts (kept / not kept) so the figure never relies on the lit/faint difference alone.
 */
export function TickGauge({
  title,
  caption,
  value,
  display,
  legend,
  callout,
  chip,
  ariaLabel,
}: {
  title: string
  /** One line under the title saying what the share is of. */
  caption?: string
  /** 0–1. */
  value: number
  display: string
  legend: { label: string; display: string }[]
  /** The words at the end of the lit ticks. */
  callout: string
  chip?: string
  ariaLabel: string
}) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * (N - 1))
  const ang = (k: number) => Math.PI - (k / (N - 1)) * Math.PI
  const pt = (k: number, r: number) => [CX + r * Math.cos(ang(k)), CY - r * Math.sin(ang(k))] as const
  const [ex, ey] = pt(lit, R_OUT + 12)
  const [lx, ly] = pt(lit, R_OUT + 30)
  const right = Math.cos(ang(lit)) > 0.15
  return (
    <Widget label={ariaLabel} className="wg-gauge" head={false}>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="wg-title !pt-0">{title}</h3>
        {caption ? <p className="wg-cap">{caption}</p> : null}
      </div>
      <div className="wg-gauge-row">
        <div className="wg-gauge-copy">
          <ul className="wg-legend">
            {legend.map((l, i) => (
              <li key={l.label}>
                <i style={{ background: i === 0 ? 'var(--proof-leaf)' : 'var(--line-strong)' }} />
                <span>
                  {l.label} · <b className="font-semibold">{l.display}</b>
                </span>
              </li>
            ))}
          </ul>
          {chip ? <span className="wg-pill">{chip}</span> : null}
        </div>
        <div className="wg-gauge-plot">
          <svg viewBox="0 -4 300 172" role="img" aria-label={`${title}: ${display}. ${callout}`}>
            {Array.from({ length: N }, (_, k) => {
              const on = k <= lit
              const [x1, y1] = pt(k, R_IN)
              const [x2, y2] = pt(k, R_OUT - (on ? 0 : 8))
              return <line key={k} className="wg-tick" style={{ '--i': k } as CSSProperties} x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? 'var(--proof-leaf)' : 'var(--line-strong)'} strokeWidth={on ? 3.6 : 2.4} strokeLinecap="round" />
            })}
            <circle cx={ex} cy={ey} r={4} fill="var(--bg-surface)" stroke="var(--proof-leaf)" strokeWidth={2} />
            {value > 0.12 && value < 0.88 ? (
              <>
                <line x1={ex} y1={ey} x2={lx} y2={ly} stroke="var(--line-strong)" strokeWidth={1} />
                <text x={right ? lx - 6 : lx + 6} y={ly - 4} textAnchor={right ? 'end' : 'start'} fontSize={10.5} fill="var(--text-secondary)">
                  {callout}
                </text>
              </>
            ) : null}
            <text x={CX} y={CY - 6} textAnchor="middle" fontSize={48} fontWeight={500} letterSpacing={-2} fill="var(--text-primary)">
              {display}
            </text>
          </svg>
        </div>
      </div>
      <SrTable caption={title} head={['Part', 'Share']} rows={legend.map((l) => [l.label, l.display])} />
    </Widget>
  )
}
