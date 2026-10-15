import { useId, useState, type ReactNode } from 'react'

/**
 * Before/after split (design "Photo comparison"): two stacked layers, the left one clipped to `split`%
 * with a white edge and a round handle; a range input drives it (5..95%), so it works by keyboard too.
 */
export function CompareSplit({ left, right, leftLabel, rightLabel, className = '' }: { left: ReactNode; right: ReactNode; leftLabel: string; rightLabel: string; className?: string }) {
  const [split, setSplit] = useState(50)
  const id = useId()
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-[32px] squircle" style={{ background: 'repeating-linear-gradient(135deg, #DCD8D1 0 8px, #E6E3DD 8px 16px)' }}>
        <div className="absolute inset-0">{right}</div>
        <span className="absolute top-[18px] right-[18px] rounded-pill bg-white/80 px-2 py-1 font-mono text-[11px] text-ink-2">{rightLabel}</span>
        {/* No border on the clip: a border would shrink the left photo's box and the two would no longer line up. */}
        <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${split}%` }}>
          {/* The left photo keeps the full width so both line up; only its visible part changes. */}
          <div className="absolute inset-y-0 left-0" style={{ width: `${10000 / split}%` }}>
            {left}
          </div>
          <span className="absolute top-[18px] left-[18px] rounded-pill bg-white/80 px-2 py-1 font-mono text-[11px] whitespace-nowrap text-ink-2">{leftLabel}</span>
        </div>
        <span aria-hidden className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white" style={{ left: `${split}%` }} />
        <span aria-hidden className="absolute top-1/2 grid size-[46px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[14px] shadow-[0_8px_24px_rgba(0,0,0,.2)]" style={{ left: `${split}%` }}>
          ⟷
        </span>
      </div>
      <label htmlFor={id} className="flex flex-col gap-1.5 px-2.5 pb-1.5 text-[14px] text-ink-2">
        Drag to compare
        <input id={id} type="range" min={5} max={95} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="min-h-8 w-full accent-[var(--action-selected)]" aria-valuetext={`${split}% ${leftLabel}`} />
      </label>
    </div>
  )
}
