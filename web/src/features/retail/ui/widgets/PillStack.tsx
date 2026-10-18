import { useState, type CSSProperties } from 'react'

import { SrTable, Widget } from './Widget'

export type StackSegment = { id: string; label: string; value: number; display: string }

/**
 * One whole split into pills whose widths are the parts. Pick a pill (hover, focus or tap) and the figure at the
 * top right and the caption say which part it is; a notch marks the pick. Without a pick the widest part
 * (or `defaultId`) is read out.
 */
export function PillStack({ title, segments, defaultId, caption, ariaLabel }: { title: string; segments: StackSegment[]; defaultId?: string; caption: (s: StackSegment) => string; ariaLabel: string }) {
  const widest = segments.reduce((a, s) => (s.value > a.value ? s : a), segments[0])
  const rest = defaultId ? (segments.find((s) => s.id === defaultId) ?? widest) : widest
  const [pick, setPick] = useState<string | null>(null)
  const on = segments.find((s) => s.id === pick) ?? rest
  if (!segments.length || !on) return null
  return (
    <Widget label={ariaLabel} className="wg-stack" head={false}>
      <div className="wg-stack-head">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="wg-title !pt-0">{title}</h3>
          <p aria-live="polite" className="wg-cap">
            {caption(on)}
          </p>
        </div>
        <p className="wg-stack-val m-0">{on.display}</p>
      </div>
      <div className="wg-stack-track" onPointerLeave={() => setPick(null)}>
        {segments.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === on.id}
            aria-label={`${s.label}: ${s.display}`}
            title={`${s.label}: ${s.display}`}
            data-on={s.id === on.id ? '' : undefined}
            className="wg-stack-pill"
            style={{ '--v': Math.max(s.value, 0.0001), '--i': i } as CSSProperties}
            onPointerEnter={() => setPick(s.id)}
            onFocus={() => setPick(s.id)}
            onBlur={() => setPick(null)}
            onClick={() => setPick(s.id)}
          />
        ))}
      </div>
      <SrTable caption={title} head={['Part', 'Value']} rows={segments.map((s) => [s.label, s.display])} />
    </Widget>
  )
}
