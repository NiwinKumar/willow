import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

/**
 * White pill on a translucent track; the pill morphs between options. role=radiogroup, arrow keys move. `glass`: the
 * design's glass track (bg-glass, blur, inset highlight) for use over a photo, compact (18px items, 44px touch area).
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label, size = 'md', glass = false, className = '' }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; size?: 'sm' | 'md'; glass?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth })
  }, [value, options.length])
  const move = (e: KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value)
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = options[(i + d + options.length) % options.length]
    onChange(next.value)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={move} className={`relative flex gap-[3px] rounded-pill ${glass ? 'glass-pill p-0.5 shadow-glass' : 'bg-canvas p-1'} ${className}`}>
      {pill ? (
        <span aria-hidden className={`absolute rounded-pill ${glass ? 'top-0.5 bottom-0.5' : 'top-1 bottom-1'} bg-white shadow-[0_2px_8px_rgba(0,0,0,.08)] transition-[left,width] duration-[600ms] ease-standard`} style={{ left: pill.x, width: pill.w }} />
      ) : null}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={`hit44 relative z-[1] flex-1 rounded-pill whitespace-nowrap text-ink ${glass ? 'min-h-[18px] px-1.5 text-[8px]' : size === 'sm' ? 'min-h-8 px-3 text-[13px]' : 'min-h-9 px-3 text-[13px]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
