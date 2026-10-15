import { toast } from 'sonner'

import type { RetailerCohort, RetailerInsights, RetailerRange } from '../../lib/api'

/**
 * Helpers for the retailer page over GET /v1/retailer/insights (api/app/retailer.py). Every number on the
 * page comes from that response or is derived here from it; nothing is invented. Groups under 10 people are
 * suppressed by the api (null counts, suppressed cells), never here.
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

/** Any group under 10 people is suppressed (retailer.py MIN_GROUP). */
export const MIN_GROUP = 10

/** The same suppressed aggregates as a shareable Data Studio report (api/scripts/publish_looker.py). */
export const DATA_STUDIO = 'https://datastudio.google.com/reporting/5147af6b-c268-470a-a420-2277dfcfe7df'

export type CohortKind = 'simulated' | 'mixed' | 'real'
export type Filters = { cohort: RetailerCohort; range: RetailerRange }
/** The api's defaults: every row, all time (what the page showed before filters). */
export const DEFAULT_FILTERS: Filters = { cohort: 'mixed', range: 'all' }

export const RANGES: { value: RetailerRange; label: string; caps: string }[] = [
  { value: '30d', label: '30 days', caps: 'LAST 30 DAYS' },
  { value: '90d', label: '90 days', caps: 'LAST 90 DAYS' },
  { value: 'all', label: 'All time', caps: 'ALL TIME' },
]
export const COHORTS: { value: RetailerCohort; label: string }[] = [
  { value: 'simulated', label: 'Simulated' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'real', label: 'Real only' },
]

/** What the aggregates on screen describe (the rows the filter kept), for the banner, badges and exports. */
export function cohortKind(c: Insights['cohort']): CohortKind {
  if (c.real === 0) return 'simulated'
  if (c.synthetic === 0) return 'real'
  return 'mixed'
}

export const totalUsers = (c: Insights['cohort']) => c.synthetic + c.real

export function outcomes(d: Insights): (Outcome & { product_id: string })[] {
  return Object.entries(d.product_outcomes ?? {}).map(([product_id, o]) => ({ ...o, product_id }))
}

/** Fractions arrive with 2 decimals; the page shows whole percents. */
export const pct = (v: number) => `${Math.round(v * 100)}%`

/** Signed points with a true minus sign (docs/DESIGN.md number formatting). */
export function signedPts(v: number): string {
  const p = Math.round(v * 100)
  return `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)} pts`
}

export const weeksLabel = (w: number | null | undefined) => (w === null || w === undefined ? '—' : `${w} wk`)

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

/**
 * Client-side CSV with the design's header comment, plus the cohort counts, the filter and the disclaimer
 * (docs/DESIGN.md rule 13: a disclaimer on every retail export). Suppressed groups export as "suppressed".
 */
export function exportCsv(name: string, d: Insights, header: string[], rows: (string | number | null | undefined)[][]) {
  const kind = cohortKind(d.cohort)
  const esc = (v: string | number | null | undefined) => {
    const t = v === null || v === undefined ? '' : String(v)
    return /[",\n#]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const range = RANGES.find((r) => r.value === d.filters?.range)?.caps ?? 'ALL TIME'
  const body = [
    `# Willow aggregate export · ${COHORT_LINE[kind]} · ${d.cohort.synthetic} simulated + ${d.cohort.real} real users · ${range}${d.filters ? ` to ${d.filters.today}` : ''} · groups under ${MIN_GROUP} suppressed`,
    '# Cosmetic outcome associations from photos, not proof of effect. Not a medical assessment.',
    header.map(esc).join(','),
    ...rows.map((r) => r.map(esc).join(',')),
  ].join('\n')
  const file = `willow-${name}-${kind}.csv`
  try {
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = file
    a.click()
    // Revoking at once can cancel the download in some browsers; give it a moment to start.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`Exported ${file} · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`)
  } catch {
    toast('The export could not be created in this browser.')
  }
}
