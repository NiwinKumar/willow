import { sectionPath } from '../state.ts'
import type { BrandSummary, BriefCard, Segments } from '../types.ts'

/*
 * Pure helpers behind the insight lines and links of Overview, Skin profiles, Competitors and Demand. They
 * only rank, pick and re-express numbers the api already sent (no new measurement); tests: tests/retail.test.ts.
 */

const MINUS = '−'

/**
 * Wilson 95% interval for k of n, rounded to 2 dp: the same formula as the api (retailer._wilson), for the
 * few picks whose response carries a rate and n but no interval (a skin profile's best product).
 */
export function wilson(k: number, n: number): { lo: number; hi: number } | null {
  if (!n || n <= 0 || k < 0 || k > n) return null
  const z = 1.96
  const p = k / n
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)
  const r = (v: number) => Math.round(v * 100) / 100
  return { lo: r(Math.max(0, centre - half)), hi: r(Math.min(1, centre + half)) }
}

/** The interval of a rounded rate over n people (k recovered as round(rate × n); within a point of exact). */
export const rateInterval = (rate: number | null | undefined, n: number | null | undefined) =>
  rate === null || rate === undefined || !n ? null : wilson(Math.round(rate * n), n)

/* ───────────── the brief ───────────── */

/** Where a brief card goes: its exact view, with the workspace and filters carried ("?as=…&cohort=…"). */
export function briefHref(card: Pick<BriefCard, 'id' | 'link'>, carry = ''): string {
  const { section, id } = card.link
  const q = new URLSearchParams(carry.replace(/^\?/, ''))
  let path: string
  let hash = ''
  switch (section) {
    case 'products':
      path = id ? sectionPath('products', id) : sectionPath('products')
      break
    case 'categories':
      path = sectionPath('market')
      q.set('view', 'categories')
      if (id) q.set('category', id)
      break
    case 'segments':
      path = sectionPath('customers')
      if (id) q.set('skin', id)
      break
    case 'competitors':
      path = sectionPath('market')
      if (id) q.set('goal', id)
      if (card.id === 'switching_net') hash = '#switching'
      break
    case 'demand':
      // The anchor alone places the page (no `view=demand`: once a panel opens the hash is gone, and the old
      // key would then scroll the page to What people want).
      path = sectionPath('customers')
      if (id) q.set('goal', id)
      hash = { top_conflict: '#conflicts', assortment_gap: '#gaps', unmet_need: '#unmet', rising_goal: '#demand' }[card.id] ?? '#demand'
      break
    default:
      path = sectionPath('campaigns')
      if (id) q.set('product', id)
  }
  const s = q.toString()
  return `${path}${s ? `?${s}` : ''}${hash}`
}

/** A card's key figure as shown: "+48" pts, "64" %, "−38" people (net switching is signed), "2" products. */
export function cardFigure(card: Pick<BriefCard, 'id' | 'value' | 'unit'>): { value: string; unit: string } | null {
  const v = card.value
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string') return { value: v, unit: card.unit ?? '' }
  const abs = Math.abs(v).toLocaleString('en-GB')
  const signed = `${v > 0 ? '+' : v < 0 ? MINUS : '±'}${abs}`
  switch (card.unit) {
    case 'points':
      return { value: signed, unit: 'pts' }
    case 'percent':
      return { value: `${v < 0 ? MINUS : ''}${abs}`, unit: '%' }
    case 'people':
      return { value: card.id === 'switching_net' ? signed : abs, unit: Math.abs(v) === 1 ? 'person' : 'people' }
    case 'products':
      return { value: abs, unit: Math.abs(v) === 1 ? 'product' : 'products' }
    default:
      return { value: `${v < 0 ? MINUS : ''}${abs}`, unit: card.unit ?? '' }
  }
}

/* ───────────── skin profiles ───────────── */

type SegCell = Segments['cells'][number]
export type UnmetCell = SegCell & { unmet: number; users: number; skinLabel: string; goalLabel: string }

