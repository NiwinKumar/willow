/**
 * Home fitted to the screen (desktop): when the window is tall enough and the cards sit in one row, Home is
 * exactly one screen high and every card in the row under the hero takes the height it is given. Cards read
 * `HomeFit` to switch their lists from "show N" to "show what fits", via `useFitCount`.
 */
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

export const HomeFit = createContext(false)
export const useHomeFit = () => useContext(HomeFit)

/**
 * How many of `total` items fit a list whose height comes from its card (the list is flex-basis 0, so what it
 * draws never makes the card taller). Starts from `start` and settles in a few renders: one item fewer when
 * the drawn ones overflow, one more when there is room for it, never retrying a count that overflowed at
 * this height or less (so it never flickers between two counts). At least `min`. Re-measured when the list's
 * size changes; a render only when the count changes.
 */
export function useFitCount<T extends HTMLElement = HTMLElement>(total: number, { enabled, start, min = 1 }: { enabled: boolean; start: number; min?: number }) {
  const ref = useRef<T>(null)
  const [n, setN] = useState(Math.min(total, start))
  const failed = useRef(new Map<number, number>())
  const width = useRef(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    // The drawn items' layout bottom (offsetTop/offsetHeight ignore transforms, so a row still rising in is
    // not read as overflow); the list must be their offset parent (position: relative).
    const bottom = () => {
      let b = 0
      for (const c of Array.from(el.children)) if (c instanceof HTMLElement && c.offsetParent === el) b = Math.max(b, c.offsetTop + c.offsetHeight)
      return b
    }
    const check = () => {
      const h = el.clientHeight
      // a new width wraps the items differently: what overflowed before may fit now
      if (el.clientWidth !== width.current) {
        width.current = el.clientWidth
        failed.current.clear()
      }
      const over = bottom() > h + 1
      setN((cur) => {
        const c = Math.min(cur, total)
        if (over && c > min) {
          failed.current.set(c, h)
          return c - 1
        }
        const bad = failed.current.get(c + 1)
        if (c < total && !over && (bad === undefined || h > bad)) return c + 1
        return c
      })
    }
    check()
    // flushSync (Home.tsx useFitScreen): a new count lands before a page morph captures its new layout.
    const ro = new ResizeObserver(() => flushSync(check))
    ro.observe(el)
    // and every drawn item: one growing (a font arriving, a flag added) can overflow a list that kept its size
    for (const c of Array.from(el.children)) ro.observe(c)
    return () => ro.disconnect()
  })
  return { ref, n: enabled ? Math.max(Math.min(min, total), Math.min(n, total)) : Math.min(start, total) }
}
