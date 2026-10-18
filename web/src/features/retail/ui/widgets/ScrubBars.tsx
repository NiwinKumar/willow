import { useState, type CSSProperties, type KeyboardEvent } from 'react'

import { stepKey } from './math'
import { SrTable, Widget, type WidgetMenu } from './Widget'

export type ScrubBar = { id: string; label: string; value: number; display: string; detail: string }

/**
 * Lime bars that read like a timeline: pick a bar and the ones up to it stay lit while the rest go dark, a
 * flag names the pick's value and a dashed line carries its height across. Without a pick it rests on the last bar.
 */
export function ScrubBars({
  title,
  headline,
  bars,
  caption,
  ariaLabel,
  menu,
}: {
  title: string
  /** The big figure beside the title (what the whole series adds up to, in words the caller owns). */
  headline: { value: string; unit?: string }
  bars: ScrubBar[]
  caption: (b: ScrubBar) => string
  ariaLabel: string
  menu?: WidgetMenu
}) {
  const [pick, setPick] = useState<number | null>(null)
  const n = bars.length
  const i = pick ?? n - 1
  const max = Math.max(1e-9, ...bars.map((b) => b.value))
  const key = (e: KeyboardEvent) => {
    const next = stepKey(e.key, i, n)
    if (next === null) return
    e.preventDefault()
    setPick(next)
  }
  if (!n) return null
  const pct = (b: ScrubBar) => Math.max(2, (b.value / max) * 100)
  return (
    <Widget title={title} label={ariaLabel} menu={menu} className="wg-bars">
      <p className="wg-line-val m-0">
        {headline.value}
        {headline.unit ? <span className="wg-unit ml-1 text-[.55em]">{headline.unit}</span> : null}
      </p>
      <p aria-live="polite" className="wg-line-read">
        {caption(bars[i])}
      </p>
      <div role="group" tabIndex={0} aria-label={`${title}. Use the left and right arrow keys to read each bar.`} onKeyDown={key} onBlur={() => setPick(null)} onPointerLeave={() => setPick(null)} className="wg-bars-plot">
        {bars.map((b, k) => (
          <button
            key={b.id}
            type="button"
            tabIndex={-1}
            aria-label={`${b.label}: ${b.display}`}
            data-after={k > i ? '' : undefined}
            className="wg-bars-col"
            style={{ '--i': k } as CSSProperties}
            onPointerEnter={() => setPick(k)}
            onClick={() => setPick(k)}
          >
            <i style={{ height: `${pct(b)}%` }} />
          </button>
        ))}
        <Flag bars={bars} i={i} pct={pct} />
      </div>
      <SrTable caption={title} head={['Reading', 'Value']} rows={bars.map((b) => [b.label, b.display])} />
    </Widget>
  )
}

/** The flag and the dashed line sit over the plot, positioned from the picked bar's slot. */
function Flag({ bars, i, pct }: { bars: ScrubBar[]; i: number; pct: (b: ScrubBar) => number }) {
  const n = bars.length
  // Bars share the plot's inner width equally (between the padding), so the pick's centre is a fixed fraction.
  const left = `calc(var(--wg-pad) + (100% - 2 * var(--wg-pad)) * ${(i + 0.5) / n})`
  const h = `calc((100% - 34px) * ${pct(bars[i]) / 100})`
  return (
    <>
      <span aria-hidden className="wg-bars-ref" style={{ bottom: h }} />
      <span aria-hidden className="wg-bars-flag" style={{ left, height: `calc(${h} + 26px)` }}>
        <span>{bars[i].display}</span>
      </span>
    </>
  )
}
