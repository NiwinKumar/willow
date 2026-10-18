import { useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import { useWidth } from './math'
import { SrTable, Widget } from './Widget'

export type FlowTone = 'lead' | 'good' | 'warn' | 'mixed' | 'mute' | 'ghost'
export type FlowNode = { id: string; col: number; label: string; n: number; tone: FlowTone; /** A third, quieter line under the label. */ sub?: string; /** Part of this group is under 10 people and is not drawn. */ more?: boolean }
export type FlowLink = { source: string; target: string; n: number }

/** Proof tokens, so the chart follows the theme: leaf = a visible change, amber = no change or stopped, blue = mixed feelings. */
const COLOUR: Record<FlowTone, string> = { lead: 'var(--text-disabled)', good: 'var(--proof-leaf)', warn: 'var(--pf-amber-fill)', mixed: 'var(--pf-blue)', mute: 'var(--pf-base)', ghost: 'var(--line-strong)' }

const NODE_W = 12
const GAP = 6
const SLOT = 34 // the least height a node takes, so two labels never touch
const HEAD = 26
const LEFT = 118
const RIGHT = 128
const MIN_W = 600
const EXTRA_H = 90 // height beyond the labels' own room, which the band thickness grows into

type Placed = { node: FlowNode; y: number; h: number; x: number }

/**
 * A flow (Sankey), drawn as a tree: every group splits once into its own parts, children stack
 * under their parent in order, so no band ever crosses another. Band thickness is people, on one scale for the whole
 * chart. Hover or focus a group and its whole path lights while the rest dims; the line above reads it in words.
 * A group with part of it left out (under 10 people) shows a dashed stub for the rest.
 */
export function FlowChart({
  title,
  columns,
  nodes,
  links,
  summary,
  describe,
  legend,
  footnote,
  ariaLabel,
}: {
  title: string
  /** One heading per column, left to right. */
  columns: string[]
  nodes: FlowNode[]
  links: FlowLink[]
  /** What the readout says when nothing is picked. */
  summary: string
  /** One group in words: its n, its share of the group it came from. */
  describe: (node: FlowNode, parent: FlowNode | null) => string
  legend?: { tone: FlowTone; label: string }[]
  /** A note under the legend, inside the card. */
  footnote?: ReactNode
  ariaLabel: string
}) {
  const [box, boxW] = useWidth<HTMLDivElement>(300, 960)
  const gid = useId().replace(/:/g, '')
  const [pick, setPick] = useState<string | null>(null)
  const W = Math.max(MIN_W, boxW)
  const lastCol = Math.max(...nodes.map((n) => n.col), 1)
  const step = (W - LEFT - RIGHT - NODE_W) / lastCol

  const { placed, ports, H, k, parentOf, kids } = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const parentOf = new Map(links.map((l) => [l.target, l.source]))
    const kids = new Map<string, string[]>()
    for (const l of links) kids.set(l.source, [...(kids.get(l.source) ?? []), l.target])
    for (const [p, c] of kids) kids.set(p, c.sort((a, b) => nodes.findIndex((n) => n.id === a) - nodes.findIndex((n) => n.id === b)))
    const roots = nodes.filter((n) => !parentOf.has(n.id))

    const run = (k: number) => {
      const pos = new Map<string, { y: number; h: number }>()
      const place = (id: string, top: number): number => {
        const n = byId.get(id)!
        const h = Math.max(n.n * k, 6)
        let cursor = top
        for (const c of kids.get(id) ?? []) cursor = place(c, cursor) + GAP
        const kidsBottom = kids.get(id)?.length ? cursor - GAP : top
        pos.set(id, { y: top, h })
        return Math.max(kidsBottom, top + Math.max(h, SLOT))
      }
      // A lone group (no parts of its own) tucks under the first group in its own column instead of below the
      // whole tree, where that column is empty.
      const start = HEAD + 14
      let colBottom = start
      let treeBottom = start
      roots.forEach((r, i) => {
        const lone = i > 0 && !(kids.get(r.id)?.length)
        const top = lone ? colBottom + GAP * 3 : i > 0 ? treeBottom + GAP * 2 : start
        const bottom = place(r.id, top)
        colBottom = top + Math.max(byId.get(r.id)!.n * k, SLOT)
        treeBottom = Math.max(treeBottom, bottom)
      })
      return { pos, bottom: Math.max(treeBottom, colBottom) }
    }
    // The biggest scale (people → pixels) that still fits: the room the labels need, plus some to grow into.
    const TARGET_H = run(0.0001).bottom + EXTRA_H
    let lo = 0.0001
    let hi = 6
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2
      if (run(mid).bottom <= TARGET_H) lo = mid
      else hi = mid
    }
    const { pos, bottom } = run(lo)
    const placed = new Map<string, Placed>()
    for (const n of nodes) placed.set(n.id, { node: n, ...pos.get(n.id)!, x: 0 })
    // Where each band leaves its parent and enters its child.
    const ports = new Map<string, { y0: number; y1: number; t: number }>()
    for (const [p, cs] of kids) {
      let cursor = placed.get(p)!.y
      for (const c of cs) {
        const l = links.find((x) => x.source === p && x.target === c)!
        const t = Math.max(l.n * lo, 2)
        ports.set(c, { y0: cursor, y1: placed.get(c)!.y, t })
        cursor += t
      }
    }
    return { placed, ports, H: bottom + 24, k: lo, parentOf, kids }
  }, [nodes, links])

  const colX = (c: number) => LEFT + c * step
  const lit = useMemo(() => {
    if (!pick) return null
    const set = new Set<string>([pick])
    for (let p = parentOf.get(pick); p; p = parentOf.get(p)) set.add(p)
    const down = (id: string) => {
      for (const c of kids.get(id) ?? []) {
        set.add(c)
        down(c)
      }
    }
    down(pick)
    return set
  }, [pick, parentOf, kids])

  const nodeOf = (id: string) => placed.get(id)!.node
  const read = pick ? describe(nodeOf(pick), parentOf.has(pick) ? nodeOf(parentOf.get(pick)!) : null) : summary
  const share = (id: string) => {
    const p = parentOf.get(id)
    return p ? Math.round((nodeOf(id).n / nodeOf(p).n) * 100) : null
  }

  return (
    <Widget label={ariaLabel} className="wg-flow" head={false}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="wg-title !pt-0">{title}</h3>
          <p aria-live="polite" className="wg-line-read !min-h-[36px] !text-[13px] !leading-[18px]">
            {read}
          </p>
        </div>
      </div>
      <div ref={box} className="wg-flow-scroll" tabIndex={W > boxW ? 0 : undefined} aria-label={W > boxW ? 'Flow chart, scroll sideways' : undefined}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} onPointerLeave={() => setPick(null)} aria-hidden={false} role="group" aria-label={title} className="block overflow-visible">
          <defs>
            {nodes.map((n) => {
              const p = parentOf.get(n.id)
              return p ? (
                <linearGradient key={n.id} id={`g-${gid}-${n.id}`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" style={{ stopColor: COLOUR[nodeOf(p).tone] }} stopOpacity={0.3} />
                  <stop offset="1" style={{ stopColor: COLOUR[n.tone] }} stopOpacity={0.42} />
                </linearGradient>
              ) : null
            })}
          </defs>
          {columns.map((c, i) => (
            <text key={c} x={i === 0 ? colX(i) - NODE_W : colX(i)} y={14} fontSize={11.5} letterSpacing=".02em" fill="var(--text-secondary)" textAnchor="start">
              {c}
            </text>
          ))}
          <g className="wg-wipe">
            {nodes.map((n) => {
              const p = parentOf.get(n.id)
              const port = ports.get(n.id)
              if (!p || !port) return null
              const x0 = colX(nodeOf(p).col) + NODE_W
              const x1 = colX(n.col)
              const xm = (x0 + x1) / 2
              const { y0, y1, t } = port
              const d = `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}L${x1},${y1 + t}C${xm},${y1 + t} ${xm},${y0 + t} ${x0},${y0 + t}Z`
              const on = !lit || (lit.has(n.id) && lit.has(p))
              return (
                <path
                  key={`l-${n.id}`}
                  d={d}
                  fill={n.tone === 'ghost' ? 'var(--bg-sunken)' : `url(#g-${gid}-${n.id})`}
                  stroke={n.tone === 'ghost' ? 'var(--line-strong)' : 'none'}
                  strokeDasharray={n.tone === 'ghost' ? '4 4' : undefined}
                  style={{ opacity: on ? (lit ? 1 : 0.9) : 0.1, transition: 'opacity .18s ease' }}
                  onPointerEnter={() => setPick(n.id)}
                />
              )
            })}
          </g>
          {[...placed.values()].map(({ node: n, y, h }) => {
            const x = colX(n.col)
            const on = !lit || lit.has(n.id)
            const left = n.col === 0
            const childN = (kids.get(n.id) ?? []).reduce((s, c) => s + nodeOf(c).n, 0)
            const rest = n.more ? n.n - childN : 0
            const pc = share(n.id)
            return (
              <g
                key={n.id}
                tabIndex={0}
                role="img"
                aria-label={describe(n, parentOf.has(n.id) ? nodeOf(parentOf.get(n.id)!) : null)}
                onPointerEnter={() => setPick(n.id)}
                onFocus={() => setPick(n.id)}
                onBlur={() => setPick(null)}
                style={{ opacity: on ? 1 : 0.28, transition: 'opacity .18s ease', outline: 'none' } as CSSProperties}
                className="wg-flow-node"
              >
                <rect x={x} y={y} width={NODE_W} height={h} rx={5} fill={n.tone === 'ghost' ? 'var(--bg-sunken)' : COLOUR[n.tone]} stroke={n.tone === 'ghost' ? 'var(--text-disabled)' : 'none'} strokeDasharray={n.tone === 'ghost' ? '3 3' : undefined} />
                {rest > 0 ? (
                  <g>
                    <title>Groups under 10 people are not drawn</title>
                    <rect x={x + NODE_W + 3} y={y + (n.n - rest) * k} width={30} height={Math.max(rest * k, 8)} rx={5} fill="none" stroke="var(--text-disabled)" strokeDasharray="4 3" />
                  </g>
                ) : null}
                <text x={left ? x - 12 : x + NODE_W + (rest > 0 ? 40 : 12)} y={y + 14} textAnchor={left ? 'end' : 'start'} className="wg-flow-t">
                  <tspan fontSize={16} fontWeight={500} letterSpacing="-.02em" fill="var(--text-primary)">
                    {n.n.toLocaleString('en-GB')}
                  </tspan>
                  {pc !== null ? (
                    <tspan fontSize={11.5} dx={5} fill="var(--text-secondary)">
                      {pc}%
                    </tspan>
                  ) : null}
                </text>
                <text x={left ? x - 12 : x + NODE_W + (rest > 0 ? 40 : 12)} y={y + 28} textAnchor={left ? 'end' : 'start'} fontSize={11.5} className="wg-flow-t" fill="var(--text-secondary)">
                  {n.label}
                </text>
                {n.sub ? (
                  <text x={left ? x - 12 : x + NODE_W + (rest > 0 ? 40 : 12)} y={y + 41} textAnchor={left ? 'end' : 'start'} fontSize={11.5} className="wg-flow-t" fill="var(--text-disabled)">
                    {n.sub}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
      </div>
      {W > boxW ? <p className="wg-cap m-0 text-[12px]">Swipe sideways to follow the flow.</p> : null}
      {legend?.length ? (
        <ul className="m-0 mt-auto flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px] text-[var(--wg-fg2)]">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <i aria-hidden className="size-2.5 rounded-full" style={{ background: l.tone === 'ghost' ? 'transparent' : COLOUR[l.tone], border: l.tone === 'ghost' ? '1px dashed var(--text-disabled)' : 'none' }} />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      {footnote ? <p className="wg-cap m-0">{footnote}</p> : null}
      <SrTable
        caption={title}
        head={['Step', 'People', 'Share of the group it came from']}
        rows={nodes.map((n) => [n.label, n.n, share(n.id) === null ? '—' : `${share(n.id)}%`])}
      />
    </Widget>
  )
}
