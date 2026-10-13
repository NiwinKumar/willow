import { motion, useMotionValue, useReducedMotion, animate } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Session } from '../data/types'
import { fmtDate, fmtHours } from '../lib/format'

type Props = {
  sessions: Session[]
  index: number
  onChange: (index: number) => void
  outsideCount?: (s: Session) => number
  compact?: boolean
}

/**
 * Sessions as ticks on a rail, the baseline as a five-tick cluster, one thumb. Drag follows the
 * finger 1:1 (pointer capture, grab offset kept), release snaps to the nearest tick with a
 * critically damped spring and the pointer's velocity. Arrow keys, Home and End work. Live region
 * announces the session and how many metrics sit outside their band.
 */
export function Scrubber({ sessions, index, onChange, outsideCount, compact = false }: Props) {
  const reduce = useReducedMotion()
  const railRef = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState(false)
  const n = sessions.length
  const pad = 14
  const posFor = useCallback((i: number) => (n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2)), [n, width])
  const indexFor = useCallback((px: number) => (n <= 1 ? 0 : Math.round(((px - pad) / (width - pad * 2)) * (n - 1))), [n, width])

  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (dragging || width === 0) return
    const target = posFor(index)
    if (reduce) x.set(target)
    else animate(x, target, { type: 'spring', visualDuration: 0.3, bounce: 0 })
  }, [index, width, dragging, posFor, x, reduce])

  const grab = useRef(0)
  const lastIdx = useRef(index)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current
    if (!rail) return
    rail.setPointerCapture(e.pointerId)
    const rect = rail.getBoundingClientRect()
    const px = e.clientX - rect.left
    const thumb = x.get()
    grab.current = Math.abs(px - thumb) < 22 ? px - thumb : 0
    setDragging(true)
    const nx = Math.min(width - pad, Math.max(pad, px - grab.current))
    x.set(nx)
    const i = Math.min(n - 1, Math.max(0, indexFor(nx)))
    if (i !== lastIdx.current) {
      lastIdx.current = i
      onChange(i)
    }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const rect = railRef.current!.getBoundingClientRect()
    const nx = Math.min(width - pad, Math.max(pad, e.clientX - rect.left - grab.current))
    x.set(nx)
    const i = Math.min(n - 1, Math.max(0, indexFor(nx)))
    if (i !== lastIdx.current) {
      lastIdx.current = i
      onChange(i)
    }
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    railRef.current?.releasePointerCapture(e.pointerId)
    setDragging(false)
    const i = Math.min(n - 1, Math.max(0, indexFor(x.get())))
    lastIdx.current = i
    onChange(i)
    if (reduce) x.set(posFor(i))
    else animate(x, posFor(i), { type: 'spring', visualDuration: 0.3, bounce: 0, velocity: x.getVelocity() })
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: n - 1, PageDown: index - 3, PageUp: index + 3 }
    if (e.key in map) {
      e.preventDefault()
      const i = Math.min(n - 1, Math.max(0, map[e.key]))
      lastIdx.current = i
      onChange(i)
    }
  }
  const current = sessions[index]
  const labelFor = (s: Session) => (s.hours_since_baseline !== undefined ? fmtHours(s.hours_since_baseline) : s.is_baseline ? 'Baseline' : fmtDate(s.created_at))
  const outside = current && outsideCount ? outsideCount(current) : 0

  return (
    <div className={`w-full ${compact ? '' : 'px-5 sm:px-8'}`}>
      <div
        ref={railRef}
        role="slider"
        tabIndex={0}
        aria-label="Session"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, n - 1)}
        aria-valuenow={index}
        aria-valuetext={current ? `${labelFor(current)}${outside ? `, ${outside} outside their noise band` : ''}` : ''}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative h-14 w-full cursor-grab touch-none rounded-(--radius-control) outline-none focus-visible:ring-2 focus-visible:ring-signal-500 active:cursor-grabbing"
      >
        <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 bg-noise-500/50" />
        {sessions.map((s, i) => {
          const px = posFor(i)
          const low = s.result && !s.result.quality.passed
          return (
            <div key={s.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: px }}>
              {s.is_baseline ? (
                <div className="flex items-center gap-[3px]" aria-hidden>
                  {[0, 1, 2, 3, 4].map((k) => (
                    <span key={k} className="block h-2.5 w-[3px] rounded-full bg-noise-500" />
                  ))}
                </div>
              ) : (
                <span aria-hidden className={`block h-3 w-[3px] rounded-full ${low ? 'bg-warn' : 'bg-noise-500'}`} />
              )}
              {s.deviation ? <span aria-hidden className="absolute -top-3 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[4px] border-b-[6px] border-x-transparent border-b-warn" /> : null}
            </div>
          )
        })}
        <motion.div
          aria-hidden
          style={{ x, left: 0 }}
          className="absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text shadow-[0_1px_2px_oklch(0.24_0.018_130/0.2)] ring-2 ring-surface"
        >
          <span className="absolute inset-[7px] rounded-full bg-surface" />
        </motion.div>
      </div>
      <div className="flex items-baseline justify-between font-mono text-[12px] text-text-3">
        <span>{sessions[0] ? labelFor(sessions[0]) : ''}</span>
        <span className="text-text" aria-live="polite">
          {current ? labelFor(current) : ''}
          {current?.note ? <span className="ml-2 font-sans text-text-2">· {current.note}</span> : null}
        </span>
        <span>{sessions[n - 1] && n > 1 ? labelFor(sessions[n - 1]) : ''}</span>
      </div>
    </div>
  )
}
