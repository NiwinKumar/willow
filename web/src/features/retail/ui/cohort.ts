import type { Insights } from '../types'

export type CohortCounts = Insights['cohort']

/** What the rows on screen are: simulated only, real only, or both (for badges, banners and exports). */
export type CohortKind = 'simulated' | 'mixed' | 'real'
export function cohortKind(c: CohortCounts): CohortKind {
  if (c.real === 0) return 'simulated'
  if (c.synthetic === 0) return 'real'
  return 'mixed'
}

const n = (v: number) => v.toLocaleString('en-GB')

/**
 * The cohort's size in exact words: "35,000 simulated + 8 real people". Never a bare total ("35,008") and never
 * "mixed": a few real people among the simulated ones must not read as real data.
 */
export function cohortSizeText(c: CohortCounts): string {
  if (c.real === 0) return `${n(c.synthetic)} simulated people`
  if (c.synthetic === 0) return `${n(c.real)} real ${c.real === 1 ? 'person' : 'people'}`
  return `${n(c.synthetic)} simulated + ${n(c.real)} real ${c.real === 1 ? 'person' : 'people'}`
}

/** The People filter's label for the api's `mixed` value: what it holds, with the real count once it is known. */
export function mixedLabel(c: CohortCounts | null | undefined): string {
  if (!c) return 'Simulated + real'
  return c.real === 0 ? 'Simulated' : `Simulated + ${n(c.real)} real`
}
