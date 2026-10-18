import { useState, type KeyboardEvent, type PointerEvent } from 'react'

import { nearest, smooth, stepKey, useWidth, type XY } from './math'
import { SrTable, Widget, type WidgetMenu } from './Widget'

export type LineSeries = { id: string; label: string; values: (number | null)[]; tone: 'leaf' | 'mute' }

const H = 168
const PAD = { l: 38, r: 12, t: 12, b: 26 }
const LEAF = 'var(--proof-leaf)'
const MUTE = 'var(--pf-base)'

/**
 * A leaf line, one smooth curve per series with a dot on every reading. The headline reads the
 * latest point; move over the plot (or use the arrow keys) to read any other. A second series is a grey dashed
 * comparison. Null readings (a group under 10 people) break the line instead of being drawn as zero.
 */
export function LineWidget({
  title,
  value,
  unit,
  series,
  xLabels,
  format,
  describe,
  ariaLabel,
  menu,
}: {
  title: string
  value: string
  unit?: string
  series: LineSeries[]
  xLabels: string[]
  format: (v: number) => string
  /** One reading in words: what the line above the plot says for index i. */
  describe: (i: number) => string
  ariaLabel: string
  menu?: WidgetMenu
}) {
  const [box, w] = useWidth<HTMLDivElement>(220, 360)
  const [pick, setPick] = useState<number | null>(null)
  const n = xLabels.length
  const i = pick ?? n - 1
  const iw = w - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const peak = Math.max(0.05, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)))
  const top = Math.min(1, Math.ceil(peak * 10 + 0.4) / 10)
  const x = (k: number) => PAD.l + (n <= 1 ? iw / 2 : (k / (n - 1)) * iw)
  const y = (v: number) => PAD.t + ih - (v / top) * ih
  const ticks = [0, top / 2, top]

  /** Unbroken runs of readings, each drawn as its own curve. */
  const runs = (vals: (number | null)[]): XY[][] => {
    const out: XY[][] = []
    let cur: XY[] = []
    vals.forEach((v, k) => {
      if (v === null) {
        if (cur.length) out.push(cur)
        cur = []
      } else cur.push([x(k), y(v)])
    })
    if (cur.length) out.push(cur)
    return out
  }
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setPick(nearest(Array.from({ length: n }, (_, k) => x(k)), e.clientX - r.left))
  }
  const key = (e: KeyboardEvent) => {
    const next = stepKey(e.key, i, n)
    if (next === null) return
    e.preventDefault()
    setPick(next)
  }
  const labelEvery = n > 6 ? 2 : 1

  return (
    <Widget title={title} label={ariaLabel} menu={menu} className="wg-line">
      <div className="wg-line-top">
        <p className="wg-line-val m-0">
          {value}
          {unit ? <span className="wg-unit ml-1 text-[.55em]">{unit}</span> : null}
        </p>
      </div>
      <p aria-live="polite" className="wg-line-read">
        {describe(i)}
      </p>
      <div ref={box} className="wg-line-plot">
        <div role="group" tabIndex={0} aria-label={`${title}. Use the left and right arrow keys to read each point.`} onKeyDown={key} onBlur={() => setPick(null)} className="rounded-[14px]">
          <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} onPointerMove={move} onPointerLeave={() => setPick(null)} aria-hidden className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={PAD.l + iw} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--line-subtle)' }} />
                <text x={PAD.l - 10} y={y(t) + 4} textAnchor="end" fontSize={11} style={{ fill: 'var(--text-secondary)' }}>
                  {format(t)}
                </text>
              </g>
            ))}
            <line x1={x(i)} x2={x(i)} y1={PAD.t - 4} y2={PAD.t + ih} style={{ stroke: 'var(--line-strong)' }} strokeDasharray="3 4" />
            {[...series].reverse().map((s) =>
              runs(s.values).map((r, k) => (
                <path
                  key={`${s.id}-${k}`}
                  d={smooth(r)}
                  pathLength={1}
                  fill="none"
                  stroke={s.tone === 'leaf' ? LEAF : MUTE}
                  strokeWidth={s.tone === 'leaf' ? 3.4 : 2}
                  strokeDasharray={s.tone === 'leaf' ? undefined : '5 4'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={s.tone === 'leaf' ? { strokeDasharray: 1, animation: 'wgDraw 1.1s cubic-bezier(.2,.7,.2,1) both' } : undefined}
                />
              )),
            )}
            {series
              .filter((s) => s.tone === 'leaf')
              .map((s) =>
                s.values.map((v, k) =>
                  v === null ? null : (
                    <g key={`${s.id}-d${k}`}>
                      {k === i ? <circle cx={x(k)} cy={y(v)} r={11} fill="var(--proof-leaf-soft)" /> : null}
                      {n <= 6 || k === i || k === 0 || k === n - 1 ? <circle cx={x(k)} cy={y(v)} r={k === i ? 6.5 : 4.5} fill={LEAF} stroke="var(--bg-surface)" strokeWidth={2.5} style={{ transition: 'r .15s ease' }} /> : null}
                    </g>
                  ),
                ),
              )}
            {xLabels.map((l, k) =>
              k % labelEvery === 0 || k === n - 1 || k === i ? (
                <text key={l + k} x={x(k)} y={H - 6} textAnchor={k === 0 ? 'start' : k === n - 1 ? 'end' : 'middle'} fontSize={11} fontWeight={k === i ? 600 : 400} fill={k === i ? 'var(--text-primary)' : 'var(--text-secondary)'}>
                  {l}
                </text>
              ) : null,
            )}
            <rect x={PAD.l} y={0} width={iw} height={H} fill="transparent" />
          </svg>
        </div>
      </div>
      <SrTable
        caption={title}
        head={['Reading', ...series.map((s) => s.label)]}
        rows={xLabels.map((l, k) => [l, ...series.map((s) => (s.values[k] === null ? 'Fewer than 10 people' : format(s.values[k]!)))])}
      />
    </Widget>
  )
}
