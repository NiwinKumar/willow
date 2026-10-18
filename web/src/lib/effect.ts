import type { MetricId, RoutineCheck, RoutineEntry, Session, Site } from '../data/types'
import type { Outcome } from './outcome'

/**
 * How the routine is doing, product by product (Home's "Routine effect"). Every fact is a number the engine
 * measured: whether the metric a product targets moved beyond the person's own normal range since the product
 * started (lib/outcome.ts), which way it moved, and how long the product has been in use. Nothing here is a
 * model's opinion, and timing stays an association, not proof. Pure (the app's lookups come in as `deps`,
 * wired in lib/routineEffect.ts), so `npm test` reads it without the app.
 */

export type MetricWords = { label: string; decrease: string; increase: string; sites: Site[] }
export type EffectDeps = {
  outcome: (e: RoutineEntry, sessions: Session[]) => Outcome
  /** The metrics a product's concerns point at. */
  targets: (e: RoutineEntry) => MetricId[]
  words: (m: MetricId) => MetricWords
  /** Sites a face product can show up on. */
  sites: Site[]
  day: (iso: string) => Date
  /** The baseline a session is compared with, among the sessions of its site. */
  baseline: (session: Session, sessions: Session[]) => Session | null
}

/** helping: a real change in the direction people usually want; away: a real change the other way; changed: a real change with no preferred direction (skin tone); steady: measured, nothing beyond the normal range; early: too soon to say. */
export type Effect = 'helping' | 'away' | 'changed' | 'steady' | 'early'

/** The direction of change people usually want per metric (docs/CONTRACT.md: "lower redness is usually desired"). Skin tone has none. */
const WANTED: Partial<Record<MetricId, 1 | -1>> = {
  pigment_spots: -1,
  tone_evenness: -1,
  redness: -1,
  blemishes: -1,
  pores: -1,
  texture: -1,
  lines: -1,
  shine: -1,
  dark_circles: 1,
  glow: 1,
}

/** Weeks without a change beyond the normal range after which a product is worth a second look (outcome text: most effects take 4 to 8 weeks). */
export const REVIEW_WEEKS = 8
/** Check-ins since the start a "no change" verdict needs before it can say a product may not be needed. */
const REVIEW_CHECKINS = 3

export type EffectFlag = { kind: 'review' | 'away' | 'overlap'; text: string; question: string }
export type EffectRow = {
  e: RoutineEntry
  o: Outcome
  effect: Effect
  /** Short line under the name: "Redness: calmer", "Too early to tell". */
  line: string
  days: number
  metric: MetricId | null
  /** The targeted metric's readings from the last check-in before the start to the latest. */
  points: { t: number; v: number }[]
  /** The person's baseline reading of that metric and the half-width of their normal range around it (for the chart's reference lines). */
  baseline: number | null
  band: number | null
  /** How to read the line: "Redness · lower is calmer" (none for skin tone). */
  reading: string | null
  flag: EffectFlag | null
}
export type RoutineEffect = { rows: EffectRow[]; counts: Record<Effect, number> }

const usable = (s: Session) => s.status === 'done' && s.measured !== false && Boolean(s.result?.quality.passed)
const valueOf = (s: Session, t: MetricId) => s.result?.metrics.find((m) => m.id === t)?.value ?? null
const nameOf = (e: Pick<RoutineEntry, 'custom_name' | 'brand'>) => e.custom_name || e.brand || 'this product'

/** The targeted metric's readings over time on one site: the last one before the start, then everything after. */
type Trend = { metric: MetricId; points: { t: number; v: number }[]; baseline: number | null; band: number | null }

function trend(entry: RoutineEntry, sessions: Session[], deps: EffectDeps, prefer: { metric: MetricId; site: Site } | null): Trend | null {
  const start = deps.day(entry.started_at).getTime()
  const targets = deps.targets(entry)
  const measured = sessions.filter(usable)
  const series = (t: MetricId, site: Site) => {
    const all = measured.filter((s) => s.site === site && valueOf(s, t) !== null).sort((a, b) => a.created_at.localeCompare(b.created_at))
    const after = all.filter((s) => new Date(s.created_at).getTime() >= start)
    const before = all.filter((s) => new Date(s.created_at).getTime() < start).slice(-1)
    return [...before, ...after]
  }
  const make = (t: MetricId, site: Site, used: Session[]): Trend => {
    const base = deps.baseline(used[used.length - 1], measured.filter((s) => s.site === site))
    const bm = base?.result?.metrics.find((m) => m.id === t)
    return { metric: t, points: used.map((s) => ({ t: new Date(s.created_at).getTime(), v: valueOf(s, t) as number })), baseline: bm?.value ?? null, band: bm?.mdc95 ?? null }
  }
  if (prefer) {
    const used = series(prefer.metric, prefer.site)
    if (used.length >= 2) return make(prefer.metric, prefer.site, used)
  }
  let best: { t: MetricId; site: Site; used: Session[] } | null = null
  for (const t of targets)
    for (const site of deps.words(t).sites.filter((x) => deps.sites.includes(x))) {
      const used = series(t, site)
      if (used.length >= 2 && (!best || used.length > best.used.length)) best = { t, site, used }
    }
  return best ? make(best.t, best.site, best.used) : null
}

