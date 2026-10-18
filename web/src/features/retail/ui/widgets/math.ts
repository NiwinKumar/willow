import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** The width of an element, kept current with a ResizeObserver (charts draw to their container). */
export function useWidth<T extends HTMLElement>(min = 120, initial = 320): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [min])
  return [ref, w]
}

export type XY = readonly [number, number]

const f2 = (v: number) => +v.toFixed(2)

/**
 * A smooth curve through the points that never overshoots them (monotone cubic, Fritsch–Carlson): a rising
 * series never dips between two readings, so the curve claims nothing the data does not. x must increase.
 */
export function smooth(pts: readonly XY[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${f2(pts[0][0])},${f2(pts[0][1])}`
  const dx: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0] || 1e-6)
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i])
  }
  const t: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2)
  t.push(m[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i] / m[i]
    const b = t[i + 1] / m[i]
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      t[i] = tau * a * m[i]
      t[i + 1] = tau * b * m[i]
    }
  }
  let d = `M${f2(pts[0][0])},${f2(pts[0][1])}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${f2(pts[i][0] + h)},${f2(pts[i][1] + t[i] * h)} ${f2(pts[i + 1][0] - h)},${f2(pts[i + 1][1] - t[i + 1] * h)} ${f2(pts[i + 1][0])},${f2(pts[i + 1][1])}`
  }
  return d
}

/** Index of the x closest to `px`. */
export function nearest(xs: readonly number[], px: number): number {
  let best = 0
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i
  return best
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Arrow / Home / End to move through `n` readings; null when the key is not one of them. */
export function stepKey(key: string, current: number, n: number): number | null {
  const next = key === 'ArrowRight' || key === 'ArrowDown' ? current + 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? current - 1 : key === 'Home' ? 0 : key === 'End' ? n - 1 : null
  return next === null ? null : clamp(next, 0, n - 1)
}
