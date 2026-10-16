import type { Campaign, PromoEligibility, SponsoredItem } from '../../lib/api'
import { GOALS } from '../../lib/metrics.ts'
import { SKIN_LABEL, whyLines } from '../routine/sponsored.ts'

/**
 * Willow Proof · Promote: the pure parts (words, dates, errors, the holdout interval), so `npm test` can read
 * them without the app. Rules and shapes: docs/RETAILER_INSIGHTS.md "Proof-gated promotion", api campaigns.py.
 */

/** The api's running cap per owner (campaigns.MAX_ACTIVE). */
export const MAX_ACTIVE = 3
export const DAYS = [7, 14, 30] as const
export type Days = (typeof DAYS)[number]
/** Holdout shares the api accepts (0.1-0.5); 20% is the api default. */
export const HOLDOUTS = [0.1, 0.2, 0.3, 0.5] as const
export const DEFAULT_HOLDOUT = 0.2
/** The consumer card's cohort label and disclosure, word for word (api campaigns.COHORT_LABEL / DISCLOSURE). */
export const COHORT_LABEL = 'Willow cohort, includes simulated data'
export const DISCLOSURE =
  "Brands pay to show a product here; only products that meet Willow's evidence bar can be shown, and payment never changes your recommendations. Ranking of your own recommendations is computed from measured outcomes only."
/** Both groups need this many people before the holdout comparison shows (api campaigns.MIN_GROUP). */
export const HOLDOUT_MIN = 10

export const goalLabel = (id: string) => GOALS.find((g) => g.id === id)?.label ?? id
export const skinLabel = (id: string) => SKIN_LABEL[id] ?? id

/** "A", "A and B", "A, B and C". */
export function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The section's one-line answer: how many products clear the bar, and (brand view) how many are this brand's. */
export function answerLine(all: Pick<PromoEligibility, 'eligible' | 'brand'>[], brand: string | null): string {
  const eligible = all.filter((p) => p.eligible)
  const e = eligible.length
  if (brand === null) {
    if (!e) return `None of the ${plural(all.length, 'product')} clears the evidence bar yet, so nothing can be promoted.`
    return `${e} of ${plural(all.length, 'product')} ${e === 1 ? 'clears' : 'clear'} the evidence bar and can be promoted.`
  }
  const mine = eligible.filter((p) => p.brand === brand).length
  if (!e) return 'No product clears the evidence bar yet, so nothing can be promoted.'
  const head = `${plural(e, 'product')} ${e === 1 ? 'clears' : 'clear'} the evidence bar`
  if (!mine) return `${head}; none of them are ${brand}’s yet.`
  return `${head}; ${mine === e ? (e === 1 ? 'it is' : 'all of them are') : `${mine} of them ${mine === 1 ? 'is' : 'are'}`} yours.`
}

/** The skin types a campaign reaches: its own, or every skin type the evidence covers ([] = all eligible). */
export function skinText(skinTypes: string[], eligible?: string[]): string {
  if (skinTypes.length) return listText(skinTypes.map(skinLabel))
  return eligible && eligible.length ? `All eligible skin types (${eligible.map((s) => skinLabel(s).toLowerCase()).join(', ')})` : 'All eligible skin types'
}

const DAY_MS = 86_400_000
const dayFmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "16 Oct – 30 Oct" (UTC: campaign days are UTC days in the api). */
export const dateRange = (startsAt: string, endsAt: string) => `${dayFmt(startsAt)} – ${dayFmt(endsAt)}`

/** "12 days left", "Last day", "Ended 30 Oct". */
export function timeLeft(c: Pick<Campaign, 'status' | 'ends_at'>, now: Date = new Date()): string {
  const left = new Date(c.ends_at).getTime() - now.getTime()
  if (c.status === 'ended' || left <= 0) return `Ended ${dayFmt(c.ends_at)}`
  const days = Math.ceil(left / DAY_MS)
  return days <= 1 ? 'Last day' : `${days} days left`
}

/** Click-through rate with one decimal (3.3%); null (no impressions yet) → "—". */
export function ctrText(ctr: number | null | undefined): string {
  if (ctr === null || ctr === undefined) return '—'
  return `${(Math.round(ctr * 1000) / 10).toFixed(1)}%`
}

/** Wilson 95% interval of k of n (as the api's rate intervals, retailer._wilson), to 2 dp. */
export function wilson(k: number, n: number): [number, number] | null {
  if (n <= 0 || k < 0 || k > n) return null
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  const r = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100
  return [r(c - h), r(c + h)]
}

