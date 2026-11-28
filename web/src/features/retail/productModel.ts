import type { ProductRow, ProofTier, Seg } from './types'
import { pct, pts } from './ui/format.ts'

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

/** A price tier in words ("Mid"); null when the catalog has no checked price (most index products). */
export function priceTierWord(t: ProductRow['price_tier'] | undefined): string | null {
  return t ? `${t[0].toUpperCase()}${t.slice(1)}` : null
}

/** The facts under a product's name ("Serums · Mid price · 30 ml · US$17"): only the ones the catalog has. */
export function productFacts(p: Pick<ProductRow, 'category_label' | 'price_tier'> & { size?: string | null; price?: { amount: number; currency: string } | null }): string {
  const tier = priceTierWord(p.price_tier)
  return [p.category_label, tier && `${tier} price`, p.size, money(p.price)].filter(Boolean).join(' · ')
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

/** The spotlight: highest lift lower bound among Proven rows, else the Promising row closest to Proven. */
export function spotlightOf(rows: ProductRow[]): ProductRow | null {
  const proven = rows.filter((r) => r.tier === 'proven' && r.lift_lo !== null).sort((a, b) => (b.lift_lo ?? 0) - (a.lift_lo ?? 0))
  if (proven[0]) return proven[0]
  const promising = rows.filter((r) => r.tier === 'promising').sort((a, b) => (a.to_proven ?? 1e9) - (b.to_proven ?? 1e9) || (b.lift ?? 0) - (a.lift ?? 0))
  return promising[0] ?? null
}


/* ───────────── The product page's lead: the verdict, who it works for, where it sits in its category ───────────── */

/**
 * The group a product works best for: the largest lift over non-users of the same group (rate − base rate, above
 * zero), ties by n, among groups the api did not suppress with 10+ people. The same rule as the api's "Promote to
 * <skin> skin" next step (proof_ai.py), so the page never recommends two groups. Only skin type and goal are passed
 * in (tone bands are never ranked). Null when no group beats its own non-users.
 */
export function bestSeg(segs: Seg[], min = 10): Seg | null {
  const ok = segs.filter((s) => !s.suppressed && s.rate !== null && s.n !== null && s.n >= min && s.base_rate !== null && s.rate > s.base_rate)
  ok.sort((a, b) => b.rate! - b.base_rate! - (a.rate! - a.base_rate!) || b.n! - a.n! || a.label.localeCompare(b.label))
  return ok[0] ?? null
}

/**
 * The verdict in one sentence, in the tier's words: what the evidence says against people with the same goals who
 * don't use it. Numbers come from the row only (rates and lift as the api sent them).
 */
export function verdictLine(p: Pick<ProductRow, 'tier' | 'rate' | 'base_rate' | 'lift' | 'to_proven' | 'n' | 'reason'>): string {
  if (p.rate === null || p.tier === 'too_few') {
    if (p.reason === 'not_measured') return 'Its goals have no Willow measure, so no outcome is measured.'
    if (p.reason === 'unused') return 'No Willow users have it in their routine yet, so there is nothing to measure.'
    return 'Collecting: fewer than 10 people have reached week 8 with it.'
  }
  const vs = p.base_rate !== null ? ` (${pct(p.rate)} against ${pct(p.base_rate)})` : ''
  if (p.tier === 'proven') return `Linked to a held visible change: ${pts(p.lift)} over people with the same goals who don’t use it.`
  if (p.tier === 'promising') {
    const more = p.to_proven ? ` About ${p.to_proven} more ${p.to_proven === 1 ? 'person' : 'people'} at week 8 would settle it, if the rates hold.` : ''
    return `Ahead of people with the same goals${vs}, but the interval still reaches zero.${more}`
  }
  return `People using it change at about the same rate as people with the same goals who don’t${vs}.`
}

/** Where a product sits among the other measured products of its category (the api's competitor rows). */
export type CategorySpot = { self: number; median: number; delta: number; others: number[]; min: number; max: number }

/**
 * This product's rate against the median of the other measured products in its category that share a goal.
 * Null when the product has no rate or fewer than two others are measured (a median of one is just a rival).
 */
export function categorySpot(rows: { rate: number | null; is_self?: boolean }[]): CategorySpot | null {
  const self = rows.find((r) => r.is_self)?.rate ?? null
  const others = rows.filter((r) => !r.is_self && r.rate !== null).map((r) => r.rate!)
  if (self === null || others.length < 2) return null
  const s = [...others].sort((a, b) => a - b)
  const mid = s.length / 2
  const median = r2(s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2)
  return { self, median, delta: r2(self - median), others: s, min: Math.min(self, s[0]), max: Math.max(self, s[s.length - 1]) }
}

/**
 * Where a product stands on promotion, from this organisation's campaigns (sample ones included: a sample that ran
 * is history the page must not hide). `running`: active; `paused`; `ended`: the latest finished one, with its
 * adoption lift against the randomised holdout when it was measured. Absent: never promoted.
 */
export type Promo = { state: 'running' | 'paused' | 'ended'; lift: number | null; campaignId: string; sample: boolean }

export function promoHistory(campaigns: { id: string; product_id: string; status: 'active' | 'paused' | 'ended'; created_at: string; sample?: boolean; stats: { incrementality: { lift: number } | null } }[]): Map<string, Promo> {
  const rank = { running: 3, paused: 2, ended: 1 } as const
  const m = new Map<string, Promo & { at: string }>()
  for (const c of campaigns) {
    const state = c.status === 'active' ? 'running' : c.status
    const v = { state, lift: c.stats.incrementality?.lift ?? null, campaignId: c.id, sample: Boolean(c.sample), at: c.created_at } as Promo & { at: string }
    const cur = m.get(c.product_id)
    if (!cur || rank[state] > rank[cur.state] || (rank[state] === rank[cur.state] && c.created_at > cur.at)) m.set(c.product_id, v)
  }
  return new Map([...m].map(([k, { at: _at, ...v }]) => [k, v]))
}

/** The promotion note a product row carries: "Campaign running", "Campaign paused", "Promoted before, +8 pts adoption" (the finished campaign's lift against its holdout). */
export function promoNote(p: Promo | undefined): string | null {
  if (!p) return null
  if (p.state === 'running') return 'Campaign running'
  if (p.state === 'paused') return 'Campaign paused'
  return p.lift !== null ? `Promoted before, ${pts(p.lift)} adoption` : 'Promoted before'
}

/** The Products page's lead: what to act on in the rows in view. */
export type ProductsLead = {
  /** Proven with no campaign running or paused, strongest lower bound first. Some may have run one before. */
  toPromote: ProductRow[]
  /** Of toPromote, how many ran a campaign before (finished; offer "run again", never "never promoted"). */
  ranBefore: number
  /** Proven in total (to tell "all promoted" from "none Proven"). */
  proven: number
  /** Promising, closest to Proven first (the api's to_proven; unknown last). */
  close: ProductRow[]
  /** Measured, but users change about as much as non-users. */
  unclear: ProductRow[]
}

export function productsLead(rows: ProductRow[], promo: ReadonlyMap<string, Pick<Promo, 'state'>>): ProductsLead {
  const proven = rows.filter((r) => r.tier === 'proven')
  const toPromote = proven.filter((r) => (promo.get(r.product_id)?.state ?? 'ended') === 'ended').sort((a, b) => (b.lift_lo ?? -1) - (a.lift_lo ?? -1) || (b.n ?? 0) - (a.n ?? 0))
  const ranBefore = toPromote.filter((r) => promo.has(r.product_id)).length
  const close = rows.filter((r) => r.tier === 'promising').sort((a, b) => (a.to_proven ?? 1e9) - (b.to_proven ?? 1e9) || (b.lift ?? 0) - (a.lift ?? 0))
  const unclear = rows.filter((r) => r.tier === 'unclear').sort((a, b) => (b.users ?? 0) - (a.users ?? 0))
  return { toPromote, ranBefore, proven: proven.length, close, unclear }
}

/** Rows drawn per step on long tables: enough to scan, small enough to open without a stall. */
export const PAGE_ROWS = 100

/**
 * What the last week of the curve adds, in points, for users and the comparison group. The outcome counts a change
 * that is present at the last reading, so a change first seen at that reading (one reading, not yet seen twice)
 * counts too: the curve steps up there for both groups, and the chart says how much of each figure that is.
 * Null when the last two weeks aren't both shown.
 */
export function lastWeekStep(curve: { users: (number | null)[]; base: (number | null)[] }): { users: number; base: number | null } | null {
  const step = (v: (number | null)[]) => {
    const a = v.at(-1)
    const b = v.at(-2)
    return a === null || a === undefined || b === null || b === undefined ? null : Math.round((a - b) * 100)
  }
  const users = step(curve.users)
  return users === null || users <= 0 ? null : { users, base: step(curve.base) }
}
