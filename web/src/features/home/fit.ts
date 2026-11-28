/**
 * Home fitted to the screen (desktop): when the window is tall enough and the cards sit in one row, Home is
 * exactly one screen high and every card in the row under the hero takes the height it is given. Cards read
 * `HomeFit` to switch their lists from "show N" to "show what fits", via `useFitCount`.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'

export const HomeFit = createContext(false)
export const useHomeFit = () => useContext(HomeFit)

/** An item a fitted list draws but does not show (it is still measured: see useFitCount). */
export const FIT_HIDDEN: CSSProperties = { display: 'none' }

/** How long after a card mounts its rows still rise in with it; a row shown later (a re-fit) just appears. */
const INTRO_MS = 1100

/**
 * How many of `total` items fit a list whose height comes from its card (the list is flex-basis 0 with
 * overflow hidden, so what it draws never makes the card taller). The list renders all `total` items as its
 * direct children and hides those from `n` on (`FIT_HIDDEN`); every measure shows them all for a moment at
 * their natural height (not grown into free space), reads where each one ends, and keeps the leading ones
 * that end inside the list. One measure gives the final count (no stepping one item per render), so the
 * count is settled in the same layout pass that changed the list's size: before paint, and before a page
 * morph (components/shell/morph.ts) captures the new layout. Zero when not even the first one fits (the card says how many are elsewhere).
 * Re-measured after every render and when the list or an item changes size; a render only when the count
 * changes. `intro`: true while the card is still rising in (rows shown later appear without their rise).
 * `least`: the first item's natural height, the list's least height (style it as the list's min-height: a
 * card then never gets shorter than its chrome plus one row, and Home scrolls instead; Home.tsx useFitScreen).
 */
export function useFitCount<T extends HTMLElement = HTMLElement>(total: number, { enabled, start }: { enabled: boolean; start: number }) {
  const ref = useRef<T>(null)
  const [n, setN] = useState(Math.min(total, start))
  const [intro, setIntro] = useState(true)
  const [least, setLeast] = useState(0)
  useEffect(() => {
    const t = window.setTimeout(() => setIntro(false), INTRO_MS)
    return () => window.clearTimeout(t)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const measure = () => {
      const items = Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement)
      const was = items.map((c) => [c.style.display, c.style.flexGrow])
      for (const c of items) {
        c.style.display = ''
        c.style.flexGrow = '0'
      }
      // Every item at its own height; offsetTop/offsetHeight ignore transforms, so a row still rising in is read
      // where it lands. The list must be their offset parent (position: relative).
      const h = el.clientHeight
      let fit = 0
      for (const c of items) {
        if (c.offsetParent !== el || c.offsetTop + c.offsetHeight > h + 1) break
        fit++
      }
      const first = items[0]?.offsetHeight ?? 0
      items.forEach((c, i) => {
        c.style.display = was[i][0]
        c.style.flexGrow = was[i][1]
      })
      return { fit: Math.min(fit, total), first }
    }
    const check = () => {
      const { fit, first } = measure()
      setN((cur) => (cur === fit ? cur : fit))
      setLeast((cur) => (cur === first ? cur : first))
    }
    check()
    // flushSync: a new count lands in the same frame as the resize that caused it (Home.tsx useFitScreen).
    const ro = new ResizeObserver(() => flushSync(check))
    ro.observe(el)
    // and every item: one growing (a font arriving, a flag added) can overflow a list that kept its size
    for (const c of Array.from(el.children)) ro.observe(c)
    return () => ro.disconnect()
  })
  return { ref, n: enabled ? Math.min(n, total) : Math.min(start, total), intro, least: enabled ? least : 0 }
}
