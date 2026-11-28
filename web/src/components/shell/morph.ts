import { flushSync } from 'react-dom'

/**
 * The page making room for Wisp's panel (or for the sidebar) as one layout step the browser morphs: a view
 * transition (index.css "Page morph") in which every card in view is its own shared element, so each card
 * glides and resizes from its old place to its new one while its old and new contents cross-fade inside it.
 * The page itself never re-lays out frame by frame, and nothing re-renders per frame.
 *
 * The panel and the Wisp button are named too (wisp-panel, wisp-fab) so they draw above the moving cards and
 * stay live (their own transitions keep playing).
 *
 * Interrupting: a view transition cannot reverse mid-flight, so a second toggle while the page is still moving
 * applies its visible part (the panel growing or shrinking) at once and lets the page land before it moves
 * back. Nothing jumps. Only where the layout really changes (the panel sits beside the page from 1280px; the
 * sidebar from 900px); elsewhere, and with reduced motion, it just updates.
 */

export const MORPH_OPEN_MS = 480
export const MORPH_CLOSE_MS = 380

type Kind = 'open' | 'close' | 'side'
type VT = { finished: Promise<unknown> }
type Doc = Document & { startViewTransition?: (cb: () => void) => VT }

let moving: VT | null = null
let pending: { layout: () => void; kind: Kind } | null = null

/** `visual`: what may change at any moment (the panel's own state). `layout`: what moves the page. */
export function morph(visual: () => void, layout: () => void, kind: Kind) {
  const d = document as Doc
  const changesLayout = window.matchMedia(kind === 'side' ? '(min-width: 900px)' : '(min-width: 1280px)').matches
  if (!d.startViewTransition || !changesLayout || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    visual()
    layout()
    return
  }
  if (moving) {
    // still landing: the panel answers now, the page follows once it has landed (the latest wish wins)
    visual()
    pending = { layout, kind }
    return
  }
  run(d, () => {
    visual()
    layout()
  }, kind)
}

function run(d: Doc, update: () => void, kind: Kind) {
  const page = document.querySelector<HTMLElement>('[data-willow-page]')
  const named = page ? nameCards(page) : []
  const html = document.documentElement
  html.dataset.morph = kind
  const vt = d.startViewTransition!(() => flushSync(update))
  moving = vt
  void vt.finished.finally(() => {
    for (const el of named) {
      el.style.viewTransitionName = ''
      el.style.removeProperty('view-transition-class')
    }
    delete html.dataset.morph
    moving = null
    const next = pending
    pending = null
    if (next) run(d, next.layout, next.kind)
  })
}

/**
 * The cards in view: the outermost elements inside the page that draw a rounded surface of their own
 * (a background and a corner radius), at least 120 × 60. Each becomes a shared element for this one morph.
 */
function nameCards(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  const vh = window.innerHeight
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (!(c instanceof HTMLElement) || out.length >= 40) continue
      const r = c.getBoundingClientRect()
      if (r.width < 1 || r.height < 1 || r.bottom < -40 || r.top > vh + 40) continue
      const cs = getComputedStyle(c)
      if (cs.position === 'fixed' || cs.viewTransitionName !== 'none') continue
      const surface = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none'
      if (surface && parseFloat(cs.borderTopLeftRadius) >= 12 && r.width >= 120 && r.height >= 60) {
        out.push(c)
        continue
      }
      walk(c)
    }
  }
  walk(root)
  out.forEach((el, i) => {
    el.style.viewTransitionName = `willow-card-${i}`
    el.style.setProperty('view-transition-class', 'willow-card')
  })
  return out
}
