import type { Insights, ProductRow, Segments } from '../../types.ts'

/*
 * Pure helpers behind the Customers page. They only re-express numbers the api sent (shares of a month's
 * people, ownership of a goal); no new measurement. Tests: tests/proof-customers.test.ts.
 */

export type MatrixMode = 'unmet' | 'people' | 'best'
export const MATRIX_MODES: { value: MatrixMode; label: string }[] = [
  { value: 'unmet', label: 'Unmet need' },
  { value: 'people', label: 'People' },
  { value: 'best', label: 'Best product' },
]
export const parseMode = (v: string | null): MatrixMode => (v === 'people' || v === 'best' ? v : 'unmet')

export type SegCell = Segments['cells'][number]
export const cellKey = (c: Pick<SegCell, 'skin' | 'goal'>) => `${c.skin}.${c.goal}`

export type GoalTrend = {
  goal_id: string
  /** Share of each month's people (with a reading) who chose the goal, as whole percents; null under 10. */
  shares: (number | null)[]
  /** The last two months that both have a share, in whole percents, and the change in points. */
  prev: number | null
  last: number | null
  delta: number | null
  prevMonth: string | null
  lastMonth: string | null
  dir: 'up' | 'down' | 'flat' | null
}

/**
 * Per goal: its share of each month's people, and the change between the last two months, as the api's
 * "rising goal" brief card computes it (whole percents of people with a reading that month).
 */
export function goalTrends(nbm: Insights['needs_by_month']): Map<string, GoalTrend> {
  const out = new Map<string, GoalTrend>()
  if (!nbm) return out
  const { months, people } = nbm
  for (const g of nbm.goals) {
    const shares = g.counts.map((c, i) => {
      const p = people[i]
      return c === null || p === null || !p ? null : Math.round((c / p) * 100)
    })
    let prev: number | null = null
    let last: number | null = null
    let prevMonth: string | null = null
    let lastMonth: string | null = null
    if (shares.length >= 2 && shares.at(-1) !== null && shares.at(-2) !== null) {
      prev = shares.at(-2)!
      last = shares.at(-1)!
      prevMonth = months.at(-2) ?? null
      lastMonth = months.at(-1) ?? null
    }
    const delta = prev === null || last === null ? null : last - prev
    out.set(g.goal_id, { goal_id: g.goal_id, shares, prev, last, delta, prevMonth, lastMonth, dir: delta === null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' })
  }
  return out
}

/** A brand's catalogue products made for a goal, measured ones first (rate high to low). */
export function ownForGoal<P extends Pick<ProductRow, 'brand' | 'goal_ids' | 'rate' | 'n'>>(products: P[], brand: string, goal: string): P[] {
  return products
    .filter((p) => p.brand === brand && p.goal_ids.includes(goal))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || (b.n ?? 0) - (a.n ?? 0))
}

/** The cell's fill for the matrix: unmet on a gray-to-amber ramp, people on a gray ramp; null = hatched. */
export function cellFill(mode: MatrixMode, c: SegCell, maxUsers: number): string | null {
  if (mode === 'unmet') return c.unmet === null ? null : `color-mix(in oklch, var(--pf-amber) ${Math.round(c.unmet * 60)}%, var(--bg-sunken))`
  if (mode === 'people') return c.users === null ? null : `color-mix(in srgb, var(--text-primary) ${Math.round((c.users / (maxUsers || 1)) * 30)}%, var(--bg-sunken))`
  return 'var(--bg-sunken)'
}
