import { useEffect, useRef, useState } from 'react'

/**
 * True once the element has been on screen (and stays true). Cards below the fold hold their entrance
 * until the person scrolls to them, so the motion is seen instead of finishing off screen.
 * Without IntersectionObserver (old browsers, tests) everything counts as seen.
 */
export function useInViewOnce<T extends HTMLElement>(margin = '0px 0px -10% 0px'): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: margin, threshold: 0.12 },
    )
    io.observe(el)
    // A card the observer never reports (a hidden tab, a print, an odd layout) still shows after a moment.
    const fallback = window.setTimeout(() => {
      setSeen(true)
      io.disconnect()
    }, 1600)
    return () => {
      io.disconnect()
      window.clearTimeout(fallback)
    }
  }, [seen, margin])
  return [ref, seen]
}
