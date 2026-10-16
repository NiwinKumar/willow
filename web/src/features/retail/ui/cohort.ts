import type { Insights } from '../types'

export type CohortCounts = Insights['cohort']

/** What the rows on screen are: simulated only, real only, or both (for badges, banners and exports). */
export type CohortKind = 'simulated' | 'mixed' | 'real'
export function cohortKind(c: CohortCounts): CohortKind {
  if (c.real === 0) return 'simulated'
  if (c.synthetic === 0) return 'real'
  return 'mixed'
}
