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

type Seg = readonly [number, number, number, number, number, number]

/** Monotone cubic (Fritsch–Carlson) segments through the points: [c1x, c1y, c2x, c2y, x, y] from each point to the next. x must increase. */
function segments(pts: readonly XY[]): Seg[] {
  const n = pts.length
  if (n < 2) return []
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
  const out: Seg[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    out.push([pts[i][0] + h, pts[i][1] + t[i] * h, pts[i + 1][0] - h, pts[i + 1][1] - t[i + 1] * h, pts[i + 1][0], pts[i + 1][1]])
  }
  return out
}

/**
 * A smooth curve through the points that never overshoots them (monotone cubic, Fritsch–Carlson): a rising
 * series never dips between two readings, so the curve claims nothing the data does not. x must increase.
 */
export function smooth(pts: readonly XY[]): string {
  if (pts.length === 0) return ''
  let d = `M${f2(pts[0][0])},${f2(pts[0][1])}`
  for (const [a, b, c, e, x, y] of segments(pts)) d += ` C${f2(a)},${f2(b)} ${f2(c)},${f2(e)} ${f2(x)},${f2(y)}`
  return d
}

/** A closed shape between two smooth edges (a stream band): along `top` left to right, then back along `bottom`. Both need increasing x and the same xs. */
export function smoothBand(top: readonly XY[], bottom: readonly XY[]): string {
  if (top.length < 2 || bottom.length < 2) return ''
  let d = smooth(top)
  const last = bottom[bottom.length - 1]
  d += ` L${f2(last[0])},${f2(last[1])}`
  const segs = segments(bottom)
  for (let i = segs.length - 1; i >= 0; i--) {
    const [c1x, c1y, c2x, c2y] = segs[i]
    d += ` C${f2(c2x)},${f2(c2y)} ${f2(c1x)},${f2(c1y)} ${f2(bottom[i][0])},${f2(bottom[i][1])}`
  }
  return `${d} Z`
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
