import { toast } from 'sonner'

import type { RetailerAnswer, RetailerInsights } from '../../lib/api'

/**
 * Helpers for the retailer page over GET /v1/retailer/insights (api/app/retailer.py). Every number on the
 * page comes from that response or is derived here from it; nothing is invented.
 */

/** product_outcomes carries more than lib/api.ts types (retailer.py returns name, brand, concern, cont too). */
export type Outcome = { n: number; rate: number; weeks: number | null; product?: string; brand?: string; concern?: string; cont?: number }
export type Insights = RetailerInsights
export type Product = Insights['products'][number]
export type Cell = Product['cells'][number]
export type Gap = Insights['gaps'][number]
export type Tier = 'budget' | 'mid' | 'premium'
export const TIERS: Tier[] = ['budget', 'mid', 'premium']
export const TIER_LABEL: Record<Tier, string> = { budget: 'Budget', mid: 'Mid', premium: 'Premium' }

/** Any group under 10 people is suppressed (retailer.py MIN_GROUP). */
export const MIN_GROUP = 10

/** The same suppressed aggregates as a shareable Data Studio report (api/scripts/publish_looker.py). */
export const DATA_STUDIO = 'https://datastudio.google.com/reporting/5147af6b-c268-470a-a420-2277dfcfe7df'

export type CohortKind = 'simulated' | 'mixed' | 'real'

/** The cohort the aggregates describe: the api mixes every row it has, so this is what the page shows. */
export function cohortKind(c: Insights['cohort']): CohortKind {
  if (c.real === 0) return 'simulated'
  if (c.synthetic === 0) return 'real'
  return 'mixed'
}

export const totalUsers = (c: Insights['cohort']) => c.synthetic + c.real

export function outcomes(d: Insights): Outcome[] {
  return Object.values((d.product_outcomes ?? {}) as Record<string, Outcome>)
}

/** Fractions arrive with 2 decimals; the page shows whole percents. */
export const pct = (v: number) => `${Math.round(v * 100)}%`

/** Signed points with a true minus sign (docs/DESIGN.md number formatting). */
export function signedPts(v: number): string {
  const p = Math.round(v * 100)
  return `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)} pts`
}

export const weeksLabel = (w: number | null) => (w === null ? '—' : `${w} wk`)

/**
 * A cell's numerator, derived: value is k/n rounded to 2 decimals, so round(value × n) gives k back exactly
 * while n < 100 (cells are per tone band, far below that).
 */
export const numerator = (c: Cell) => Math.round((c.value ?? 0) * c.n)

/** The rate of people with the same goal who don't use the product: rate − lift (null when that group is under 10). */
export const nonUserRate = (p: Product) => (p.lift === null ? null : Math.max(0, p.rate - p.lift))

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

/** A bar label from an Ask chart, looked up in the aggregates: which table it came from and its n. */
export function lookupLabel(d: Insights, label: string): { source: string; n: number | null } | null {
  const l = label.toLowerCase()
  const prods = [...d.products, ...outcomes(d)] as { product?: string; brand?: string; n: number }[]
  const p = prods.find((x) => x.product && (x.product.toLowerCase() === l || `${x.brand} ${x.product}`.toLowerCase() === l))
  if (p) return { source: 'product outcomes', n: p.n }
  const b = d.brands.find((x) => x.brand.toLowerCase() === l)
  if (b) return { source: 'brands', n: b.n }
  const need = d.needs.find((x) => x.goal.toLowerCase() === l)
  if (need) return { source: 'needs', n: need.n }
  if (d.gaps.some((x) => x.goal.toLowerCase() === l)) return { source: 'assortment gaps', n: null }
  if (d.conflicts.some((x) => x.pair.toLowerCase() === l)) return { source: 'routine conflicts', n: null }
  if (d.tiles.some((x) => x.label.toLowerCase() === l)) return { source: 'summary tiles', n: null }
  return null
}

export function chartSources(d: Insights, chart: RetailerAnswer['chart']): string[] {
  if (!chart) return []
  return [...new Set(chart.bars.map((b) => lookupLabel(d, b.label)?.source).filter((s): s is string => Boolean(s)))]
}

const COHORT_LINE: Record<CohortKind, string> = {
  simulated: 'SIMULATED EVIDENCE',
  mixed: 'MIXED COHORT',
  real: 'REAL CONSENTED USERS',
}

/**
 * Client-side CSV with the design's header comment, plus the cohort counts and the disclaimer
 * (docs/DESIGN.md rule 13: a disclaimer on every retail export). Suppressed cells export as "suppressed".
 */
export function exportCsv(name: string, d: Insights, header: string[], rows: (string | number | null)[][]) {
  const kind = cohortKind(d.cohort)
  const esc = (v: string | number | null) => {
    const t = v === null ? '' : String(v)
    return /[",\n#]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const body = [
    `# Willow aggregate export · ${COHORT_LINE[kind]} · ${d.cohort.synthetic} simulated + ${d.cohort.real} real users · groups under ${MIN_GROUP} suppressed`,
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
