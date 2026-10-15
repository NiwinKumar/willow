/**
 * Verdict words and glyphs, in one place (docs/DESIGN.md "Verdicts & confidence", with the words chosen in
 * design-from-claude-design/APP_PLAN.md): every screen shows the glyph AND the words, never colour alone.
 *
 *   api real_change                                  ◆ Changed                  (ember: the only data accent)
 *   api within_noise                                 ○ Within normal range
 *   api no_baseline on the baseline session itself   · Baseline
 *   api no_baseline with a delta (no band yet)       ◌ Not enough data yet
 *   api no_baseline otherwise, low_quality, no value — Could not compare
 */
import type { Metric, Session, Verdict } from '../data/types'

export type VerdictKind = 'changed' | 'normal' | 'baseline' | 'notEnough' | 'notCompared'

export const VERDICT_WORDS: Record<VerdictKind, { glyph: string; label: string; short: string; long: string }> = {
  changed: { glyph: '◆', label: 'Changed', short: 'Changed', long: 'Changed: bigger than your normal range' },
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
