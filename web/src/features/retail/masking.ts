/*
 * The retailer's competitor-naming policy for brand organisations (research/finals/06 §4.2), the pure parts.
 * Other brands read "Brand A", "Brand B"… with letters from the catalog's brands in code-point order (the api's
 * retailer_ask.letters/scope_for use the same order, so Ask and the screens agree); their products read
 * "A Brand C product". The viewer's own brand keeps its name. `maskText` is the last line of defence: every file
 * that leaves Proof (CSV, evidence pack, brief) passes through it while a brand organisation is masked.
 */

/** "A", "B", … "Z", "AA", "AB" … */
export function letters(i: number): string {
  let s = ''
  let n = i
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** Unique brands in code-point order (Python's sorted(); not localeCompare, which orders case differently). */
export function brandOrder(brands: string[]): string[] {
  return [...new Set(brands)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** The masked name of a brand ("Brand C"), or the brand itself when it is the viewer's own. */
export function brandAlias(brand: string, order: string[], own: string | null): string {
  if (brand === own) return brand
  const i = order.indexOf(brand)
  return i < 0 ? 'Another brand' : `Brand ${letters(i)}`
}

export const productAlias = (brandName: string) => `A ${brandName} product`

export type NameMask = { hidden: Map<string, string>; pattern: RegExp | null }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Every other brand's name and product name, mapped to its alias. Own names are matched first and kept, so a
 * shorter competitor product name inside one of the viewer's own product names is never replaced.
 */
export function buildMask(products: { brand: string; product: string }[], own: string | null, brands?: string[]): NameMask {
  // the same brand list as the screens (useCompetitorNames), so a file and the page say the same letter
  const order = brandOrder(brands?.length ? brands : products.map((p) => p.brand))
  const hidden = new Map<string, string>()
  const kept = new Set<string>(own ? [own] : [])
  for (const b of brandOrder([...order, ...products.map((p) => p.brand)])) if (b !== own) hidden.set(b, brandAlias(b, order, own))
  for (const p of products) {
    if (!p.product) continue
    if (p.brand === own) {
      kept.add(p.product)
      continue
    }
    const alias = productAlias(brandAlias(p.brand, order, own))
    if (!hidden.has(p.product)) hidden.set(p.product, alias)
    hidden.set(`${p.brand} ${p.product}`, alias)
  }
  for (const k of kept) hidden.delete(k)
  const names = [...new Set([...hidden.keys(), ...kept])].filter((n) => n.length > 1).sort((a, b) => b.length - a.length)
  // Whole names only: not inside a longer word ("Plum" in "Plump" stays).
  const pattern = names.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu') : null
  return { hidden, pattern }
}

/** `text` with every hidden name replaced by its alias. */
export function maskText(text: string, m: NameMask | null): string {
  if (!m?.pattern) return text
  return text.replace(m.pattern, (hit) => m.hidden.get(hit) ?? hit)
}

/** The hidden names that appear in `text` (empty when none). */
export function namedOthers(text: string, m: NameMask | null): string[] {
  if (!m?.pattern) return []
  return [...new Set([...text.matchAll(m.pattern)].map((x) => x[0]).filter((x) => m.hidden.has(x)))]
}
