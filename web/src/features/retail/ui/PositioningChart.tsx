import { useId, useLayoutEffect, useRef, useState } from 'react'

import { int, interval, pct } from './format'
import { niceDomain } from './insight'

export type PositionPoint = {
  id: string
  label: string
  /** Real-change rate (y). */
  rate: number
  lo?: number | null
  hi?: number | null
  /** Continuation at week 8 (x). */
  cont: number
  /** People (bubble area). */
  users: number | null
  /** n behind the rate, for the label and the table. */
  n?: number | null
  /** Drawn solid and always labelled (the brand being viewed, or the selected one). */
  emphasis?: boolean
}

/**
 * Positioning: real-change rate (y) against continuation at week 8 (x), bubble area = people, the rate's 95%
 * interval as a vertical whisker, dashed guides at the median point. One neutral tone (no hue: brands are
 * identities, and ember stays "real change" only); the emphasised point is solid and labelled, others get
 * their label on hover or focus. Every point is a focusable button (Enter selects); a plain table with the
 * same numbers is one click away under the chart.
 */
export function PositioningChart({ points, onSelect, caption, height = 320 }: { points: PositionPoint[]; onSelect?: (id: string) => void; caption: string; height?: number }) {
  const [hot, setHot] = useState<string | null>(null)
  const tableId = useId()
  // Drawn at the container's real width, so type and marks keep their pixel sizes at every breakpoint.
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(560)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.round(el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = height
  const m = { l: 46, r: 16, t: 14, b: 40 }
  const xs = points.map((p) => p.cont)
  const ys = points.flatMap((p) => [p.rate, p.lo ?? p.rate, p.hi ?? p.rate])
  const [x0, x1] = niceDomain(xs)
  const [y0, y1] = niceDomain(ys, 0.05, 0.3)
  const X = (v: number) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r)
  const Y = (v: number) => H - m.b - ((v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b)
  const ticks = (a: number, b: number) => {
    const step = b - a > 0.35 ? 0.1 : 0.05
    const out: number[] = []
    for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9; v += step) out.push(Math.round(v * 100) / 100)
    return out
  }
  const maxUsers = Math.max(1, ...points.map((p) => p.users ?? 0))
  const R = (u: number | null) => 4 + 10 * Math.sqrt((u ?? 0) / maxUsers)
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b)
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null
  }
  const mx = median(xs)
  const my = median(points.map((p) => p.rate))
  // Draw big bubbles first so small ones stay on top; emphasised and hovered last.
  const order = [...points].sort((a, b) => Number(a.emphasis) - Number(b.emphasis) || (b.users ?? 0) - (a.users ?? 0))
  const hotP = points.find((p) => p.id === hot)
  const labelled = [...points.filter((p) => p.emphasis && p.id !== hot), ...(hotP ? [hotP] : [])]

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div ref={box} className="w-full">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="group" aria-label={caption} aria-describedby={tableId} onPointerLeave={() => setHot(null)}>
          {/* grid and axes */}
          {ticks(y0, y1).map((t) => (
            <g key={`y${t}`}>
              <line x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} stroke="var(--line-subtle)" strokeWidth={1} />
              <text x={m.l - 8} y={Y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--text-secondary)] font-mono text-[10.5px] tnum">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {ticks(x0, x1).map((t) => (
            <g key={`x${t}`}>
              <line x1={X(t)} x2={X(t)} y1={m.t} y2={H - m.b} stroke="var(--line-subtle)" strokeWidth={1} />
              <text x={X(t)} y={H - m.b + 15} textAnchor="middle" className="fill-[var(--text-secondary)] font-mono text-[10.5px] tnum">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          <text x={W - m.r} y={H - 6} textAnchor="end" className="fill-[var(--text-secondary)] text-[11px]">
            Still using at week 8 →
          </text>
          <text x={12} y={m.t + (H - m.t - m.b) / 2} textAnchor="middle" transform={`rotate(-90 12 ${m.t + (H - m.t - m.b) / 2})`} className="fill-[var(--text-secondary)] text-[11px]">
            Real change by week 8 →
          </text>
          {/* median guides */}
          {mx !== null ? <line x1={X(mx)} x2={X(mx)} y1={m.t} y2={H - m.b} stroke="var(--text-secondary)" strokeOpacity={0.5} strokeDasharray="3 4" /> : null}
          {my !== null ? <line x1={m.l} x2={W - m.r} y1={Y(my)} y2={Y(my)} stroke="var(--text-secondary)" strokeOpacity={0.5} strokeDasharray="3 4" /> : null}
          {my !== null ? (
            <text x={m.l + 4} y={Y(my) - 5} textAnchor="start" className="fill-[var(--text-secondary)] text-[10.5px]">
              median brand
            </text>
          ) : null}
          {/* whiskers */}
          {order.map((p) =>
            p.lo !== null && p.lo !== undefined && p.hi !== null && p.hi !== undefined ? (
              <line key={`w${p.id}`} x1={X(p.cont)} x2={X(p.cont)} y1={Y(p.lo)} y2={Y(p.hi)} stroke="var(--text-primary)" strokeOpacity={p.emphasis || p.id === hot ? 0.7 : 0.22} strokeWidth={p.emphasis || p.id === hot ? 2 : 1.5} strokeLinecap="round" />
            ) : null,
          )}
          {/* bubbles */}
          {order.map((p) => {
            const on = p.emphasis || p.id === hot
            const ci = interval(p.lo, p.hi)
            return (
              <circle
                key={p.id}
                cx={X(p.cont)}
                cy={Y(p.rate)}
                r={R(p.users)}
                role={onSelect ? 'button' : 'img'}
                tabIndex={0}
                aria-label={`${p.label}: real change ${pct(p.rate)}${ci ? ` (95% interval ${ci})` : ''}${p.n ? `, n=${int(p.n)}` : ''}; still using at week 8 ${pct(p.cont)}; ${int(p.users)} people`}
                onPointerEnter={() => setHot(p.id)}
                onFocus={() => setHot(p.id)}
                onBlur={() => setHot((h) => (h === p.id ? null : h))}
                onClick={onSelect ? () => onSelect(p.id) : undefined}
                onKeyDown={(e) => {
                  if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onSelect(p.id)
                  }
                }}
                fill="var(--text-primary)"
                fillOpacity={on ? 0.95 : 0.2}
                stroke={on ? 'var(--bg-surface)' : 'var(--text-primary)'}
                strokeOpacity={on ? 1 : 0.55}
                strokeWidth={on ? 2 : 1}
                className={`${onSelect ? 'cursor-pointer' : ''} outline-none focus-visible:stroke-[var(--focus-ring)] focus-visible:[stroke-width:3]`}
              />
            )
          })}
          {/* labels: the emphasised point, and the one under the pointer or focus */}
          {labelled.map((p) => {
            const x = X(p.cont)
            const y = Y(p.rate) - R(p.users) - 8
            const right = x > W - 230
            const text = `${p.label}: ${pct(p.rate)} changed, ${pct(p.cont)} still using`
            return (
              <g key={`l${p.id}`} pointerEvents="none">
                <rect x={right ? x - text.length * 5.8 - 8 : x - 4} y={y - 13} width={text.length * 5.8 + 12} height={18} rx={4} fill="var(--bg-muted)" stroke="var(--line-strong)" />
                <text x={right ? x - 2 : x + 2} y={y} textAnchor={right ? 'end' : 'start'} className="fill-[var(--text-primary)] text-[11px]">
                  {text}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <details className="group text-proof-small text-ink-2">
        <summary className="cursor-pointer list-none hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show as a table</span>
          <span className="hidden group-open:inline">Hide the table</span>
        </summary>
        <table id={tableId} className="mt-2 w-full border-collapse text-proof-small">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-ink-2">
              <th scope="col" className="h-8 pr-2 text-left font-normal">Name</th>
              <th scope="col" className="px-2 text-right font-normal">Real change</th>
              <th scope="col" className="px-2 text-right font-normal">95% interval</th>
              <th scope="col" className="px-2 text-right font-normal">Still using</th>
              <th scope="col" className="pl-2 text-right font-normal">People</th>
            </tr>
          </thead>
          <tbody>
            {[...points]
              .sort((a, b) => b.rate - a.rate)
              .map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <th scope="row" className="h-8 pr-2 text-left font-normal text-ink">
                    {p.label}
                  </th>
                  <td className="px-2 text-right font-mono tnum text-ink">
                    {pct(p.rate)}
                    {p.n ? <span className="text-ink-2"> n={int(p.n)}</span> : null}
                  </td>
                  <td className="px-2 text-right font-mono tnum">{interval(p.lo, p.hi) ?? '—'}</td>
                  <td className="px-2 text-right font-mono tnum">{pct(p.cont)}</td>
                  <td className="pl-2 text-right font-mono tnum">{int(p.users)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
