import type { Metric, Session } from '../../data/types.ts'
import { METRIC_META, fmtValue, unitOf } from '../../lib/metrics.ts'
import { changeWay, verdictKind } from '../../lib/verdict.ts'

/**
 * What a measurement card says first after the baseline: the verdict in words ("Calmer than your start",
 * "No real change"), with the numbers as a small "before → now" line. The verdict is the api's own (a change
 * only when it is bigger than this person's normal photo-to-photo range). The baseline session itself keeps
 * its number up front (null here): there is nothing to compare yet. `against` names what it was compared with: the
 * start, or (blemishes and dark spots) the last check-in taken the same way (LAST_LIKE_THIS).
 */
export const LAST_LIKE_THIS = 'your last check-in like this'

export function verdictHeadline(m: Metric, session: Pick<Session, 'is_baseline'>, against = 'your start'): { headline: string; numbers: string | null } | null {
  if (session.is_baseline || m.value === null) return null
  const kind = verdictKind(m, session)
  const unit = unitOf(m).trim()
  const fmt = (v: number) => `${fmtValue(v, m)}${unit === '°' ? '°' : unit ? ` ${unit}` : ''}`
  const numbers = m.delta !== null && m.delta !== undefined ? `${fmt(m.value - m.delta)} → ${fmt(m.value)}` : fmt(m.value)
  if (kind === 'changed') {
    const way = changeWay(m)
    // Skin tone is descriptive: a shift is reported, never a better direction. A change the other way is said
    // gently ("Moved the other way"), never "worse".
    if (way === 'shifted') return { headline: `Shifted since ${against}`, numbers }
    if (way === 'otherWay') return { headline: `Moved the other way since ${against}`, numbers }
    const meta = METRIC_META[m.id]
    const words = (m.delta ?? 0) < 0 ? meta.decrease : meta.increase
    return { headline: `${words.charAt(0).toUpperCase()}${words.slice(1)} than ${against}`, numbers }
  }
  if (kind === 'normal') return { headline: 'No real change', numbers }
  if (kind === 'notEnough') return { headline: 'Too early to tell', numbers }
  return { headline: 'Not compared this time', numbers }
}
