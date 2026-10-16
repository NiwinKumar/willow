import type { ProductRow, ProofTier, Seg } from './types'

/**
 * Pure helpers for the Products, product page, Compare and Categories screens (no React, so `npm test` covers
 * them). Every number they return is derived from api values (GET /v1/retailer/products[/id]); nothing is
 * invented, and a group the api suppressed stays suppressed.
 */

/** Compare holds 2 or 3 products. */
export const MAX_COMPARE = 3

/** "a,b,,a,c,d" → ["a","b","c"]: trimmed, de-duplicated, at most `max` (the ?ids= and ?sel= keys). */
export function parseIds(v: string | null | undefined, max = MAX_COMPARE): string[] {
  const out: string[] = []
  for (const raw of (v ?? '').split(',')) {
    const id = raw.trim()
    if (id && !out.includes(id)) out.push(id)
    if (out.length >= max) break
  }
  return out
}

/** Add or remove one id; adding past `max` is refused (returns the list unchanged). */
export function toggleId(ids: string[], id: string, max = MAX_COMPARE): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id)
  return ids.length >= max ? ids : [...ids, id]
}

/** Strongest first: Proven, Promising, No clear effect yet, Not enough data. */
export const TIER_ORDER: Record<ProofTier, number> = { proven: 3, promising: 2, unclear: 1, too_few: 0 }

const r2 = (v: number) => Math.round(v * 100) / 100

/** Wilson 95% interval of k of n, rounded to 2 dp exactly as the api's retailer._wilson. */
export function wilson(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 0]
  const z = 1.96
  const p = k / n
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)
  return [r2(Math.max(0, centre - half)), r2(Math.min(1, centre + half))]
}

/**
 * A segment cell's 95% interval. The api sends the rate (k/n to 2 dp) and n; k comes back as round(rate × n),
 * exact while n < 100 (segment cells are far smaller). Suppressed cells have none.
 */
export function segInterval(s: Pick<Seg, 'rate' | 'n' | 'suppressed'>): { lo: number; hi: number } | null {
  if (s.suppressed || s.rate === null || !s.n) return null
  const [lo, hi] = wilson(Math.round(s.rate * s.n), s.n)
  return { lo, hi }
}

const measured = (r: ProductRow) => r.rate !== null && r.n !== null

/**
 * The product to compare a row with by default: the highest visible-change rate among other measured products in
 * the same category that share a goal (the api's competitor set), ties by n. Null when there is none.
 */
export function rivalOf(row: ProductRow, rows: ProductRow[]): ProductRow | null {
  const goals = new Set(row.goal_ids)
  const pool = rows.filter((r) => r.product_id !== row.product_id && r.category === row.category && measured(r) && r.goal_ids.some((g) => goals.has(g)))
  pool.sort((a, b) => b.rate! - a.rate! || b.n! - a.n! || a.product.localeCompare(b.product))
  return pool[0] ?? null
}

export type BrandShare = {
  brand: string
  /** Measured products of the brand in the category. */
  products: number
  /** People with the brand's measured products in their routine (summed over products). */
  users: number
  /** users / all measured products' users in the category. */
  routine: number
  /** People with a visible change held to week 8 (summed k = rate × n over products). */
  changed: number
  /** changed / all changes in the category. */
  outcome: number
  /** outcome − routine: above zero, the brand delivers more of the category's changes than its footprint. */
  gap: number
}

/**
 * Brand share of routines vs share of outcomes in one category, from the scoreboard rows. Both shares use the
 * same set (measured products only), so a brand with an unmeasured product isn't penalised: footprint is the
 * brand's share of product users, outcomes its share of the people with a visible change by week 8.
 */
export function brandShares(rows: ProductRow[], category: string): { brands: BrandShare[]; users: number; changed: number } {
  const inCat = rows.filter((r) => r.category === category && measured(r) && r.users !== null)
  const by = new Map<string, { products: number; users: number; changed: number }>()
  for (const r of inCat) {
    const b = by.get(r.brand) ?? { products: 0, users: 0, changed: 0 }
    b.products += 1
    b.users += r.users!
    b.changed += Math.round(r.rate! * r.n!)
    by.set(r.brand, b)
  }
  const users = [...by.values()].reduce((s, b) => s + b.users, 0)
  const changed = [...by.values()].reduce((s, b) => s + b.changed, 0)
  const brands = [...by.entries()].map(([brand, b]) => {
    const routine = users ? b.users / users : 0
    const outcome = changed ? b.changed / changed : 0
    return { brand, ...b, routine: r2(routine), outcome: r2(outcome), gap: r2(outcome - routine) }
  })
  brands.sort((a, b) => b.routine - a.routine || b.outcome - a.outcome || a.brand.localeCompare(b.brand))
  return { brands, users, changed }
}

/** The scoreboard filters (all in the URL). Empty strings mean "all". */
export type RowFilter = { q?: string; brand?: string; category?: string; goal?: string; tier?: string; mineOf?: string | null }

export function filterRows(rows: ProductRow[], f: RowFilter): ProductRow[] {
  const q = (f.q ?? '').trim().toLowerCase()
  return rows.filter(
    (r) =>
      (!q || `${r.product} ${r.brand}`.toLowerCase().includes(q)) &&
      (!f.brand || r.brand === f.brand) &&
      (!f.mineOf || r.brand === f.mineOf) &&
      (!f.category || r.category === f.category) &&
      (!f.goal || r.goal_ids.includes(f.goal)) &&
      (!f.tier || r.tier === f.tier),
  )
}

/** The "what would it take" line for a Promising product (the api's to_proven), for chips and the quick look. */
export function hintOf(r: Pick<ProductRow, 'tier' | 'to_proven'>): string | undefined {
  if (r.tier !== 'promising' || !r.to_proven) return undefined
  return `What would it take: about ${r.to_proven} more ${r.to_proven === 1 ? 'person' : 'people'} at week 8 would make it Proven, if the rates hold.`
}

/** A catalog price ({amount, currency}) as "US$17"; null when the catalog has none. */
export function money(p: { amount: number; currency: string } | null | undefined): string | null {
  if (!p) return null
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: p.currency, maximumFractionDigits: 0 }).format(p.amount)
  } catch {
    return `${p.amount} ${p.currency}`
  }
}

/** Why a row has no rate, in the scoreboard's words: nobody used it, its goal isn't measured, or too few people. */
export function noDataReason(r: Pick<ProductRow, 'rate' | 'reason'>): string | null {
  if (r.rate !== null) return null
  if (r.reason === 'unused') return 'Not used yet'
  if (r.reason === 'not_measured') return 'Goal not measured'
  return 'Fewer than 10 people'
}

/**
 * The column that leads a Compare row: the index of the single highest (or lowest, for `low`) value among at
 * least two measured values. Ties and rows with fewer than two values have no leader (null).
 */
export function leaderOf(values: (number | null | undefined)[], better: 'high' | 'low' = 'high'): number | null {
  const got = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null && x.v !== undefined)
  if (got.length < 2) return null
  got.sort((a, b) => (better === 'high' ? b.v - a.v : a.v - b.v))
  return got[0].v === got[1].v ? null : got[0].i
}

/** The scoreboard's status filter: All, then each tier, with the short tab labels. */
export const TIER_TABS: { id: 'all' | ProofTier; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'proven', label: 'Proven' },
  { id: 'promising', label: 'Promising' },
  { id: 'unclear', label: 'No clear effect' },
  { id: 'too_few', label: 'Not enough data' },
]
