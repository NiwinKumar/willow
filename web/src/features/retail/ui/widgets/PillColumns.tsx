import { ChevronDown } from 'lucide-react'
import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react'

import { stepKey } from './math'
import { SrTable, Widget } from './Widget'

export type PillColumn = {
  id: string
  /** What sits under the column (short; the full name is in the tooltip and the table). */
  label: string
  name: string
  /** People behind the column; the readout says it. */
  n: number
  /** The share (0–1) for each option key. */
  shares: Record<string, number>
}
export type PillOption = { key: string; label: string }

/**
 * Capsule columns on an ember card: each track is the whole group (100%), the dark fill is the share who match
 * the picked option. The select swaps the option and the fills slide; pick a column for its exact numbers.
 */
export function PillColumns({
  title,
  options,
  defaultKey,
  columns,
  headline,
  readout,
  format,
  ariaLabel,
}: {
  title: string
  options: PillOption[]
  defaultKey?: string
  columns: PillColumn[]
  /** The big figure for the picked option (a total over all columns, worked out by the caller). */
  headline: (key: string) => { value: string; caption: string }
  readout: (c: PillColumn, key: string) => string
  format: (v: number) => string
  ariaLabel: string
}) {
  const sid = useId()
  const [key, setKey] = useState(defaultKey ?? options[0]?.key ?? '')
  const [pick, setPick] = useState<number | null>(null)
  const n = columns.length
  const h = headline(key)
  const cur = options.find((o) => o.key === key)
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
              {pick !== null ? readout(columns[pick], key) : h.caption}
            </p>
          </div>
        </div>
        <label className="wg-select hit44" htmlFor={sid}>
          <span className="wg-sr">Show</span>
          <select id={sid} value={key} onChange={(e) => setKey(e.target.value)}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} strokeWidth={2} aria-hidden />
        </label>
      </div>
      <div role="group" tabIndex={0} aria-label={`${title}, ${cur?.label ?? ''}. Use the left and right arrow keys to read each column.`} onKeyDown={nav} onBlur={() => setPick(null)} onPointerLeave={() => setPick(null)} className="wg-cols-plot" style={{ '--n': n } as CSSProperties}>
        <div aria-hidden className="wg-cols-axis">
          {ticks.map((t) => (
            <span key={t}>{format(t)}</span>
          ))}
        </div>
        {columns.map((c, i) => {
          const v = c.shares[key] ?? 0
          return (
            <button key={c.id} type="button" tabIndex={-1} aria-label={readout(c, key)} data-on={pick === i ? '' : undefined} className="wg-cols-col" onPointerEnter={() => setPick(i)} onClick={() => setPick(i)}>
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
      <SrTable caption={`${title}, ${cur?.label ?? ''}`} head={['Group', 'People', ...options.map((o) => o.label)]} rows={columns.map((c) => [c.name, c.n, ...options.map((o) => format(c.shares[o.key] ?? 0))])} />
    </Widget>
  )
}
