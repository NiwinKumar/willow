import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useTooltip } from '../../ui'
import { niceAxis, type Group } from './query'

/*
 * Explore's chart: one horizontal bar per group, already sorted, scale-true from a zero axis (lift can go
 * below it), value at the bar's end. Grouped by product, each bar carries its 95% interval as a whisker. The
 * workspace brand's bars are leaf green, every other bar neutral; for visible change a gray tick marks the
 * non-users with the same goal. A product's bar is a link to its page. Drawn at the container's real width.
 */

const ROW = 32
const BAR = 14
const AXIS = 22

export type BarFormat = { value: (v: number) => string; tick: (v: number) => string }

export function BarChart({ groups, fmt, caption, hrefOf, tipOf, legend }: { groups: Group[]; fmt: BarFormat; caption: string; hrefOf: (g: Group) => string | null; tipOf: (g: Group) => ReactNode; legend?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(720)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.round(el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const L = W < 520 ? Math.round(W * 0.36) : Math.min(240, Math.round(W * 0.28))
  const T = W - L
  const axis = niceAxis(groups.flatMap((g) => [g.value, g.lo ?? g.value, g.hi ?? g.value, g.base ?? g.value]))
  const padL = axis.min < 0 ? 52 : 8
  const padR = 64
  const X = (v: number) => padL + ((v - axis.min) / (axis.max - axis.min || 1)) * (T - padL - padR)

  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="sr-only">{caption}</figcaption>
      {legend}
      <div ref={box} className="relative w-full">
        {/* gridlines behind the rows */}
        <svg aria-hidden width={T} height={groups.length * ROW + AXIS} className="pointer-events-none absolute top-0 block" style={{ left: L }}>
          {axis.ticks.map((t) => (
            <line key={t} x1={X(t)} x2={X(t)} y1={0} y2={groups.length * ROW} stroke={t === 0 ? 'var(--line-strong)' : 'var(--line-subtle)'} strokeWidth={1} shapeRendering="crispEdges" />
          ))}
          {axis.ticks.map((t) => (
            <text key={`t${t}`} x={X(t)} y={groups.length * ROW + 15} textAnchor="middle" className="fill-[var(--text-secondary)] text-[12px] tnum">
              {fmt.tick(t)}
            </text>
          ))}
        </svg>
        <ol className="relative m-0 list-none p-0" style={{ paddingBottom: AXIS }}>
          {groups.map((g) => (
            <Row key={g.key} g={g} L={L} T={T} X={X} fmt={fmt} href={hrefOf(g)} tip={tipOf(g)} />
          ))}
        </ol>
      </div>
    </figure>
  )
}

function Row({ g, L, T, X, fmt, href, tip }: { g: Group; L: number; T: number; X: (v: number) => number; fmt: BarFormat; href: string | null; tip: ReactNode }) {
  const t = useTooltip(tip)
  const x0 = X(0)
  const xv = X(g.value)
  const y = ROW / 2
  const whisker = g.lo !== null && g.hi !== null
  // The value sits just past the bar (and its whisker); a non-user tick in the way pushes it past the tick.
  let end = g.value < 0 ? Math.min(xv, whisker ? X(g.lo!) : xv) - 6 : Math.max(xv, whisker ? X(g.hi!) : xv) + 6
  if (g.base !== null && g.value >= 0 && X(g.base) >= end - 4 && X(g.base) <= end + 40) end = X(g.base) + 6
  const body = (
    <>
      <span className={`min-w-0 shrink-0 truncate pr-3 text-proof-small ${g.own ? 'font-medium text-ink' : 'text-ink'}`} style={{ width: L }} title={g.label}>
        {g.label}
      </span>
      <svg aria-hidden width={T} height={ROW} className="block shrink-0 overflow-visible">
        <rect x={Math.min(x0, xv)} y={y - BAR / 2} width={Math.max(1, Math.abs(xv - x0))} height={BAR} rx={2} fill={g.own ? 'var(--proof-leaf)' : 'var(--pf-base)'} />
        {whisker ? (
          <g stroke="var(--text-primary)" strokeOpacity={0.55} strokeWidth={1.25}>
            <line x1={X(g.lo!)} x2={X(g.hi!)} y1={y} y2={y} />
            <line x1={X(g.lo!)} x2={X(g.lo!)} y1={y - 4} y2={y + 4} />
            <line x1={X(g.hi!)} x2={X(g.hi!)} y1={y - 4} y2={y + 4} />
          </g>
        ) : null}
        {g.base !== null ? <line x1={X(g.base)} x2={X(g.base)} y1={y - 10} y2={y + 10} stroke="var(--text-secondary)" strokeWidth={2} /> : null}
        <text x={end} y={y} dy="0.35em" textAnchor={g.value < 0 ? 'end' : 'start'} className="fill-[var(--text-primary)] text-[12px] font-medium tnum">
          {fmt.value(g.value)}
        </text>
      </svg>
    </>
  )
  const cls = 'flex items-center rounded-ctl no-underline'
  return (
    <li style={{ height: ROW }}>
      {href ? (
        <Link to={href} {...t.trigger} className={`${cls} h-full text-ink outline-offset-[-2px] hover:bg-pf-hover`}>
          {body}
        </Link>
      ) : (
        <div {...t.trigger} className={`${cls} h-full`}>
          {body}
        </div>
      )}
      {t.node}
    </li>
  )
}
