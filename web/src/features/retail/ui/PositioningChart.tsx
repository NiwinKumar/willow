import { useId, useLayoutEffect, useRef, useState } from 'react'

import { int, interval, pct } from './format'
import { niceDomain } from './insight'

export type PositionPoint = {
  id: string
  label: string
  /** Visible-change rate (y). */
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

/** Which side of the two medians a point sits on. */
type Quad = 'tr' | 'tl' | 'br' | 'bl'
const QUAD_TEXT: Record<Quad, string> = {
  tr: 'above the median on both',
  tl: 'above the median on visible change, below on still using',
  br: 'above the median on still using, below on visible change',
  bl: 'below the median on both',
}

/**
 * Positioning, as a four-corner map. Each dot is one brand: further up, more of its people saw a visible change by
 * week 8; further right, more of them were still using it. Dashed lines cross at the median brand and split the
 * map into four named corners; the corner where both are above the median is lightly tinted. One sentence above
 * the plot says what it shows (where the viewed brand sits, or who is in the top-right corner). Brands are named
 * on the plot where there is room (the viewed brand, then the furthest from the middle); the rest name
 * themselves on hover or focus, with the exact figures, the 95% interval and people. One neutral tone (brands are
 * identities, and lime marks the brand being viewed). Every dot is a focusable button (Enter selects); a plain
 * table with the same numbers is one click away under the chart.
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
  const m = { l: 44, r: 12, t: 12, b: 38 }
  const xs = points.map((p) => p.cont)
  const ys = points.map((p) => p.rate)
  const [x0, x1] = niceDomain(xs, 0.08, 0.2)
  const [y0, y1] = niceDomain(ys, 0.08, 0.2)
  const X = (v: number) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r)
  const Y = (v: number) => H - m.b - ((v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b)
  const ticks = (a: number, b: number) => {
    const step = b - a > 0.35 ? 0.1 : b - a > 0.14 ? 0.05 : 0.02
    const out: number[] = []
    for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9; v += step) out.push(Math.round(v * 100) / 100)
    return out
  }
  const median = (v: number[]) => {
    const t = [...v].sort((a, b) => a - b)
    return t.length ? (t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2) : null
  }
  const mx = median(xs)
  const my = median(ys)
  const quad = (p: PositionPoint): Quad | null => (mx === null || my === null ? null : `${p.rate > my ? 't' : 'b'}${p.cont > mx ? 'r' : 'l'}` as Quad)
  const R = (p: PositionPoint) => (p.emphasis ? 8 : 6)
  const hotP = points.find((p) => p.id === hot)
  // The viewed brand last so it sits on top.
  const order = [...points].sort((a, b) => Number(a.emphasis) - Number(b.emphasis))

  // Names on the plot: the viewed brand first, then the furthest from the middle, each only where it fits.
  const plotW = W - m.l - m.r
  const labels = (() => {
    if (mx === null || my === null) return []
    const dist = (p: PositionPoint) => Math.hypot((p.cont - mx) / (x1 - x0 || 1), (p.rate - my) / (y1 - y0 || 1))
    const cands = [...points].sort((a, b) => Number(!!b.emphasis) - Number(!!a.emphasis) || dist(b) - dist(a))
    const boxes: { x: number; y: number; w: number; h: number }[] = []
    const out: { id: string; text: string; x: number; y: number; anchor: 'start' | 'end' }[] = []
    const hits = (b: { x: number; y: number; w: number; h: number }) =>
      b.x < m.l || b.x + b.w > W - m.r || b.y < m.t || b.y + b.h > H - m.b || boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y) || points.some((q) => Math.abs(X(q.cont) - Math.max(b.x, Math.min(X(q.cont), b.x + b.w))) < R(q) + 2 && Math.abs(Y(q.rate) - Math.max(b.y, Math.min(Y(q.rate), b.y + b.h))) < R(q) + 2)
    for (const p of cands) {
      if (out.length >= 7 && !p.emphasis) break
      const w = p.label.length * 6.2 + 4
      const h = 14
      const cx = X(p.cont)
      const cy = Y(p.rate)
      const r = R(p)
      const spots = [
        { x: cx + r + 4, y: cy - h / 2, anchor: 'start' as const },
        { x: cx - r - 4 - w, y: cy - h / 2, anchor: 'end' as const },
        { x: cx - w / 2, y: cy - r - 4 - h, anchor: 'start' as const },
        { x: cx - w / 2, y: cy + r + 4, anchor: 'start' as const },
      ]
      for (const sp of spots) {
        const b = { x: sp.x, y: sp.y, w, h }
        if (hits(b) && !(p.emphasis && sp === spots[3])) continue
        boxes.push(b)
        out.push({ id: p.id, text: p.label, x: sp.anchor === 'start' ? sp.x : sp.x + w, y: sp.y + h / 2, anchor: sp.anchor })
        break
      }
    }
    return out
  })()

  const emph = points.find((p) => p.emphasis)
  const eq = emph ? quad(emph) : null
  const topRight = points.filter((p) => quad(p) === 'tr').sort((a, b) => b.rate - a.rate)
  const insight =
    points.length < 3 || mx === null ? null : emph && eq ? (
      <>
        <strong className="font-medium text-ink">{emph.label}</strong> is {QUAD_TEXT[eq]}: {pct(emph.rate)} saw a visible change and {pct(emph.cont)} were still using at week 8.
      </>
    ) : topRight.length ? (
      <>
        <strong className="font-medium text-ink">{topRight.length} of {points.length}</strong> brands are above the median on both
        {topRight.length <= 3 ? <>: {topRight.map((p) => p.label).join(', ')}.</> : <>, led by {topRight[0].label}.</>}
      </>
    ) : (
      'No brand is above the median on both.'
    )

  const corner = (x: number, y: number, anchor: 'start' | 'end', text: string, on = false) => (
    <text x={x} y={y} textAnchor={anchor} className={`text-[10.5px] ${on ? 'fill-[var(--proof-leaf)]' : 'fill-[var(--text-secondary)]'}`} opacity={on ? 1 : 0.85}>
      {text}
    </text>
  )

  return (
    <figure className="m-0 flex flex-col gap-3">
      {insight ? <p className="m-0 text-proof-body text-ink-2">{insight}</p> : null}
      <div ref={box} className="w-full">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="group" aria-label={caption} aria-describedby={tableId} onPointerLeave={() => setHot(null)}>
          {/* the corner where both are above the median */}
          {mx !== null && my !== null ? <rect x={X(mx)} y={m.t} width={Math.max(0, W - m.r - X(mx))} height={Math.max(0, Y(my) - m.t)} fill="var(--proof-leaf)" fillOpacity={0.07} /> : null}
          {/* grid and axes */}
          {ticks(y0, y1).map((t) => (
            <g key={`y${t}`}>
              <line x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} stroke="var(--line-subtle)" strokeWidth={1} />
              <text x={m.l - 8} y={Y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--text-secondary)] text-proof-label tnum">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {ticks(x0, x1).map((t) => (
            <g key={`x${t}`}>
              <line x1={X(t)} x2={X(t)} y1={m.t} y2={H - m.b} stroke="var(--line-subtle)" strokeWidth={1} />
              <text x={X(t)} y={H - m.b + 15} textAnchor="middle" className="fill-[var(--text-secondary)] text-proof-label tnum">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          <text x={m.l + plotW / 2} y={H - 4} textAnchor="middle" className="fill-[var(--text-secondary)] text-[11px]">
            Still using at week 8 →
          </text>
          <text x={11} y={m.t + (H - m.t - m.b) / 2} textAnchor="middle" transform={`rotate(-90 11 ${m.t + (H - m.t - m.b) / 2})`} className="fill-[var(--text-secondary)] text-[11px]">
            Visible change by week 8 →
          </text>
          {/* median guides and the four named corners */}
          {mx !== null && my !== null ? (
            <>
              <line x1={X(mx)} x2={X(mx)} y1={m.t} y2={H - m.b} stroke="var(--text-secondary)" strokeOpacity={0.6} strokeDasharray="4 4" />
              <line x1={m.l} x2={W - m.r} y1={Y(my)} y2={Y(my)} stroke="var(--text-secondary)" strokeOpacity={0.6} strokeDasharray="4 4" />
              {corner(W - m.r - 6, m.t + 14, 'end', 'Works and keeps users', true)}
              {corner(m.l + 6, m.t + 14, 'start', 'Works, users drop off')}
              {corner(W - m.r - 6, H - m.b - 8, 'end', 'Keeps users, weaker change')}
              {corner(m.l + 6, H - m.b - 8, 'start', 'Weaker on both')}
            </>
          ) : null}
          {/* dots */}
          {order.map((p) => {
            const on = p.emphasis || p.id === hot
            const ci = interval(p.lo, p.hi)
            return (
              <circle
                key={p.id}
                cx={X(p.cont)}
                cy={Y(p.rate)}
                r={R(p) + (p.id === hot && !p.emphasis ? 1 : 0)}
                role={onSelect ? 'button' : 'img'}
                tabIndex={0}
                aria-label={`${p.label}: visible change ${pct(p.rate)}${ci ? ` (95% interval ${ci})` : ''}${p.n ? `, n=${int(p.n)}` : ''}; still using at week 8 ${pct(p.cont)}; ${int(p.users)} people`}
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
                fill={p.emphasis ? 'var(--proof-leaf)' : on ? 'var(--text-primary)' : 'var(--text-secondary)'}
                fillOpacity={p.emphasis ? 1 : on ? 0.9 : 0.55}
                stroke="var(--bg-surface)"
                strokeWidth={2}
                className={`${onSelect ? 'cursor-pointer' : ''} outline-none`}
              />
            )
          })}
          {/* names where there is room */}
          {labels
            .filter((l) => l.id !== hot)
            .map((l) => (
              <text key={l.id} x={l.x} y={l.y} dy="0.32em" textAnchor={l.anchor} pointerEvents="none" className={`text-[11px] ${points.find((p) => p.id === l.id)?.emphasis ? 'fill-[var(--text-primary)] font-medium' : 'fill-[var(--text-secondary)]'}`}>
                {l.text}
              </text>
            ))}
          {/* the pointed-at brand: name and exact figures */}
          {hotP
            ? (() => {
                const x = X(hotP.cont)
                const y = Y(hotP.rate) - R(hotP) - 10
                const text = `${hotP.label} · ${pct(hotP.rate)} visible change · ${pct(hotP.cont)} still using${hotP.users ? ` · ${int(hotP.users)} people` : ''}`
                const w = text.length * 5.7 + 14
                const bx = Math.min(Math.max(x - w / 2, m.l), W - m.r - w)
                const by = Math.max(y - 20, 2)
                return (
                  <g pointerEvents="none">
                    <rect x={bx} y={by} width={w} height={20} rx={5} fill="var(--bg-muted)" stroke="var(--line-strong)" />
                    <text x={bx + 7} y={by + 10} dy="0.34em" className="fill-[var(--text-primary)] text-[11px]">
                      {text}
                    </text>
                  </g>
                )
              })()
            : null}
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
              <th scope="col" className="px-2 text-right font-normal">Visible change</th>
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
                  <td className="px-2 text-right tnum text-ink">
                    {pct(p.rate)}
                    {p.n ? <span className="text-ink-2"> n={int(p.n)}</span> : null}
                  </td>
                  <td className="px-2 text-right tnum">{interval(p.lo, p.hi) ?? '—'}</td>
                  <td className="px-2 text-right tnum">{pct(p.cont)}</td>
                  <td className="pl-2 text-right tnum">{int(p.users)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
