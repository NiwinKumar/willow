import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/**
 * Keeps a popover (menu, combobox list) inside the viewport: shifts it sideways when it would cross an edge (a
 * phone, a trigger near the right), and opens it upwards when there is more room above than below. Measured once
 * per open and on resize; the popover's own animation is unchanged. Returns a style to spread on the popover.
 */
export function useClampToViewport(ref: RefObject<HTMLElement | null>, open: boolean, gap = 8): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({})
  useLayoutEffect(() => {
    if (!open) {
      setStyle({})
      return
    }
    const place = () => {
      const el = ref.current
      if (!el) return
      el.style.transform = ''
      const r = el.getBoundingClientRect()
      const vw = document.documentElement.clientWidth
      const vh = window.innerHeight
      let dx = 0
      if (r.right > vw - gap) dx = vw - gap - r.right
      if (r.left + dx < gap) dx = gap - r.left
      const anchor = el.parentElement?.getBoundingClientRect()
      const below = anchor ? vh - anchor.bottom : vh
      const above = anchor ? anchor.top : 0
      const flip = r.bottom > vh - gap && above > below + 40
      setStyle({ ...(dx ? { transform: `translateX(${Math.round(dx)}px)` } : {}), ...(flip ? { top: 'auto', bottom: 'calc(100% + 6px)', maxHeight: Math.max(160, above - gap - 6) } : r.bottom > vh - gap ? { maxHeight: Math.max(160, below - gap - 6) } : {}) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, ref, gap])
  return style
}
