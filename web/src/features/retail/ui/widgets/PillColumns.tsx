import { useState, type CSSProperties, type KeyboardEvent } from 'react'

import { stepKey } from './math'
import { SrTable, Widget } from './Widget'

export type PillColumn = {
  id: string
  /** What sits under the column (short; the full name is in the tooltip and the table). */
  label: string
  name: string
  /** People behind the column; the readout says it. */
  n: number
  /** The share (0–1) the column's fill shows. */
  share: number
}

/**
 * Capsule columns: each track is the whole group (100%) and the fill is its share. Pick a column (hover, tap or
 * the arrow keys) for its exact numbers.
 */
export function PillColumns({
  title,
  columns,
  headline,
  readout,
  format,
  ariaLabel,
}: {
  title: string
  columns: PillColumn[]
  /** The big figure (a total over all columns, worked out by the caller). */
  headline: { value: string; caption: string }
  readout: (c: PillColumn) => string
  format: (v: number) => string
  ariaLabel: string
}) {
  const [pick, setPick] = useState<number | null>(null)
  const n = columns.length
  const h = headline
  const nav = (e: KeyboardEvent) => {
    const next = stepKey(e.key, pick ?? 0, n)
    if (next === null) return
    e.preventDefault()
    setPick(next)
  }
  const ticks = [1, 0.75, 0.5, 0.25, 0]
  if (!n) return null
  return (
    <Widget label={ariaLabel} className="wg-cols" head={false}>
      <div className="wg-cols-top">
        <div className="flex min-w-0 flex-col">
          <h3 className="wg-title !pt-0">{title}</h3>
          <div className="mt-1 flex items-center gap-3">
            <p className="wg-cols-val m-0">{h.value}</p>
            <p aria-live="polite" className="wg-cap" style={{ minHeight: 32 }}>
              {pick !== null ? readout(columns[pick]) : h.caption}
            </p>
          </div>
        </div>
      </div>
      <div role="group" tabIndex={0} aria-label={`${title}. Use the left and right arrow keys to read each column.`} onKeyDown={nav} onBlur={() => setPick(null)} onPointerLeave={() => setPick(null)} className="wg-cols-plot" style={{ '--n': n } as CSSProperties}>
        <div aria-hidden className="wg-cols-axis">
          {ticks.map((t) => (
            <span key={t}>{format(t)}</span>
          ))}
        </div>
        {columns.map((c, i) => {
          const v = c.share
          return (
            <button key={c.id} type="button" tabIndex={-1} aria-label={readout(c)} data-on={pick === i ? '' : undefined} className="wg-cols-col" onPointerEnter={() => setPick(i)} onClick={() => setPick(i)}>
              <span className="wg-cols-track">
                <span className="wg-cols-fill" style={{ height: `${Math.max(v * 100, 0)}%`, '--i': i } as CSSProperties} />
              </span>
            </button>
          )
        })}
        <span aria-hidden />
        {columns.map((c, i) => (
          <span key={c.id} title={c.name} data-on={pick === i ? '' : undefined} className="wg-cols-lab">
            {c.label}
          </span>
        ))}
      </div>
      <SrTable caption={title} head={['Group', 'People', 'Share']} rows={columns.map((c) => [c.name, c.n, format(c.share)])} />
    </Widget>
  )
}
