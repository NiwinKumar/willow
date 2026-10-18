import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export type ScrubberTick = {
  id: string
  /** Short date under the rail ("14 Oct", or a time when a day has several). */
  short: string
  /** Full words for screen readers and the live line ("14 Oct 2026 · baseline"). */
  label: string
  kind: 'baseline' | 'rejected' | 'unfinished' | 'measured'
}

const PAD = 12

/**
 * Check-ins as ticks on a rail (the old Scrubber, drawn in the design's language): the baseline is a
 * three-bar lime cluster, a check-in with no usable photo a coral dot, an unfinished one a hollow ring. One
 * thumb, kept small: the page says which check-in is showing. Dragging follows the finger (pointer capture, grab offset kept) and moves through the check-ins as
 * it passes them; release snaps to the nearest. Arrow keys, Page Up/Down, Home and End work; the line under
 * the rail says which check-in is showing (polite live region).
 */
export function Scrubber({ ticks, index, onChange, label = 'Check-in' }: { ticks: ScrubberTick[]; index: number; onChange: (index: number) => void; label?: string }) {
  const railRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const grab = useRef(0)
  const last = useRef(index)
  const n = ticks.length
  const posFor = useCallback((i: number) => (n <= 1 ? width / 2 : PAD + (i / (n - 1)) * (width - PAD * 2)), [n, width])
  const indexFor = useCallback((px: number) => Math.min(n - 1, Math.max(0, n <= 1 ? 0 : Math.round(((px - PAD) / (width - PAD * 2)) * (n - 1)))), [n, width])

  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    last.current = index
  }, [index])

  const go = (i: number) => {
    if (i === last.current) return
    last.current = i
    onChange(i)
  }
  const clampX = (px: number) => Math.min(width - PAD, Math.max(PAD, px))
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const rail = railRef.current
    if (!rail || width === 0) return
    rail.setPointerCapture(e.pointerId)
    const px = e.clientX - rail.getBoundingClientRect().left
    const thumb = posFor(index)
    // Grabbing the thumb keeps it under the finger; tapping the rail jumps there.
    grab.current = Math.abs(px - thumb) < 22 ? px - thumb : 0
    const x = clampX(px - grab.current)
    setDrag(x)
    go(indexFor(x))
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return
    const x = clampX(e.clientX - railRef.current!.getBoundingClientRect().left - grab.current)
    setDrag(x)
    go(indexFor(x))
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return
    railRef.current?.releasePointerCapture(e.pointerId)
    go(indexFor(drag))
    setDrag(null)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, number> = { ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: n - 1, PageDown: index - 3, PageUp: index + 3 }
    if (!(e.key in map)) return
    e.preventDefault()
    go(Math.min(n - 1, Math.max(0, map[e.key])))
  }

  const current = ticks[index]
  const thumbX = drag ?? posFor(index)
  return (
    <div className="flex flex-col">
      <div
        ref={railRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={Math.max(1, n)}
        aria-valuenow={index + 1}
        aria-valuetext={current ? `${current.label}, ${index + 1} of ${n}` : ''}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative h-8 w-full cursor-grab touch-none rounded-pill outline-none select-none active:cursor-grabbing"
      >
        <span aria-hidden className="absolute top-1/2 h-0.5 -translate-y-1/2 text-ink opacity-40" style={{ left: PAD, right: PAD, backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1.4px)', backgroundSize: '7px 2px' }} />
        {width
          ? ticks.map((t, i) => (
              <span key={t.id} aria-hidden className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[2px]" style={{ left: posFor(i) }}>
                {t.kind === 'baseline' ? (
                  [0, 1, 2].map((k) => <span key={k} className="block h-2.5 w-[3px] rounded-full bg-[var(--signal-baseline)] shadow-[0_0_0_1px_rgba(18,18,18,.35)]" />)
                ) : t.kind === 'rejected' ? (
                  <span className="block size-1.5 rounded-full bg-[var(--aura-coral)]" />
                ) : t.kind === 'unfinished' ? (
                  <span className="block size-1.5 rounded-full border border-ink/50" />
                ) : (
                  <span className="block h-2 w-[2px] rounded-full bg-ink/45" />
                )}
              </span>
            ))
          : null}
        {width ? (
          <span aria-hidden className={`absolute top-1/2 grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-selected shadow-[0_4px_10px_-4px_rgba(0,0,0,.5)] ring-2 ring-white ${drag === null ? 'transition-[left] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]' : ''}`} style={{ left: thumbX }}>
            <span className="size-1.5 rounded-full bg-white" />
          </span>
        ) : null}
      </div>
      <span aria-live="polite" className="sr-only">
        {current ? current.label : ''}
      </span>
    </div>
  )
}
