import type { CohortCounts } from './cohort'

/**
 * Round 1 put a "SIMULATED" badge on every chart. Round 2 says what is counted once, in the top bar's data
 * scope control (Retail.tsx), so this renders nothing; it stays exported so older call sites compile.
 */
export function SimBadge(_: { cohort: CohortCounts }) {
  return null
}