/** Cells with an unmet share, most under-served first (share without a visible change, then people). */
export function topUnmet(s: Pick<Segments, 'cells' | 'skin_types' | 'goals'>, limit = 5): UnmetCell[] {
  const skin = new Map(s.skin_types.map((x) => [x.id, x.label]))
  const goal = new Map(s.goals.map((x) => [x.id, x.label]))
  return s.cells
    .filter((c): c is SegCell & { unmet: number; users: number } => c.unmet !== null && c.users !== null)
    .map((c) => ({ ...c, skinLabel: skin.get(c.skin) ?? c.skin, goalLabel: goal.get(c.goal) ?? c.goal }))
    .sort((a, b) => b.unmet - a.unmet || b.users - a.users || a.skin.localeCompare(b.skin) || a.goal.localeCompare(b.goal))
    .slice(0, limit)
}

/**
 * The strongest best-in-cell product: the highest interval lower bound (so a 100% of 11 doesn't beat 90% of
 * 40 by luck), then rate, then n.
 */
export function strongestWinner(s: Pick<Segments, 'cells' | 'skin_types' | 'goals'>) {
  const skin = new Map(s.skin_types.map((x) => [x.id, x.label]))
  const goal = new Map(s.goals.map((x) => [x.id, x.label]))
  const picks = s.cells
    .filter((c) => c.best)
    .map((c) => ({ cell: c, best: c.best!, ci: rateInterval(c.best!.rate, c.best!.n), skinLabel: skin.get(c.skin) ?? c.skin, goalLabel: goal.get(c.goal) ?? c.goal }))
  picks.sort((a, b) => (b.ci?.lo ?? 0) - (a.ci?.lo ?? 0) || b.best.rate - a.best.rate || b.best.n - a.best.n)
  return picks[0] ?? null
}

/* ───────────── competitors ───────────── */

/** Measured brands by rate; the leader and every brand whose interval reaches the leader's lower bound. */
export function brandLeaders(brands: BrandSummary[]) {
  const measured = brands.filter((b): b is BrandSummary & { rate: number; n: number } => b.rate !== null && b.n !== null).sort((a, b) => b.rate - a.rate || b.n - a.n)
  const leader = measured[0] ?? null
  const tied = leader && leader.lo !== null ? measured.filter((b) => b !== leader && b.hi !== null && b.hi >= leader.lo!) : []
  return { measured, leader, tied }
}

/** A brand's place among measured brands by rate ("3 of 16"); null when it has no rate. */
export function brandRank(brands: BrandSummary[], brand: string): { rank: number; of: number } | null {
  const { measured } = brandLeaders(brands)
  const i = measured.findIndex((b) => b.brand === brand)
  return i < 0 ? null : { rank: i + 1, of: measured.length }
}

/** Won-from and lost-to merged per counterpart brand, largest flow first (for the diverging bars). */
export function switchRows(won: { brand: string; n: number }[], lost: { brand: string; n: number }[]) {
  const m = new Map<string, { brand: string; won: number | null; lost: number | null }>()
  for (const w of won) m.set(w.brand, { brand: w.brand, won: w.n, lost: null })
  for (const l of lost) m.set(l.brand, { brand: l.brand, won: m.get(l.brand)?.won ?? null, lost: l.n })
  return [...m.values()].sort((a, b) => (b.won ?? 0) + (b.lost ?? 0) - ((a.won ?? 0) + (a.lost ?? 0)) || a.brand.localeCompare(b.brand))
}

/** An axis domain around values, snapped outward to `step` (0.05 = 5 points), at least `minSpan` wide. */
export function niceDomain(values: number[], step = 0.05, minSpan = 0.2): [number, number] {
  if (!values.length) return [0, 1]
  let lo = Math.floor((Math.min(...values) - step / 2) / step) * step
  let hi = Math.ceil((Math.max(...values) + step / 2) / step) * step
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2
    lo = mid - minSpan / 2
    hi = mid + minSpan / 2
  }
  const r = (v: number) => Math.round(v * 1000) / 1000
  return [r(Math.max(0, lo)), r(Math.min(1, hi))]
}
