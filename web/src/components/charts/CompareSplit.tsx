import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

const MIN = 5
const MAX = 95

/**
 * Before/after split (design "Photo comparison"): two stacked layers, the left one clipped to `split`%
 * with a white edge. The round handle on the edge is the control: drag it (pointer, touch) or focus it and
 * use the arrow keys, Home and End (5..95%).
 */
export function CompareSplit({ left, right, leftLabel, rightLabel, className = '' }: { left: ReactNode; right: ReactNode; leftLabel: string; rightLabel: string; className?: string }) {
  const [split, setSplit] = useState(50)
  const [dragging, setDragging] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r || !r.width) return
    setSplit(Math.min(MAX, Math.max(MIN, ((clientX - r.left) / r.width) * 100)))
  }
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    move(e.clientX)
  }
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 10 : 2
    const next = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? split - step : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? split + step : e.key === 'Home' ? MIN : e.key === 'End' ? MAX : null
    if (next === null) return
    e.preventDefault()
    setSplit(Math.min(MAX, Math.max(MIN, next)))
  }
  return (
    <div className={className}>
      <div
        ref={box}
        className="relative aspect-[4/5] overflow-hidden rounded-[32px] squircle"
        style={{
          background: 'repeating-linear-gradient(135deg, #DCD8D1 0 8px, #E6E3DD 8px 16px)',
        }}
      >
        <div className="absolute inset-0">{right}</div>
        <span className="absolute top-[18px] right-[18px] rounded-pill bg-white/80 px-2 py-1 font-mono text-[11px] text-ink-2">{rightLabel}</span>
        {/* No border on the clip: a border would shrink the left photo's box and the two would no longer line up. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${split}%` }}>
          {/* The left photo keeps the full width so both line up; only its visible part changes. */}
          <div className="absolute inset-y-0 left-0" style={{ width: `${10000 / split}%` }}>
            {left}
          </div>
          <span className="absolute top-[18px] left-[18px] rounded-pill bg-white/80 px-2 py-1 font-mono text-[11px] whitespace-nowrap text-ink-2">{leftLabel}</span>
        </div>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white" style={{ left: `${split}%` }} />
        <button
          type="button"
          role="slider"
          aria-label="Drag to compare the two photos"
          aria-orientation="horizontal"
          aria-valuemin={MIN}
          aria-valuemax={MAX}
          aria-valuenow={Math.round(split)}
          aria-valuetext={`${Math.round(split)}% ${leftLabel}`}
          onPointerDown={onDown}
          onPointerMove={(e) => dragging && move(e.clientX)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onKeyDown={onKey}
          className={`absolute top-1/2 grid size-[46px] -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full bg-white text-[14px] shadow-[0_8px_24px_rgba(0,0,0,.2)] outline-offset-2 transition-transform ${dragging ? 'scale-110 cursor-grabbing' : 'cursor-grab'}`}
          style={{ left: `${split}%` }}
        >
          <span aria-hidden>⟷</span>
        </button>
      </div>
    </div>
  )
}
