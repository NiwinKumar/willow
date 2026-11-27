import { useEffect, useRef, useState } from 'react'

import { useReducedMotion } from '../../lib/useReducedMotion'

/**
 * A number that arrives by counting from where it started (0, or the value it replaces) to its final value,
 * easing out over `duration` ms. In the dot-matrix face the digits flicker into place like a departures board,
 * which is the one place Willow lets a number move: once, on arrival, never in a loop.
 * The spoken text is always the final value (the count is aria-hidden). Reduced motion: the final value at once.
 */
export function RollingNumber({ value, format, from = 0, duration = 900, delay = 0, className = '' }: {
  value: number
  /** The exact text for a value (units, signs and decimals are the caller's; the count never invents digits). */
  format: (v: number) => string
  from?: number
  duration?: number
  delay?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(from)
  // The value on screen right now, so a change mid-count carries on from where it is (and a development
  // double-mount still counts: nothing is marked done before the count has run).
  const at = useRef(from)
  useEffect(() => {
    const start = at.current
    if (reduce || start === value) {
      at.current = value
      setShown(value)
      return
    }
    let raf = 0
    let t0 = 0
    const tick = (now: number) => {
      if (!t0) t0 = now
      const p = Math.min(1, (now - t0) / duration)
      const e = 1 - Math.pow(1 - p, 3)
      at.current = p < 1 ? start + (value - start) * e : value
      setShown(at.current)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick)
    }, delay)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [value, duration, delay, reduce])
  const final = format(value)
  const text = shown === value ? final : format(shown)
  return (
    <span className={`tnum ${className}`}>
      <span aria-hidden>{text}</span>
      <span className="sr-only">{final}</span>
    </span>
  )
}
