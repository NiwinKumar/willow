import type { ProductRow, ProofTier } from '../../types'

/*
 * Explore (/retail/explore): the query model, pure so `npm test` covers it. A query is a measure, a grouping,
 * filters, a minimum n, a sort direction and a limit; it lives in the URL (`m`, `g`, `f_brand`, `f_category`,
 * `f_goal`, `f_status`, `min`, `sort`, `limit`), defaults left out, so a link reproduces the view.
 *
 * Every value comes from GET /v1/retailer/products rows. A group's value is the people-weighted mean of its
 * products (Σ value·n / Σ n); a group's lift is its weighted rate minus its weighted non-user rate; "People
 * measured" is summed. A product whose value is suppressed (null) or whose n is under the minimum is left out
 * of the group, never counted as 0, and a group with nothing left is not shown.
 */

export type MeasureId = 'rate' | 'lift' | 'n' | 'cont8' | 'weeks' | 'share'
export type GroupId = 'product' | 'brand' | 'category' | 'price' | 'status' | 'goal'
export type FilterId = 'brand' | 'category' | 'goal' | 'status'
export type MinN = 10 | 30 | 100
export type Limit = 10 | 20 | 'all'
export type Dir = 'desc' | 'asc'

export type Query = {
  measure: MeasureId
  group: GroupId
  filters: Record<FilterId, string[]>
  min: MinN
  dir: Dir
  limit: Limit
}

/** How a measure's numbers read: a share (0.77 → 77%), a difference in points, a count, weeks. */
export type MeasureKind = 'rate' | 'points' | 'count' | 'weeks'

export const MEASURES: { id: MeasureId; label: string; kind: MeasureKind }[] = [
  { id: 'rate', label: 'Visible change rate', kind: 'rate' },
  { id: 'lift', label: 'Lift vs non-users', kind: 'points' },
  { id: 'n', label: 'People measured', kind: 'count' },
  { id: 'cont8', label: 'Still using at week 8', kind: 'rate' },
  { id: 'weeks', label: 'Weeks to first change', kind: 'weeks' },
  { id: 'share', label: 'Share of routines', kind: 'rate' },
]

export const GROUPS: { id: GroupId; label: string; plural: string }[] = [
  { id: 'product', label: 'Product', plural: 'products' },
  { id: 'brand', label: 'Brand', plural: 'brands' },
  { id: 'category', label: 'Category', plural: 'categories' },
  { id: 'price', label: 'Price tier', plural: 'price tiers' },
  { id: 'status', label: 'Proof status', plural: 'statuses' },
  { id: 'goal', label: 'Goal', plural: 'goals' },
]

export const FILTERS: { id: FilterId; label: string; plural: string }[] = [
  { id: 'brand', label: 'Brand', plural: 'brands' },
  { id: 'category', label: 'Category', plural: 'categories' },
  { id: 'goal', label: 'Goal', plural: 'goals' },
  { id: 'status', label: 'Status', plural: 'statuses' },
]

export const MINS: MinN[] = [10, 30, 100]
export const LIMITS: Limit[] = [10, 20, 'all']

export const DEFAULT_QUERY: Query = { measure: 'rate', group: 'product', filters: { brand: [], category: [], goal: [], status: [] }, min: 10, dir: 'desc', limit: 10 }

export const measureOf = (id: MeasureId) => MEASURES.find((m) => m.id === id)!
export const groupOf = (id: GroupId) => GROUPS.find((g) => g.id === id)!

/** A URL-safe id for a brand name ("Dot & Key" → "dot-and-key"); the same rule as ui/format slugOf. */
export function brandKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const list = (v: string | null) => [...new Set((v ?? '').split(',').map((s) => s.trim()).filter(Boolean))]

/** The query in the URL (`get` reads one key); unknown values fall back to the defaults. */
export function parseQuery(get: (k: string) => string | null): Query {
  const measure = MEASURES.find((m) => m.id === get('m'))?.id ?? DEFAULT_QUERY.measure
  const group = GROUPS.find((g) => g.id === get('g'))?.id ?? DEFAULT_QUERY.group
  const min = MINS.find((v) => String(v) === get('min')) ?? DEFAULT_QUERY.min
  const limit = LIMITS.find((v) => String(v) === get('limit')) ?? DEFAULT_QUERY.limit
  const dir: Dir = get('sort') === 'asc' ? 'asc' : 'desc'
  const filters = { brand: list(get('f_brand')), category: list(get('f_category')), goal: list(get('f_goal')), status: list(get('f_status')) }
  return { measure, group, filters, min, dir, limit }
}

