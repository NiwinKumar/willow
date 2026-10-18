import type { MetricId, RoutineCheck, RoutineEntry, Session } from '../data/types'
import { CONCERN_METRICS } from './catalog'
import { routineEffect as effectOf, type EffectDeps } from './effect'
import { parseDate } from './format'
import { METRIC_META } from './metrics'
import { OUTCOME_SITES, outcomeFor } from './outcome'

const deps: EffectDeps = {
  outcome: outcomeFor,
  targets: (e) => [...new Set(e.concerns.flatMap((c) => CONCERN_METRICS[c] ?? []) as MetricId[])],
  words: (m) => METRIC_META[m],
  sites: OUTCOME_SITES,
  day: parseDate,
}

/** The app's routine effect: lib/effect.ts wired to the real outcome rule, concern map and metric wording. */
export const routineEffect = (entries: RoutineEntry[], sessions: Session[], check: RoutineCheck | undefined) => effectOf(entries, sessions, check, deps)
