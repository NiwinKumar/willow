/**
 * The end of a whole check-in (step "sent"): where each place stands, read live from the session the DataProvider
 * keeps polling. Pure (data/live.ts and lib/metrics.ts only), so `npm test` can load it.
 */
import { inFlight, stalled } from '../../data/live.ts'
import type { Session, Site } from '../../data/types.ts'
import { isCloseUp } from '../../lib/metrics.ts'

export type PlaceState = { kind: 'measuring' | 'slow' | 'ready' | 'retake' | 'failed'; line: string; view: boolean }

type Read = Pick<Session, 'status' | 'created_at' | 'result'>

/**
 * One place's line. Close-ups say how long they take (the engine needs over two minutes on a cheek, api
 * engine.py), so a judge watching knows to wait or go Home: the app-wide "Your result is ready" note
 * (progress/useResultReady.ts) says when it lands.
 */
export function placeState(site: Site, session: Read | undefined): PlaceState {
  if (!session || inFlight(session)) {
    if (session && stalled(session)) return { kind: 'slow', line: 'Taking longer than usual', view: true }
    return { kind: 'measuring', line: isCloseUp(site) ? 'Measuring · close-ups take a few minutes' : 'Measuring', view: false }
  }
  if (session.status === 'failed') return { kind: 'failed', line: 'Didn’t finish', view: true }
  if (session.result && !session.result.quality.passed) return { kind: 'retake', line: 'Back · photos need another try', view: true }
  return { kind: 'ready', line: 'Ready', view: true }
}

/** The title over the list: honest about what is still on its way. */
export function sentTitle(states: PlaceState[]): string {
  if (!states.length) return 'Nothing was sent'
  const waiting = states.filter((s) => s.kind === 'measuring').length
  if (!waiting) return states.every((s) => s.kind === 'ready') ? 'Your check-in is ready' : 'Your check-in is back'
  return waiting === states.length ? 'All photos are in' : 'Some places are ready'
}
