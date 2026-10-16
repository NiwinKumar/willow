import type { ReactNode } from 'react'

import { MIN_GROUP } from './format'

export type HeatCell = {
  /** 0–1 strength of the fill; null = suppressed (hatched, "n<10"). */
  value: number | null
  /** What the cell shows ("48%"). */
  text: string
  /** Second line (the n: "102 people"). */
  sub?: string
  /** Marks a cell to look at (outlined + glyph), e.g. the flagged gap tier. */
  flag?: string
}

/**
 * A matrix as a real <table> (so it is its own accessible fallback): row headers, column headers, each cell
 * filled at alpha = value × 0.6 of one tone (docs/DESIGN.md heat table). `tone="signal"` (ember) only when the
 * value is a real-change rate; `neutral` (white) for everything else, such as demand. Suppressed cells are
 * hatched and say so. `onCell` makes cells buttons (drill-down).
 */
export function Heatmap<R extends { id: string; label: ReactNode }, C extends { id: string; label: ReactNode }>({
  caption,
  rows,
  cols,
  cell,
  tone = 'neutral',
  corner = '',
  onCell,
  minWidth = 520,
}: {
  caption: string
  rows: R[]
  cols: C[]
  cell: (r: R, c: C) => HeatCell | null
  tone?: 'signal' | 'neutral'
  corner?: string
  onCell?: (r: R, c: C) => void
  minWidth?: number
}) {
  const fill = (v: number) => `color-mix(in srgb, ${tone === 'signal' ? 'var(--signal-change)' : 'var(--text-primary)'} ${Math.round(v * (tone === 'signal' ? 60 : 32))}%, var(--bg-sunken))`
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full border-separate border-spacing-[3px] text-proof-body" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left text-proof-small font-normal text-ink-2">
              {corner}
            </th>
            {cols.map((c) => (
              <th key={c.id} scope="col" className="px-2 py-1 text-left text-proof-small font-normal text-ink-2">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="whitespace-nowrap py-1 pr-3 text-left text-proof-body font-normal text-ink">
                {r.label}
              </th>
              {cols.map((c) => {
                const v = cell(r, c)
                if (!v) return <td key={c.id} />
                const inner =
                  v.value === null ? (
                    <span className="flex flex-col">
                      <span className="font-mono text-ink-2">—</span>
                      <span className="text-[11px] text-ink-2">n&lt;{MIN_GROUP}</span>
                    </span>
                  ) : (
                    <span className="flex flex-col">
                      <span className="flex items-center gap-1 font-mono tnum text-ink">
                        {v.text}
                        {v.flag ? <span className="text-[11px] text-ink">◇ {v.flag}</span> : null}
                      </span>
                      {v.sub ? <span className="text-[11px] text-ink-2">{v.sub}</span> : null}
                    </span>
                  )
                const cls = `h-11 rounded-[6px] px-2 py-1 align-middle ${v.flag ? 'outline outline-1 -outline-offset-1 outline-ink/70' : ''} ${v.value === null ? 'retail-hatch' : ''}`
                return (
                  <td key={c.id} className={cls} style={v.value === null ? undefined : { background: fill(v.value) }}>
                    {onCell && v.value !== null ? (
                      <button type="button" onClick={() => onCell(r, c)} className="w-full border-0 bg-transparent p-0 text-left">
                        {inner}
                      </button>
                    ) : (
                      inner
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
