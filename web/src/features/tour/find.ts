import type { TourTarget } from './types'

function visible(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || el.closest('[data-tour-ui]')) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

const area = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.width * r.height
}

/** The live element a target names (see types.ts), or null while the page hasn't drawn it yet. */
export function findTarget(t: TourTarget): HTMLElement | null {
  if (t.startsWith('css:')) return [...document.querySelectorAll(t.slice(4))].find(visible) ?? null
  if (t.startsWith('label:')) {
    const q = t.slice(6)
    return [...document.querySelectorAll('[aria-label]')].filter((el) => el.getAttribute('aria-label')!.includes(q)).find(visible) ?? null
  }
  const q = t.startsWith('text:') ? t.slice(5) : t
  const has = (el: Element) => (el.textContent ?? '').includes(q)
  const actions = [...document.querySelectorAll('button, a, [role=button], [role=tab], [role=radio], summary')].filter((el) => has(el) && visible(el))
  if (actions.length) return actions.sort((a, b) => area(a) - area(b))[0] as HTMLElement
  const any = [...document.querySelectorAll('h1, h2, h3, h4, p, li, span, div, section')].filter((el) => has(el) && visible(el))
  return (any.sort((a, b) => area(a) - area(b))[0] as HTMLElement | undefined) ?? null
}
