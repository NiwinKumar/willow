import { cohortKind, type CohortCounts } from './cohort'

/** "SIMULATED" badge on every chart while any row is simulated (docs/DESIGN.md "Retail charts"). Yellow, hatched. */
export function SimBadge({ cohort }: { cohort: CohortCounts }) {
  const kind = cohortKind(cohort)
  if (kind === 'real') return null
  return (
    <span className="retail-synthetic inline-flex h-5 items-center rounded-pill px-2 font-mono text-[10px] tracking-[.08em]">
      {kind === 'mixed' ? (cohort.synthetic > cohort.real ? 'MIXED · MOSTLY SIMULATED' : 'MIXED · PART SIMULATED') : 'SIMULATED'}
    </span>
  )
}
