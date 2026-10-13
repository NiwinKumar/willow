import type { RoutineEntry, Session } from '../data/types'
import { CONCERN_METRICS } from '../mock/catalog'
import { METRIC_META, fmtSigned, fmtValue } from './metrics'

export type Outcome =
  | { kind: 'real'; metric: string; text: string; detail: string }
  | { kind: 'none'; text: string; detail: string }
  | { kind: 'early'; text: string; detail: string }
  | { kind: 'unmeasured'; text: string; detail: string }

/**
 * Outcome chip for a routine product: the target metrics come from its concerns (docs/CATALOG_SPEC.md),
 * only sessions after the start date count, and the words follow the verdict ladder. Causation stays hedged.
 */
export function outcomeFor(entry: RoutineEntry, sessions: Session[]): Outcome {
  if (entry.concerns.length === 0 && entry.source === 'label_scan' && !entry.product_id)
    return { kind: 'unmeasured', text: 'Concerns unknown', detail: 'This product is not in the catalog, so Willow does not know which measurements it targets.' }
  const targets = entry.concerns.flatMap((c) => CONCERN_METRICS[c] ?? [])
  if (targets.length === 0) return { kind: 'unmeasured', text: 'Not measured', detail: 'This product targets nothing Willow measures (cleansers and barrier creams, for example).' }
  // Only real measurements count: done, measured (not a placeholder), photo quality passed.
  const measured = sessions.filter((s) => s.status === 'done' && s.measured !== false && s.result?.quality.passed)
  if (measured.length === 0)
    return { kind: 'unmeasured', text: 'Not measured yet', detail: 'Willow measures forearm photos today. Face results for products appear once face measurement is ready.' }
  const after = measured.filter((s) => !s.is_baseline && new Date(s.created_at) >= new Date(entry.started_at))
  const weeks = Math.floor((Date.now() - new Date(entry.started_at).getTime()) / (7 * 86_400_000))
  if (after.length < 2 || weeks < 2) return { kind: 'early', text: 'Too early to tell', detail: `Started ${weeks} week${weeks === 1 ? '' : 's'} ago. Willow needs at least two check-ins after a start date.` }
  const latest = after[after.length - 1]
  for (const t of targets) {
    const m = latest.result?.metrics.find((x) => x.id === t)
    if (m && m.verdict === 'real_change' && m.delta !== null) {
      return {
        kind: 'real',
        metric: t,
        text: `Real change in ${METRIC_META[m.id].label.toLowerCase()}`,
        detail: `Started ${weeks} weeks ago. Latest reading vs your baseline: ${METRIC_META[m.id].label.toLowerCase()} ${fmtSigned(m.delta, m)}, noise threshold ${m.mdc95 !== null ? fmtValue(m.mdc95, m) : '–'}. The change may be linked to this product; other products or habits could also contribute.`,
      }
    }
  }
  return { kind: 'none', text: `No clear change yet (${weeks} wks)`, detail: `The metrics this product targets are inside your noise band so far. Most effects take 4 to 8 weeks to exceed photo noise.` }
}