/** The URL patch for a query: every key, null where it is the default (so it is left out). */
export function queryParams(q: Query): Record<string, string | null> {
  const d = DEFAULT_QUERY
  return {
    m: q.measure === d.measure ? null : q.measure,
    g: q.group === d.group ? null : q.group,
    min: q.min === d.min ? null : String(q.min),
    sort: q.dir === d.dir ? null : q.dir,
    limit: q.limit === d.limit ? null : String(q.limit),
    f_brand: q.filters.brand.join(',') || null,
    f_category: q.filters.category.join(',') || null,
    f_goal: q.filters.goal.join(',') || null,
    f_status: q.filters.status.join(',') || null,
  }
}

export const filterCount = (q: Query) => FILTERS.reduce((s, f) => s + q.filters[f.id].length, 0)

export const sameQuery = (a: Query, b: Query) => JSON.stringify(queryParams(a)) === JSON.stringify(queryParams(b))

/** One-click starting points; each sets the whole query (filters, minimum, sort and limit back to defaults). */
export const PRESETS: { id: string; label: string; query: Query }[] = [
  { id: 'proven-lift', label: 'Proven products by lift', query: { ...DEFAULT_QUERY, measure: 'lift', group: 'product', filters: { ...DEFAULT_QUERY.filters, status: ['proven'] } } },
  { id: 'brand-rate', label: 'Brands by visible change', query: { ...DEFAULT_QUERY, measure: 'rate', group: 'brand' } },
  { id: 'category-cont8', label: 'Categories by still using at week 8', query: { ...DEFAULT_QUERY, measure: 'cont8', group: 'category' } },
  { id: 'price-lift', label: 'Price tiers by lift', query: { ...DEFAULT_QUERY, measure: 'lift', group: 'price' } },
  { id: 'goal-n', label: 'Goals by people', query: { ...DEFAULT_QUERY, measure: 'n', group: 'goal' } },
]

/** Labels the rows don't carry (goal ids, statuses, price tiers). Missing ids fall back to the id itself. */
export type Labels = { goal?: Record<string, string>; status?: Partial<Record<ProofTier, string>>; price?: Record<string, string> }

const PRICE_ORDER = ['budget', 'mid', 'premium']

/** The groups a product falls in for a grouping (several for Goal: a product counts in each of its goals). */
export function groupsOf(row: ProductRow, g: GroupId, labels: Labels = {}): { key: string; label: string }[] {
  switch (g) {
    case 'product':
      return [{ key: row.product_id, label: row.product }]
    case 'brand':
      return [{ key: brandKey(row.brand), label: row.brand }]
    case 'category':
      return [{ key: row.category, label: row.category_label }]
    case 'price':
      return [{ key: row.price_tier, label: labels.price?.[row.price_tier] ?? row.price_tier }]
    case 'status':
      return [{ key: row.tier, label: labels.status?.[row.tier] ?? row.tier }]
    case 'goal':
      return row.goal_ids.map((id) => ({ key: id, label: labels.goal?.[id] ?? id }))
  }
}

/** The rows the filters keep (each filter: any of its values; filters combine with AND), at or above `min` n. */
export function filterRows(rows: ProductRow[], q: Pick<Query, 'filters' | 'min'>): ProductRow[] {
  const f = q.filters
  return rows.filter(
    (r) =>
      r.n !== null &&
      r.n >= q.min &&
      (!f.brand.length || f.brand.includes(brandKey(r.brand))) &&
      (!f.category.length || f.category.includes(r.category)) &&
      (!f.goal.length || r.goal_ids.some((g) => f.goal.includes(g))) &&
      (!f.status.length || f.status.includes(r.tier)),
  )
}

/** A row's own value for a measure (null = suppressed or unknown). */
export function valueOf(r: ProductRow, m: MeasureId): number | null {
  switch (m) {
    case 'rate':
      return r.rate
    case 'lift':
      return r.lift
    case 'n':
      return r.n
    case 'cont8':
      return r.cont8
    case 'weeks':
      return r.weeks
    case 'share':
      return r.routine_share
  }
}