/** Running campaigns count against the cap (ended and paused don't). */
export const runningCount = (cs: Pick<Campaign, 'status'>[]) => cs.filter((c) => c.status === 'active').length

/** The api's workspace value for "Viewing as": 'retailer' or the brand's catalog name (null: unknown brand). */
export function workspaceId(ws: { kind: 'retailer' } | { kind: 'brand'; brand: string | null }): string | null {
  return ws.kind === 'retailer' ? 'retailer' : ws.brand
}

/** Not-eligible products in a useful order: closest to Proven first, then no clear effect, then too few. */
const TIER_RANK: Record<PromoEligibility['tier'], number> = { proven: 0, promising: 1, unclear: 2, too_few: 3 }
export function notEligibleOrder(a: PromoEligibility, b: PromoEligibility): number {
  return TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.brand.localeCompare(b.brand) || a.product.localeCompare(b.product)
}

/** A promote/resume failure in words, with the api's reasons when it sent them. */
export type PromoError = { kind: 'not_eligible' | 'too_many' | 'ended' | 'unavailable' | 'auth' | 'rate' | 'other'; title: string; message: string; reasons: string[] }
export function promoError(e: unknown): PromoError {
  const err = e as { status?: number; code?: string | null; message?: string; detail?: Record<string, unknown> | null } | null
  const status = err?.status
  const reasons = Array.isArray(err?.detail?.reasons) ? (err!.detail!.reasons as unknown[]).filter((r): r is string => typeof r === 'string') : []
  if (status === 422 && err?.code === 'not_eligible') return { kind: 'not_eligible', title: 'This campaign can’t run with these settings', message: err.message || 'The evidence does not cover it.', reasons }
  if (status === 429 && err?.code === 'too_many_active') return { kind: 'too_many', title: `${MAX_ACTIVE} campaigns are already running`, message: 'Pause or delete one of your running campaigns, then try again.', reasons }
  if (status === 429) return { kind: 'rate', title: 'Daily limit reached', message: err?.message || 'Too many changes today. Try again tomorrow.', reasons }
  if (status === 409) return { kind: 'ended', title: 'This campaign has ended', message: 'An ended campaign can’t be resumed. Create a new one for the same product.', reasons }
  if (status === 503) return { kind: 'unavailable', title: 'The evidence can’t be read right now', message: 'Eligibility is checked against the evidence on every change, so nothing was changed. Try again in a minute.', reasons }
  if (status === 401 || status === 403) return { kind: 'auth', title: 'Not signed in', message: 'Promoting needs a guest sign-in, which did not work. Reload the page and try again.', reasons }
  if (typeof status === 'number') return { kind: 'other', title: 'That didn’t work', message: err?.message || 'The api refused the change. Try again.', reasons }
  return { kind: 'other', title: 'Couldn’t reach Willow', message: 'Check the connection and try again. Nothing was changed.', reasons }
}

/** The card a shopper would see for this product (the evidence line the api serves, word for word). */
export function previewItem(e: Pick<PromoEligibility, 'product_id' | 'product' | 'brand' | 'evidence'>, extra?: { image_url?: string | null; category?: string | null }): Omit<SponsoredItem, 'campaign_id' | 'matched'> & { matched: SponsoredItem['matched'] } {
  return {
    product_id: e.product_id,
    product: e.product,
    brand: e.brand,
    image_url: extra?.image_url ?? null,
    category: extra?.category ?? '',
    evidence: e.evidence,
    cohort_label: COHORT_LABEL,
    label: 'Sponsored',
    matched: { goals: [], skin_type: null },
    disclosure: DISCLOSURE,
  }
}

/**
 * "Why am I seeing this?" for an example shopper this campaign would reach: the first targeted goal and the first
 * targeted (or eligible) skin type. A real shopper sees their own goals that overlap.
 */
export function exampleWhy(goals: string[], skinTypes: string[], eligibleSkins: string[]) {
  const skin = (skinTypes[0] ?? eligibleSkins[0] ?? null) as SponsoredItem['matched']['skin_type']
  return whyLines({ matched: { goals: goals.slice(0, 1), skin_type: skin }, disclosure: DISCLOSURE }, goalLabel)
}

/** Daily bars: each day's share of the busiest day (0-1), for the sparkline. */
export function barHeights(values: number[]): number[] {
  const max = Math.max(0, ...values)
  return values.map((v) => (max ? v / max : 0))
}
