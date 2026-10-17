import { baselineFor } from '../data/live'
import type { MetricId, RoutineEntry, Session, Site } from '../data/types'
import { CONCERN_METRICS } from './catalog'
import { parseDate } from './format'
import { CLOSE_UPS, METRIC_META, fmtSigned, fmtValue, unitOf } from './metrics'
import { VERDICT_WORDS } from './verdict'

export type Outcome =
  | { kind: 'real'; metric: MetricId; site: Site; text: string; detail: string; session: Session; band: number | null }
  | { kind: 'none'; text: string; detail: string }
  | { kind: 'early'; text: string; detail: string }
  | { kind: 'unmeasured'; text: string; detail: string }

/** Sites a face product can show up on: the full face and the close-ups. */
export const OUTCOME_SITES: Site[] = ['face_full', ...CLOSE_UPS]

const usable = (s: Session) => s.status === 'done' && s.measured !== false && Boolean(s.result?.quality.passed)
const hasValue = (s: Session, t: MetricId) => (s.result?.metrics ?? []).some((m) => m.id === t && m.value !== null)
const names = (ts: MetricId[]) => [...new Set(ts.map((t) => METRIC_META[t].label.toLowerCase()))].join(' and ')

/**
 * Outcome chip for a routine product: the target metrics come from its concerns (docs/CATALOG_SPEC.md),
 * each read on the sites that measure it (pores and texture on close-ups), only sessions after the
 * start date count, and the words follow the verdict ladder. Causation stays hedged.
 * `sessions` are the face and close-up sessions, each carrying its site.
 */
export function outcomeFor(entry: RoutineEntry, sessions: Session[]): Outcome {
  if (entry.concerns.length === 0 && entry.source === 'label_scan' && !entry.product_id)
    return { kind: 'unmeasured', text: 'Concerns unknown', detail: 'This product is not in the catalog, so Willow does not know which measurements it targets.' }
  const targets = [...new Set(entry.concerns.flatMap((c) => CONCERN_METRICS[c] ?? []) as MetricId[])]
  if (targets.length === 0) return { kind: 'unmeasured', text: 'Not measured', detail: 'This product targets nothing Willow measures (cleansers and barrier creams, for example).' }
  // Only real measurements count: done, measured (not a placeholder), photo quality passed.
  const measured = sessions.filter(usable)
  const sitesOf = (t: MetricId) => METRIC_META[t].sites.filter((s) => OUTCOME_SITES.includes(s))
  // A target is checked on a site once a measured session there has a value for it. Never call an
  // unmeasured target "no change".
  const pairs = targets.flatMap((t) => sitesOf(t).filter((site) => measured.some((s) => s.site === site && hasValue(s, t))).map((site) => ({ t, site })))
  if (pairs.length === 0) {
    const faceTargets = targets.filter((t) => sitesOf(t).includes('face_full'))
    const closeUpTargets = targets.filter((t) => !sitesOf(t).includes('face_full') && sitesOf(t).length > 0)
    const faceDone = measured.some((s) => s.site === 'face_full')
    if (faceTargets.length && !faceDone)
      return { kind: 'unmeasured', text: 'Not measured yet', detail: 'No face photo has been measured yet. Take a face session to see whether this product changed anything.' }
    if (closeUpTargets.length)
      return { kind: 'unmeasured', text: 'Not measured yet', detail: `This product targets ${names(closeUpTargets)}, which a cheek close-up measures. Take one to see whether this product changed anything.` }
    return { kind: 'unmeasured', text: 'Not measured yet', detail: `This product targets ${names(targets)}, which Willow does not measure yet.` }
  }
  const start = parseDate(entry.started_at)
  const weeks = Math.max(0, Math.floor((Date.now() - start.getTime()) / (7 * 86_400_000)))
  const afterOn = (site: Site) => measured.filter((s) => s.site === site && !s.is_baseline && new Date(s.created_at) >= start)
  const checkIns = Math.max(...pairs.map((p) => afterOn(p.site).length))
  if (checkIns < 2 || weeks < 2) {
    const since = weeks === 0 ? 'Started this week.' : `Started ${weeks} week${weeks === 1 ? '' : 's'} ago.`
    const need = checkIns < 2 ? `Willow needs at least two check-ins after the start date (${checkIns} so far).` : 'Most changes take at least two weeks to show.'
    return { kind: 'early', text: VERDICT_WORDS.notEnough.label, detail: `${since} ${need}` }
  }
  const judged = new Set<MetricId>()
  for (const { t, site } of pairs) {
    const after = afterOn(site)
    if (after.length < 2) continue
    const m = after[after.length - 1].result?.metrics.find((x) => x.id === t)
    // only an actual comparison counts as judged: "no baseline" (a metric newer than the
    // baseline) or a failed photo is "not enough check-ins yet", never "inside your band"
    if (m && (m.verdict === 'within_noise' || m.verdict === 'real_change')) judged.add(t)
    if (m && m.verdict === 'real_change' && m.delta !== null) {
      const latest = after[after.length - 1]
      // The normal range is the baseline's mdc95 (the band the api judged against), not this session's own spread.
      const band = baselineFor(latest, sessions.filter((s) => s.site === site))?.result?.metrics.find((x) => x.id === t)?.mdc95 ?? null
      // Rounded as the result screen and its explanation round them: at this session's own precision.
      const delta = `${fmtSigned(m.delta, m)}${unitOf(m) === '°' ? '°' : unitOf(m) === '%' ? ' pts' : unitOf(m) ? ` ${unitOf(m).trim()}` : ''}`
      return {
        kind: 'real',
        metric: t,
        site,
        session: latest,
        band,
        text: `${VERDICT_WORDS.changed.label}: ${METRIC_META[m.id].label.toLowerCase()}`,
        detail: `Started ${weeks} weeks ago. Latest reading vs your baseline: ${METRIC_META[m.id].label.toLowerCase()} ${delta}${band !== null ? `, normal range ±${fmtValue(band, m)}` : ''}. The change may be linked to this product; other products or habits could also contribute.`,
      }
    }
  }
  // Name only what was judged: a target without two check-ins on its site is not "no change".
  if (judged.size === 0)
    return { kind: 'early', text: VERDICT_WORDS.notEnough.label, detail: 'Willow has no comparable check-ins for what this product targets yet: the measurements need a baseline and two check-ins after the start date.' }
  const open = targets.filter((t) => !judged.has(t))
  const rest = open.length ? ` ${names(open).charAt(0).toUpperCase() + names(open).slice(1)}: not enough check-ins yet.` : ''
  return { kind: 'none', text: `${VERDICT_WORDS.normal.label} so far (${weeks} wks)`, detail: `${names([...judged]).charAt(0).toUpperCase() + names([...judged]).slice(1)}: within your normal range so far. Most effects take 4 to 8 weeks to show beyond normal photo variation.${rest}` }
}
