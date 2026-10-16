import type { ReactNode } from 'react'

import { useRetailData } from '../context'
import { totalUsers } from '../data'
import { RANGES, useRetailState } from '../state'
import type { Insights } from '../types'
import { EmptyState, ErrorState, MIN_GROUP } from '../ui'

/**
 * Renders a section once the insights aggregates are in: `skeleton` while loading (drawn to the section's
 * final layout), an error with Retry, or "Not enough data" with the one filter that has data.
 */
export function InsightsGate({ skeleton, children }: { skeleton: ReactNode; children: (d: Insights) => ReactNode }) {
  const { insights, retry, filters } = useRetailData()
  const { setFilters } = useRetailState()
  if (insights.status === 'loading')
    return (
      <div role="status" aria-label="Loading aggregates" aria-busy="true">
        {skeleton}
      </div>
    )
  if (insights.status === 'failed') return <ErrorState title="The aggregates couldn’t load" body="The warehouse didn’t respond. No partial numbers are shown." onRetry={retry} />
  if (insights.status === 'empty') {
    const d = insights.d
    const n = totalUsers(d.cohort)
    const who = filters.cohort === 'real' ? 'real consented ' : filters.cohort === 'simulated' ? 'simulated ' : ''
    const when = filters.range === 'all' ? 'so far' : `in the ${RANGES.find((r) => r.value === filters.range)!.label.toLowerCase()} before ${d.filters?.today ?? 'today'}`
    return (
      <EmptyState
        glyph="00"
        title={filters.cohort === 'real' ? 'No consented data in this range' : 'Not enough data in this range'}
        body={n === 0 ? `No ${who}users shared aggregate results ${when}.` : `Only ${n} ${who}${n === 1 ? 'user' : 'users'} ${when}, below the reporting threshold of ${MIN_GROUP}.`}
        action={filters.cohort === 'simulated' && filters.range === 'all' ? undefined : { label: 'Show all time, simulated cohort', onClick: () => setFilters({ cohort: 'simulated', range: 'all' }) }}
      />
    )
  }
  return <>{children(insights.d)}</>
}

/** The workspace as an eyebrow ("RETAILER · ALL BRANDS", "BRAND VIEW · CERAVE"). */
export function useWorkspaceLabel(): string {
  const { workspace } = useRetailData()
  return workspace.kind === 'brand' ? `Brand view · ${workspace.brand ?? workspace.slug}` : 'Retailer · all brands'
}

/** A small "Yours" tag on rows of the brand being viewed as (text, so not colour alone). */
export function YoursTag() {
  return <span className="ml-2 inline-flex h-5 shrink-0 items-center rounded-pill bg-proof-leaf-soft px-2 align-middle text-proof-label font-medium text-proof-leaf">Yours</span>
}
