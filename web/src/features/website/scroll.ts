/** Landing scroll behaviour from the design: a quintic glide to a section, and sections that rise into view. */

/** Landing sections in page order (the rail, the reveal and #links use these ids). */
export const SECTIONS = ['top', 'ways', 'how', 'science', 'limits', 'fairness', 'privacy'] as const

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

let glideRaf = 0

/**
 * Glide to a section (instant under reduced motion) and put its id in the address bar without a jump.
 * `instant` (opening at a section: /science, #how) jumps and leaves the address as it is.
 */
export function glide(id: string, instant = false) {
  const el = document.getElementById(id)
  if (!el) return
  const from = window.scrollY
  const max = document.documentElement.scrollHeight - window.innerHeight
  const to = Math.max(0, Math.min(el.getBoundingClientRect().top + from - (id === 'top' ? 0 : 24), max))
  // Keep the router's own history state; only the hash changes.
  if (!instant) window.history.replaceState(window.history.state, '', id === 'top' ? window.location.pathname + window.location.search : `#${id}`)
  cancelAnimationFrame(glideRaf)
  if (instant || reduced()) {
    window.scrollTo(0, to)
    return
  }
  const dist = Math.abs(to - from)
  const dur = Math.min(1500, 650 + dist * 0.25)
  const t0 = performance.now()
  const ease = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2)
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / dur)
    window.scrollTo(0, from + (to - from) * ease(t))
    if (t < 1) glideRaf = requestAnimationFrame(step)
  }
  glideRaf = requestAnimationFrame(step)
}

type Held = HTMLElement & { __wHold?: Animation | null; __wDelay?: number }

/**
 * Scroll reveal: the children of each section below the fold are held hidden (risen 48px, blurred) and
 * revealed with a 110 ms stagger when they come into view. Returns a cleanup. Off under reduced motion.
 */
export function setupReveal(ids: string[]): () => void {
  if (reduced() || typeof IntersectionObserver === 'undefined') return () => {}
  const els: Held[] = []
  for (const id of ids) {
    const s = document.getElementById(id)
    if (!s) continue
    const f = s.firstElementChild
    // A section with one wrapper of a few cards reveals the cards one by one.
    const kids = s.children.length === 1 && f && f.children.length > 1 && f.children.length < 9 ? [...f.children] : [...s.children]
    kids.forEach((k, i) => {
      const el = k as Held
      el.__wDelay = i * 110
      els.push(el)
    })
  }
  const hidden = { opacity: 0, transform: 'translateY(48px) scale(.985)', filter: 'blur(10px)' }
  for (const el of els) if (el.getBoundingClientRect().top > window.innerHeight) el.__wHold = el.animate([hidden, hidden], { duration: 1, fill: 'forwards' })
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const el = en.target as Held
        if (!en.isIntersecting || !el.__wHold) continue
        io.unobserve(el)
        el.animate([hidden, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: 1000, delay: el.__wDelay, easing: 'cubic-bezier(.2,.75,.15,1)', fill: 'backwards' })
        el.__wHold.cancel()
        el.__wHold = null
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  )
  for (const el of els) if (el.__wHold) io.observe(el)
  return () => {
    io.disconnect()
    for (const el of els) {
      el.__wHold?.cancel()
      el.__wHold = null
    }
  }
}
