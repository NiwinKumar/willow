import { useState, type KeyboardEvent } from 'react'

export type SparkDay = { key: string; label: string; value: number; detail: string }

/**
 * A small daily bar series (one value per day, one ink hue, zero days drawn as a hairline stub, never hidden).
 * Hover or arrow keys pick a day and the readout above says it in words; with no pick it shows the latest day.
 * Days without a bar are still days: the axis shows the first and last date.
 */
export function Sparkbars({ days, label, height = 36 }: { days: SparkDay[]; label: string; height?: number }) {
  const [active, setActive] = useState<number | null>(null)
  if (!days.length) return null
  const max = Math.max(0, ...days.map((d) => d.value))
  const shown = days[active ?? days.length - 1]
  const move = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -days.length : e.key === 'End' ? days.length : 0
    if (!d) return
    e.preventDefault()
    setActive((a) => Math.max(0, Math.min(days.length - 1, (a ?? days.length - 1) + d)))
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p aria-live="polite" className="m-0 truncate text-proof-label text-ink-2 tnum">
        <span className="text-ink">{shown.label}</span> · {shown.detail}
      </p>
      <div
        role="group"
        tabIndex={0}
        aria-label={`${label}. ${days.length} ${days.length === 1 ? 'day' : 'days'}; use left and right arrows to read each day.`}
        onKeyDown={move}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        className="flex items-end gap-[2px] rounded-xs"
        style={{ height }}
      >
        {days.map((d, i) => {
          const h = max ? (d.value / max) * height : 0
          const on = i === (active ?? days.length - 1)
          return (
            <span key={d.key} onMouseEnter={() => setActive(i)} className="flex h-full min-w-[3px] max-w-4 flex-1 items-end">
              <span aria-hidden className={`block w-full rounded-t-[2px] transition-colors duration-150 ${d.value ? (on ? 'bg-ink' : 'bg-ink/45') : on ? 'bg-ink/50' : 'bg-line-strong'}`} style={{ height: Math.max(d.value ? 3 : 1, h) }} />
            </span>
          )
        })}
      </div>
      {days.length > 1 ? (
        <div aria-hidden className="flex justify-between text-proof-label text-ink-2 tnum">
          <span>{days[0].label}</span>
          <span>{days.at(-1)!.label}</span>
        </div>
      ) : null}
    </div>
  )
}