export type Group = {
  key: string
  label: string
  value: number
  /** 95% interval, only when the row is one product (grouped by product). */
  lo: number | null
  hi: number | null
  /** Non-users with the same goal (weighted), for the visible-change measure. */
  base: number | null
  /** People behind the value: Σ n of the products that count (someone using two products counts twice). */
  n: number
  /** Products that count in this group. */
  products: number
  /** The product id when grouped by product (the bar opens its page). */
  productId: string | null
  /** The group is the workspace brand, or one of its products. */
  own: boolean
}

type Acc = { key: string; label: string; vn: number; n: number; products: number; rn: number; bn: number; nb: number; row: ProductRow; brands: Set<string> }

const weighted = (sum: number, n: number) => (n > 0 ? sum / n : null)
const round = (v: number) => Math.round(v * 10000) / 10000

/**
 * The groups for a query, sorted by value (ties: more people first, then by name) and cut to the limit.
 * `total` is the number of groups before the limit. `ownBrand` marks the workspace brand's bars.
 */
export function aggregate(rows: ProductRow[], q: Query, opts: { labels?: Labels; ownBrand?: string | null } = {}): { groups: Group[]; total: number } {
  const accs = new Map<string, Acc>()
  for (const r of filterRows(rows, q)) {
    const n = r.n!
    let v: number | null
    if (q.measure === 'lift') {
      // A group's lift is its weighted rate minus its weighted non-user rate: both rates are needed.
      if (q.group === 'product') v = r.lift
      else v = r.rate !== null && r.base_rate !== null ? r.rate : null
    } else v = valueOf(r, q.measure)
    if (v === null || Number.isNaN(v)) continue
    for (const { key, label } of groupsOf(r, q.group, opts.labels)) {
      if (q.group === 'goal' && q.filters.goal.length && !q.filters.goal.includes(key)) continue
      let a = accs.get(key)
      if (!a) {
        a = { key, label, vn: 0, n: 0, products: 0, rn: 0, bn: 0, nb: 0, row: r, brands: new Set() }
        accs.set(key, a)
      }
      a.vn += v * n
      a.n += n
      a.products += 1
      a.brands.add(r.brand)
      if (r.rate !== null && r.base_rate !== null) {
        a.rn += r.rate * n
        a.bn += r.base_rate * n
        a.nb += n
      }
    }
  }
  const own = opts.ownBrand ?? null
  const groups: Group[] = [...accs.values()].map((a) => {
    const single = q.group === 'product'
    let value: number
    if (q.measure === 'n') value = a.n
    else if (q.measure === 'lift' && !single) value = round(weighted(a.rn, a.nb)! - weighted(a.bn, a.nb)!)
    else value = round(weighted(a.vn, a.n)!)
    const lo = single ? (q.measure === 'rate' ? a.row.rate_lo : q.measure === 'lift' ? a.row.lift_lo : null) : null
    const hi = single ? (q.measure === 'rate' ? a.row.rate_hi : q.measure === 'lift' ? a.row.lift_hi : null) : null
    const base = q.measure === 'rate' && a.nb > 0 ? round(a.bn / a.nb) : null
    const isOwn = own !== null && (q.group === 'product' || q.group === 'brand') && a.brands.size === 1 && a.brands.has(own)
    return { key: a.key, label: a.label, value, lo, hi, base, n: a.n, products: a.products, productId: single ? a.row.product_id : null, own: isOwn }
  })
  const k = q.dir === 'asc' ? 1 : -1
  const order = (g: Group) => (q.group === 'price' ? PRICE_ORDER.indexOf(g.key) : 0)
  groups.sort((a, b) => k * (a.value - b.value) || b.n - a.n || order(a) - order(b) || a.label.localeCompare(b.label))
  return { groups: q.limit === 'all' ? groups : groups.slice(0, q.limit), total: groups.length }
}

/**
 * A scale-true axis for the bars: always includes 0, rounded out to a "nice" step, with 3–6 ticks.
 * Rates and points use steps of 0.05/0.1/0.2…; counts and weeks steps of 1/2/5/10….
 */
export function niceAxis(values: number[], target = 5): { min: number; max: number; ticks: number[] } {
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const span = hi - lo || 1
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? 10 * mag
  const a = Math.floor(lo / step + 1e-9)
  const b = Math.max(Math.ceil(hi / step - 1e-9), a + 1)
  const clean = (v: number) => (v === 0 ? 0 : Number(v.toPrecision(12)))
  const ticks = Array.from({ length: b - a + 1 }, (_, i) => clean((a + i) * step))
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks }
}
