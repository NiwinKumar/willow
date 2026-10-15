import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

/** White pill on a translucent track; the pill morphs between options. role=radiogroup, arrow keys move. */
export function SegmentedControl<T extends string>({ options, value, onChange, label, size = 'md', className = '' }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; size?: 'sm' | 'md'; className?: string }) {
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
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={move} className={`relative flex gap-[3px] rounded-pill bg-canvas p-1 ${className}`}>
      {pill ? (
        <span aria-hidden className="absolute top-1 bottom-1 rounded-pill bg-white shadow-[0_2px_8px_rgba(0,0,0,.08)] transition-[left,width] duration-[600ms] ease-standard" style={{ left: pill.x, width: pill.w }} />
      ) : null}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={`relative z-[1] flex-1 rounded-pill px-3 whitespace-nowrap text-ink ${size === 'sm' ? 'min-h-8 text-[13px]' : 'min-h-9 text-[13px]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