/** "Redness · lower is calmer": which way the line should go, in the metric's own words. */
function readingOf(metric: MetricId, deps: EffectDeps): string | null {
  const w = deps.words(metric)
  const wanted = WANTED[metric]
  return wanted === undefined ? null : `${w.label} · ${wanted < 0 ? `lower is ${w.decrease}` : `higher is ${w.increase}`}`
}

export function routineEffect(entries: RoutineEntry[], sessions: Session[], check: RoutineCheck | undefined, deps: EffectDeps, now = Date.now()): RoutineEffect {
  const live = entries.filter((e) => !e.ended_at)
  const rows: EffectRow[] = []
  for (const e of live) {
    const o = deps.outcome(e, sessions)
    if (o.kind === 'unmeasured') continue
    const days = Math.max(0, Math.floor((now - deps.day(e.started_at).getTime()) / 86_400_000))
    const t = trend(e, sessions, deps, o.kind === 'real' ? { metric: o.metric, site: o.site } : null)
    const metric = o.kind === 'real' ? o.metric : (t?.metric ?? null)
    let effect: Effect = 'early'
    let line = 'Too early to tell'
    if (o.kind === 'real') {
      const delta = o.session.result?.metrics.find((m) => m.id === o.metric)?.delta ?? 0
      const wanted = WANTED[o.metric]
      effect = wanted === undefined ? 'changed' : Math.sign(delta) === wanted ? 'helping' : 'away'
      const w = deps.words(o.metric)
      line = `${w.label}: ${delta < 0 ? w.decrease : w.increase}`
    } else if (o.kind === 'none') {
      effect = 'steady'
      line = metric ? `${deps.words(metric).label}: no change beyond your normal range` : 'No change beyond your normal range'
    }
    const weeks = Math.floor(days / 7)
    let flag: EffectFlag | null = null
    if (effect === 'away' && metric) {
      flag = {
        kind: 'away',
        text: 'Moved the other way since you started. Worth reviewing.',
        question: `Since I started my ${nameOf(e)}, my ${deps.words(metric).label.toLowerCase()} moved the other way. What should I change?`,
      }
    } else if (effect === 'steady' && weeks >= REVIEW_WEEKS && (t?.points.length ?? 0) - 1 >= REVIEW_CHECKINS && metric) {
      flag = {
        kind: 'review',
        text: `No change beyond your normal range after ${weeks} weeks. You may not need it.`,
        question: `My ${nameOf(e)} shows no change in ${deps.words(metric).label.toLowerCase()} after ${weeks} weeks. Do I still need it?`,
      }
    }
    rows.push({ e, o, effect, line, days, metric, points: t?.points ?? [], baseline: t?.baseline ?? null, band: t?.band ?? null, reading: metric ? readingOf(metric, deps) : null, flag })
  }
  // Two products that share an active: the one used less long may be the one to drop.
  for (const d of check?.duplicates ?? []) {
    const pair = rows.filter((r) => d.products.includes(r.e.id))
    if (pair.length < 2) continue
    const [a, b] = pair
    for (const r of pair) {
      if (r.flag) continue
      const other = r === a ? b : a
      r.flag = { kind: 'overlap', text: `Shares ${d.active} with ${nameOf(other.e)}. You may not need both.`, question: `Do I need ${d.active} in both ${nameOf(a.e)} and ${nameOf(b.e)}?` }
    }
  }
  const rank: Record<Effect, number> = { away: 0, helping: 1, changed: 2, steady: 3, early: 4 }
  rows.sort((a, b) => Number(Boolean(b.flag)) - Number(Boolean(a.flag)) || rank[a.effect] - rank[b.effect])
  const counts: Record<Effect, number> = { helping: 0, away: 0, changed: 0, steady: 0, early: 0 }
  for (const r of rows) counts[r.effect]++
  return { rows, counts }
}

/** The headline over the rows: how many of the products that can be judged show a real change in the wanted direction. */
export function effectHeadline(c: Record<Effect, number>): string {
  const judged = c.helping + c.away + c.changed + c.steady
  if (judged === 0) return 'Too early to say what your routine is doing.'
  if (c.helping === 0 && c.away === 0) return c.changed ? 'Some products changed something Willow measures.' : 'Nothing has moved beyond your normal range yet.'
  const word = c.helping === 1 ? 'product shows' : 'products show'
  return `${c.helping} of ${judged} ${word} a real change in the direction you want.`
}
