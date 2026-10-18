/**
 * Verdict words and glyphs, in one place (docs/DESIGN.md "Verdicts & confidence", with the words chosen in
 * design-from-claude-design/APP_PLAN.md): every screen shows the glyph AND the words, never colour alone.
 *
 *   api real_change, in the direction wanted         ◆ Improved                 (ember: the only data accent)
 *   api real_change, the other way                   ◇ Moved the other way      (never "worse": it softens the news)
 *   api real_change of skin tone (no direction)      ◆ Shifted                  (no tone is better than another)
 *   api within_noise                                 ○ Within normal range
 *   api no_baseline on the baseline session itself   · Baseline
 *   api no_baseline with a delta (no band yet)       ◌ Not enough data yet
 *   api no_baseline otherwise, low_quality, no value — Could not compare
 */
import type { Metric, MetricId, Session, Verdict } from '../data/types'

export type VerdictKind = 'changed' | 'normal' | 'baseline' | 'notEnough' | 'notCompared'

export const VERDICT_WORDS: Record<VerdictKind, { glyph: string; label: string; short: string; long: string }> = {
  // The words of a change without its direction; a metric's change is said with CHANGE_WORDS (wordsFor).
  changed: { glyph: '◆', label: 'Beyond your normal range', short: 'Beyond range', long: 'Beyond your normal range' },
  normal: { glyph: '○', label: 'Within normal range', short: 'Normal range', long: 'Within your normal range' },
  baseline: { glyph: '·', label: 'Baseline', short: 'Baseline', long: 'Baseline: later check-ins are compared with this' },
  notEnough: { glyph: '◌', label: 'Not enough data yet', short: 'Not enough data', long: 'Not enough data yet: your baseline has no normal range for this' },
  notCompared: { glyph: '—', label: 'Could not compare', short: 'Not compared', long: 'Could not compare with your baseline this time' },
}

/** The verdict a metric shows, from the api's verdict and whether this session is the baseline. */
export function verdictKind(m: Pick<Metric, 'verdict' | 'value' | 'delta'>, session?: Pick<Session, 'is_baseline'> | null): VerdictKind {
  if (m.value === null) return 'notCompared'
  const v: Verdict = m.verdict
  if (v === 'real_change') return 'changed'
  if (v === 'within_noise') return 'normal'
  if (v === 'low_quality') return 'notCompared'
  // no_baseline
  if (session?.is_baseline) return 'baseline'
  return m.delta !== null && m.delta !== undefined ? 'notEnough' : 'notCompared'
}

/** Counts of each verdict in a session (hero chips, Home's lead card). */
export function verdictCounts(session: Session | null | undefined): Record<VerdictKind, number> {
  const out: Record<VerdictKind, number> = { changed: 0, normal: 0, baseline: 0, notEnough: 0, notCompared: 0 }
  for (const m of session?.result?.metrics ?? []) out[verdictKind(m, session)]++
  return out
}

/** Confidence chip (● Measured / ◐ Indicative / ◌ Trend only). Face metrics are always indicative today. */
export function confidenceOf(m: Pick<Metric, 'confidence'>, session?: Pick<Session, 'capture_mode' | 'baseline_ref'> | null): { glyph: string; label: string } {
  if (session?.baseline_ref && !session.baseline_ref.has_noise_band) return { glyph: '◌', label: 'Trend only' }
  return m.confidence === 'measured' ? { glyph: '●', label: 'Measured' } : { glyph: '◐', label: 'Indicative' }
}

/** The direction of change people usually want per metric (docs/CONTRACT.md: "lower redness is usually desired"). Skin tone has none. */
export const WANTED: Partial<Record<MetricId, 1 | -1>> = {
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

/** A real change, by its direction: toward what people usually want, the other way, or skin tone (no direction). */
export type ChangeWay = 'improved' | 'otherWay' | 'shifted'

export function changeWay(m: Pick<Metric, 'id' | 'delta'>): ChangeWay {
  const wanted = WANTED[m.id]
  if (wanted === undefined || !m.delta) return 'shifted'
  return Math.sign(m.delta) === wanted ? 'improved' : 'otherWay'
}

/** A change is never just "changed": it improved, or moved the other way (gently, never "worse"), or skin tone shifted. */
export const CHANGE_WORDS: Record<ChangeWay, { glyph: string; label: string; short: string; long: string }> = {
  improved: { glyph: '◆', label: 'Improved', short: 'Improved', long: 'Improved, beyond your normal range' },
  otherWay: { glyph: '◇', label: 'Moved the other way', short: 'Other way', long: 'Moved the other way, beyond your normal range' },
  shifted: { glyph: '◆', label: 'Shifted', short: 'Shifted', long: 'Shifted beyond your normal range (no tone is better than another)' },
}

/** The words a metric's verdict is shown with: its change's direction, or the verdict itself. */
export function wordsFor(m: Pick<Metric, 'id' | 'verdict' | 'value' | 'delta'>, session?: Pick<Session, 'is_baseline'> | null) {
  const kind = verdictKind(m, session)
  return kind === 'changed' ? CHANGE_WORDS[changeWay(m)] : VERDICT_WORDS[kind]
}

/** How many of a session's real changes went each way. */
export function changeCounts(session: Session | null | undefined): Record<ChangeWay, number> {
  const out: Record<ChangeWay, number> = { improved: 0, otherWay: 0, shifted: 0 }
  for (const m of session?.result?.metrics ?? []) if (verdictKind(m, session) === 'changed') out[changeWay(m)]++
  return out
}

/** "2 improved", "1 moved the other way", "1 shifted": the changes of a session in words, best news first. */
export function changeLines(session: Session | null | undefined): { way: ChangeWay; n: number; text: string }[] {
  const c = changeCounts(session)
  return (['improved', 'otherWay', 'shifted'] as const).filter((w) => c[w] > 0).map((w) => ({ way: w, n: c[w], text: `${c[w]} ${CHANGE_WORDS[w].label.toLowerCase()}` }))
}

/** The words a metric moved with, for headlines: what people want ("Calmer"), else gently ("Moved the other way"). */
export function movedWords(m: Pick<Metric, 'id' | 'delta'>, meta: { decrease: string; increase: string }): string {
  const way = changeWay(m)
  if (way === 'shifted') return CHANGE_WORDS.shifted.label
  if (way === 'otherWay') return CHANGE_WORDS.otherWay.label
  const w = (m.delta ?? 0) < 0 ? meta.decrease : meta.increase
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** A title for a set of real changes: "Redness improved", "3 measures improved", "2 improved, 1 moved the other way". */
export function changeTitle(changed: Pick<Metric, 'id' | 'delta'>[], label: (m: Pick<Metric, 'id' | 'delta'>) => string): string {
  if (changed.length === 1) return `${label(changed[0])} ${CHANGE_WORDS[changeWay(changed[0])].label.toLowerCase()}`
  const c: Record<ChangeWay, number> = { improved: 0, otherWay: 0, shifted: 0 }
  for (const m of changed) c[changeWay(m)]++
  const parts = (['improved', 'otherWay', 'shifted'] as const).filter((w) => c[w])
  if (parts.length === 1) return `${changed.length} measures ${CHANGE_WORDS[parts[0]].label.toLowerCase()}`
  const text = parts.map((w) => `${c[w]} ${CHANGE_WORDS[w].label.toLowerCase()}`).join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
