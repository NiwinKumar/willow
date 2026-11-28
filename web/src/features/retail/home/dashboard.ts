import type { Campaign } from '../../../lib/api'
import type { Insights, ProductRow } from '../types'
import { int, pct, pts } from '../ui/format.ts'

/*
 * Home's dashboard figures (sections/Home.tsx), pure so every number is tested (web/tests/proof-home-dash.test.ts).
 * Real aggregates only: product rows, this viewer's campaigns and goal demand by month. Nothing is projected.
 */

export type Portfolio = { total: number; measured: number; collecting: number; noUsers: number; proven: number; promising: number }

/** Where a set of products stands: measured (a rate), collecting, no users yet; Proven and Promising of the measured. */
export function portfolio(rows: Pick<ProductRow, 'rate' | 'reason' | 'users' | 'tier'>[]): Portfolio {
  const p: Portfolio = { total: rows.length, measured: 0, collecting: 0, noUsers: 0, proven: 0, promising: 0 }
  for (const r of rows) {
    if (r.rate !== null) {
      p.measured++
      if (r.tier === 'proven') p.proven++
      else if (r.tier === 'promising') p.promising++
    } else if (r.reason === 'unused' || !r.users) p.noUsers++
    else if (r.reason !== 'not_measured') p.collecting++
  }
  return p
}

/** The visible-change rate over measured products, weighted by people (each person counts once per product). */
export function pooledRate(rows: Pick<ProductRow, 'rate' | 'n'>[]): { rate: number; n: number; products: number } | null {
  let num = 0
  let n = 0
  let products = 0
  for (const r of rows) {
    if (r.rate === null || r.n === null || r.n <= 0) continue
    num += r.rate * r.n
    n += r.n
    products++
  }
  return n ? { rate: num / n, n, products } : null
}

export type CampaignTotals = {
  count: number
  live: number
  reach: number
  clicks: number
  adds: number
  /** Campaigns with a measured lift against the holdout. */
  measured: number
  /** The measured lift with the narrowest claim: highest lower bound first. */
  best: { lift: number; lo: number; hi: number; product: string; n: number; sample: boolean } | null
  /** Impressions per day across campaigns, oldest first (the last `days` days that have any). */
  daily: { day: string; impressions: number; clicks: number; adds: number }[]
}

/** Totals over a set of campaigns: the funnel (reach → clicks → adds), the best measured lift, a daily series. */
export function campaignTotals(list: Campaign[], days = 30): CampaignTotals {
  const byDay = new Map<string, { impressions: number; clicks: number; adds: number }>()
  let best: CampaignTotals['best'] = null
  const t = { count: list.length, live: 0, reach: 0, clicks: 0, adds: 0, measured: 0 }
  for (const c of list) {
    if (c.status === 'active') t.live++
    t.reach += c.stats.reach ?? c.stats.impressions
    t.clicks += c.stats.clicks
    t.adds += c.stats.adds
    const inc = c.stats.incrementality
    if (inc) {
      t.measured++
      if (!best || inc.lift_lo > best.lo || (inc.lift_lo === best.lo && inc.lift > best.lift)) best = { lift: inc.lift, lo: inc.lift_lo, hi: inc.lift_hi, product: c.product ?? c.product_id, n: inc.exposed.n + inc.holdout.n, sample: Boolean(c.sample) }
    }
    for (const d of c.stats.daily ?? []) {
      const e = byDay.get(d.day) ?? { impressions: 0, clicks: 0, adds: 0 }
      e.impressions += d.impressions
      e.clicks += d.clicks
      e.adds += d.adds
      byDay.set(d.day, e)
    }
  }
  const daily = [...byDay]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-days)
    .map(([day, v]) => ({ day, ...v }))
  return { ...t, best, daily }
}

export type GoalTrend = { goal: string; goalId: string; counts: (number | null)[]; latest: number | null; prev: number | null; change: number | null; focus: boolean }

/**
 * Goal demand by month as one row per goal: its monthly counts, the latest and the month before, and the change
 * as a share of the earlier month (null when either side is suppressed). `focus`: goals a brand's products
 * target (their rows lead). Sorted: focus first, then by the latest month's people.
 */
export function demandTrends(nbm: Insights['needs_by_month'] | null | undefined, focus: Set<string> = new Set()): { months: string[]; rows: GoalTrend[] } {
  if (!nbm || !nbm.months.length) return { months: [], rows: [] }
  const rows = nbm.goals.map((g) => {
    const latest = g.counts.at(-1) ?? null
    const prev = g.counts.length > 1 ? (g.counts.at(-2) ?? null) : null
    return { goal: g.goal, goalId: g.goal_id, counts: g.counts, latest, prev, change: latest !== null && prev ? (latest - prev) / prev : null, focus: focus.has(g.goal_id) }
  })
  rows.sort((a, b) => Number(b.focus) - Number(a.focus) || (b.latest ?? -1) - (a.latest ?? -1) || a.goal.localeCompare(b.goal))
  return { months: nbm.months, rows }
}

