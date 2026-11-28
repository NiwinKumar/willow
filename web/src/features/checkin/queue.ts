import type { AnalysisStage, QueuePlace } from '../../lib/api'

/**
 * The api's line in front of the measurement engine (api engine_gate.py). While a check-in waits there it is
 * measured only if this page keeps asking: the api answers 409 `queued` when one request's wait runs out and the
 * page asks again, keeping its place. So the screen says to keep it open, never that the person can leave.
 */

/** "In line · about 90 s (place 3). Keep this open; your place is kept." */
export function queueLine(q: QueuePlace | null): string {
  const where = q ? ` · about ${q.eta_s} s (place ${q.position})` : ''
  return `In line${where}. Keep this open; your place is kept.`
}

/** The place from a 409 analyze answer that says it is still in line, else null. */
export function queuedPlace(detail: Record<string, unknown> | null): QueuePlace | null {
  if (!detail || detail.queued !== true) return null
  const { position, eta_s } = detail
  return typeof position === 'number' && typeof eta_s === 'number' ? { position, eta_s } : null
}

/**
 * The place to show after a reading of the session: its own place while it says "queued"; none once the engine
 * has it; otherwise the last place (between one ask and the next the session reads "received" or not processing).
 */
export function nextPlace(prev: QueuePlace | null, stage: AnalysisStage | null | undefined, place: QueuePlace | null | undefined): QueuePlace | null {
  if (stage === 'queued') return place ?? prev
  if (stage === 'engine' || stage === 'explaining') return null
  return prev
}
