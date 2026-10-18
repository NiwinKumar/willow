import type { RetailerInsights } from '../../lib/api'
import { RANGES } from './state'
import { cohortKind, type CohortKind } from './ui/cohort'
import { downloadCsv, MIN_GROUP, type CsvValue } from './ui/format'

/**
 * Helpers over GET /v1/retailer/insights (api/app/retailer.py). Every number on screen comes from that
 * response or is derived here from it; nothing is invented. Groups under 10 people are suppressed by the api
 * (null counts, suppressed cells), never here.
 */

export type Insights = RetailerInsights
export type Outcome = NonNullable<Insights['product_outcomes']>[string]
export type Product = Insights['products'][number]
export type Cell = Product['cells'][number]
export type Gap = Insights['gaps'][number]
export type Category = NonNullable<Insights['categories']>[number]
export type Flow = Category['flows'][number]
export type Tier = 'budget' | 'mid' | 'premium'
export const TIERS: Tier[] = ['budget', 'mid', 'premium']
export const TIER_LABEL: Record<Tier, string> = { budget: 'Budget', mid: 'Mid', premium: 'Premium' }

export { MIN_GROUP }

/** The same suppressed aggregates as a shareable Data Studio report (api/scripts/publish_looker.py). */
export const DATA_STUDIO = 'https://datastudio.google.com/reporting/5147af6b-c268-470a-a420-2277dfcfe7df'

export const totalUsers = (c: Insights['cohort']) => c.synthetic + c.real

export function outcomes(d: Insights): (Outcome & { product_id: string })[] {
  return Object.entries(d.product_outcomes ?? {}).map(([product_id, o]) => ({ ...o, product_id }))
}

/** "2026-09" → "September" (or "Sep" short), from the api's month keys. */
export function monthLabel(key: string, short = false): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: short ? 'short' : 'long', timeZone: 'UTC' })
}

/**
 * A cell's numerator, derived: value is k/n rounded to 2 decimals, so round(value × n) gives k back exactly
 * while n < 100 (cells are per tone band or skin type, far below that).
 */
export const numerator = (c: Cell) => Math.round((c.value ?? 0) * c.n)

/** Same goal, not using the product: the api's base group (k of n), or rate − lift for an older response. */
export function nonUsers(p: Product): { rate: number; k: number | null; n: number | null } | null {
  if (p.base) return { rate: p.base.rate, k: p.base.k, n: p.base.n }
  return p.lift === null ? null : { rate: Math.max(0, p.rate - p.lift), k: null, n: null }
}

/**
 * Which tier of a goal is a gap, by the api's own rule (retailer.py "Assortment gaps"): a tier with no option;
 * otherwise, when every tier's rate is under 35%, the weakest tier; otherwise the first tier with one option.
 */
export function gapTier(g: Gap): { tier: Tier; reason: 'missing' | 'low' | 'thin' } | null {
  const missing = TIERS.find((t) => g[t].options === 0)
  if (missing) return { tier: missing, reason: 'missing' }
  const rated = TIERS.filter((t) => g[t].rate !== null)
  if (rated.length && Math.max(...rated.map((t) => g[t].rate!)) < 0.35) {
    return { tier: rated.reduce((a, t) => (g[t].rate! < g[a].rate! ? t : a)), reason: 'low' }
  }
  const thin = TIERS.find((t) => g[t].options === 1)
  return thin ? { tier: thin, reason: 'thin' } : null
}

const COHORT_LINE: Record<CohortKind, string> = {
  simulated: 'SIMULATED EVIDENCE',
  mixed: 'MIXED COHORT',
  real: 'REAL CONSENTED USERS',
}

/** The "# " header lines of every Willow Proof export: cohort counts, filter, suppression and the disclaimer. */
export function csvMeta(d: Pick<Insights, 'cohort' | 'filters'>, extra?: string): string[] {
  const kind = cohortKind(d.cohort)
  const range = RANGES.find((r) => r.value === d.filters?.range)?.caps ?? 'ALL TIME'
  return [
    `Proof by Willow aggregate export · ${COHORT_LINE[kind]} · ${d.cohort.synthetic} simulated + ${d.cohort.real} real users · ${range}${d.filters ? ` to ${d.filters.today}` : ''} · groups under ${MIN_GROUP} suppressed${extra ? ` · ${extra}` : ''}`,
    'Cosmetic outcome associations from photos, not proof of effect. Not a medical assessment.',
  ]
}

/** File name for an export: willow-proof-<name>-<cohort kind>.csv. */
export const csvName = (name: string, d: Pick<Insights, 'cohort'>) => `willow-proof-${name}-${cohortKind(d.cohort)}.csv`

/** A one-off export outside a DataTable (charts' data). */
export function exportCsv(name: string, d: Insights, header: string[], rows: CsvValue[][]) {
  downloadCsv(csvName(name, d), csvMeta(d), header, rows)
}