/** "2026-11" → "Nov". */
export const monthShort = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, (mo || 1) - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
}

/** A share change as words: +4% / −12% / no change. */
export const changeText = (c: number | null) => (c === null ? '—' : Math.round(c * 100) === 0 ? 'no change' : `${c > 0 ? '+' : '−'}${Math.abs(Math.round(c * 100))}%`)

export type BriefInput = {
  mix: 'retailer' | 'brand'
  /** The organisation or brand name ("CeraVe", "Northside Beauty"). */
  name: string
  p: Portfolio
  /** Pooled visible-change rate of these products, and of every measured product (the market). */
  rate: { rate: number; n: number } | null
  market: { rate: number; n: number } | null
  /** The goal whose demand rose most month on month (focus goals for a brand), if any rose. */
  rising: GoalTrend | null
  camp: Pick<CampaignTotals, 'live' | 'best'>
}

/**
 * "This week for CeraVe": two or three plain sentences written from the figures above (code, not Gemini, so every
 * number is the data's). Leads with where the products stand, then how they compare, then what moved. The
 * decisions are counted once, in the strip under it, not repeated here.
 */
export function weekBrief(x: BriefInput): string[] {
  const s: string[] = []
  const { p } = x
  const whose = x.mix === 'brand' ? `${x.name}’s` : 'your'
  if (!p.total) s.push(x.mix === 'brand' ? `None of ${whose} products is in the catalog yet.` : 'No products are in view yet.')
  else if (!p.measured) s.push(`${int(p.total)} of ${whose} products are in the catalog; none has 10 people at week 8 yet, so none is measured.`)
  else {
    const tier = p.proven ? `${int(p.proven)} ${p.proven === 1 ? 'is' : 'are'} Proven` : p.promising ? `none is Proven yet, ${int(p.promising)} ${p.promising === 1 ? 'is' : 'are'} Promising` : 'none is Proven yet'
    s.push(`${int(p.measured)} of ${int(p.total)} ${x.mix === 'brand' ? `${x.name} products` : 'products'} ${p.measured === 1 ? 'is' : 'are'} measured; ${tier}.`)
  }
  if (x.rate && x.market && x.mix === 'brand') {
    const d = Math.round((x.rate.rate - x.market.rate) * 100)
    s.push(`${pct(x.rate.rate)} of uses saw a visible change by week 8 (${int(x.rate.n)} product uses), ${d === 0 ? 'level with' : `${Math.abs(d)} ${Math.abs(d) === 1 ? 'point' : 'points'} ${d > 0 ? 'above' : 'below'}`} the market’s ${pct(x.market.rate)}.`)
  }
  // What moved: demand first (no tile shows it); the best campaign lift only when demand is flat.
  if (x.rising && x.rising.change !== null && Math.round(x.rising.change * 100) > 0) s.push(`Demand for ${x.rising.goal.toLowerCase()} grew ${Math.round(x.rising.change * 100)}% last month, to ${int(x.rising.latest)} people.`)
  else if (x.camp.best) s.push(`Best campaign lift: ${pts(x.camp.best.lift)} against its holdout, for ${x.camp.best.product}${x.camp.best.sample ? ' (a sample campaign, simulated)' : ''}.`)
  return s
}

/** The goal (focus goals first) whose demand rose most last month; null if none rose. */
export function risingGoal(rows: GoalTrend[]): GoalTrend | null {
  const pool = rows.some((r) => r.focus) ? rows.filter((r) => r.focus) : rows
  const up = pool.filter((r) => r.change !== null && r.change > 0 && (r.latest ?? 0) >= 10).sort((a, b) => (b.change ?? 0) - (a.change ?? 0))
  return up[0] ?? null
}

const TIER_RANK: Record<string, number> = { proven: 0, promising: 1, unclear: 2 }

/**
 * "How your products compare" (Home): measured products that have a comparison group (base rate and lift),
 * Proven first, then Promising, then no clear effect; within a tier the widest gap first (the figure the row
 * shows, so the column reads in order), then n.
 * `count`: how many qualify in all, so the panel can say "5 of 14".
 */
export function proofRows<R extends Pick<ProductRow, 'rate' | 'base_rate' | 'lift' | 'lift_lo' | 'n' | 'tier'>>(rows: R[], limit = 5): { rows: R[]; count: number } {
  const ok = rows.filter((r) => r.rate !== null && r.base_rate !== null && r.lift !== null && r.n !== null && r.tier in TIER_RANK)
  ok.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || (b.lift ?? 0) - (a.lift ?? 0) || (b.n ?? 0) - (a.n ?? 0))
  return { rows: ok.slice(0, limit), count: ok.length }
}
