/**
 * Which journey demo mode shows: the team's seeded real journey (api /v1/demo/journey) or the
 * illustrative one. The choice is made once and then held, so a report never swaps its data while
 * someone is looking at it. The landing page reads the same choice, so its words match what opens.
 */
import { api, type SessionView } from '../lib/api'

export type DemoPick = { source: 'real'; views: SessionView[] } | { source: 'illustrative'; views: null }

const ILLUSTRATIVE: DemoPick = { source: 'illustrative', views: null }
/** How long the first look waits for the real journey before showing the illustration. */
const WAIT_MS = 1500
/** Signed photo URLs last about an hour: a journey older than this is fetched again. */
const FRESH_MS = 600_000

let journey: { views: SessionView[]; at: number } | null = null
let inflight: Promise<void> | null = null
let pick: DemoPick | null = null
// While demo mode is on, the pick is held: a late answer only counts for the next entry.
let held = false
const listeners = new Set<() => void>()

function fresh(): SessionView[] | null {
  return journey && Date.now() - journey.at < FRESH_MS ? journey.views : null
}

function choose(): DemoPick {
  const views = fresh()
  return views?.length ? { source: 'real', views } : ILLUSTRATIVE
}

function settle(next: DemoPick) {
  if (held || (pick && pick.source === next.source && pick.views === next.views)) return
  pick = next
  listeners.forEach((l) => l())
}

function fetchJourney(): Promise<void> {
  if (fresh()) return Promise.resolve()
  inflight ??= api
    .demoJourney()
    .then((r) => {
      journey = { views: r.sessions.filter((v) => v.session.status === 'done'), at: Date.now() }
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null
      settle(choose())
    })
  return inflight
}

/** The pick for this demo entry: waits up to 1.5 s for the real journey, then falls back. */
export async function pickDemo(): Promise<DemoPick> {
  if (held && pick) return pick
  const pending = fetchJourney()
  if (!fresh()) await Promise.race([pending, new Promise((r) => window.setTimeout(r, WAIT_MS))])
  settle(choose())
  return pick ?? ILLUSTRATIVE
}

/** The current pick, or null while undecided (or when a real journey has gone stale). */
export function peekDemo(): DemoPick | null {
  if (pick?.source === 'real' && !fresh()) return null
  return pick
}

/** Demo mode holds its pick from entry until it is left. */
export function holdDemo(p: DemoPick) {
  const changed = pick !== p
  pick = p
  held = true
  if (changed) listeners.forEach((l) => l())
}
export function releaseDemo() {
  held = false
}

export function subscribeDemo(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
