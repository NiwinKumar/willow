import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Wisp's chat surfaces growing instead of jumping (transform/clip only, no layout per frame):
 * - the "thinking" bubble turns into the answer's bubble: the answer's bubble opens out of the thinking
 *   bubble's size (Thinking notes it with `noteThinking`);
 * - an answer revealed block by block opens downward to each new block instead of its edge jumping.
 * Both are a clip-path reveal on the bubble, on the panel's spring curve. Reduced motion: none.
 */

const SPRING = 'cubic-bezier(.32, .72, 0, 1)'
let thinking: { w: number; h: number } | null = null

/** A ref for the thinking bubble: its size as it goes (the answer grows from it). */
export function noteThinking(el: HTMLElement | null) {
  if (!el) return
  // React 19 runs this as the bubble is removed, before it leaves the page: its last size
  return () => {
    const r = el.getBoundingClientRect()
    if (r.width) thinking = { w: r.width, h: r.height }
  }
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Opens `ref`'s box from its previous size (or, for a fresh answer, the thinking bubble's) to its new size
 * whenever `key` changes and the box grew. `radius` is the bubble's own corner radius, kept while it opens.
 */
export function useGrow(ref: RefObject<HTMLElement | null>, key: unknown, fresh: boolean, radius: string) {
  const last = useRef<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const from = last.current ?? (fresh ? thinking : null)
    if (!last.current && fresh) thinking = null
    last.current = { w: r.width, h: r.height }
    if (!from || reduced() || typeof el.animate !== 'function') return
    const dx = Math.max(0, r.width - from.w)
    const dy = Math.max(0, r.height - from.h)
    if (dx < 2 && dy < 2) return
    el.animate([{ clipPath: `inset(0px ${dx}px ${dy}px 0px round ${radius})` }, { clipPath: `inset(0px 0px 0px 0px round ${radius})` }], {
      duration: dx > 40 ? 460 : 340,
      easing: SPRING,
    })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- only when the content changes
}
