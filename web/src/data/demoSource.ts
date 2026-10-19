/**
 * Demo mode shows Mei's journey, a simulated person (generated photos), measured by the live engine (api /v1/demo/journey).
 * There is no illustrative fallback: when the journey cannot be read, demo mode says so.
 * The journey is read once per entry and held, so a report never swaps its data while someone looks at it.
 */
import { api, type SessionView } from '../lib/api'

/** `empty`: the api answered but the journey has no measured sessions; `error`: the api did not answer. */
export type DemoPick = { source: 'real'; views: SessionView[] } | { source: 'unavailable'; views: null; reason: 'empty' | 'error' }

/** Signed photo URLs last about an hour: a journey older than this is fetched again. */
const FRESH_MS = 600_000

let journey: { views: SessionView[]; at: number } | null = null
let inflight: Promise<DemoPick> | null = null
let pick: DemoPick | null = null
let held = false

function fresh(): SessionView[] | null {
  return journey && Date.now() - journey.at < FRESH_MS ? journey.views : null
}

/** The journey for this demo entry (one request at a time; an answer under 10 minutes old is reused). */
export function pickDemo(): Promise<DemoPick> {
  if (held && pick?.source === 'real') return Promise.resolve(pick)
  const views = fresh()
  if (views) return Promise.resolve((pick = views.length ? { source: 'real', views } : { source: 'unavailable', views: null, reason: 'empty' }))
  return request()
}

/**
 * The journey's sessions for Mei's story (/journey): the answer the landing page already asked for when it is
 * under 10 minutes old, else a new request. Never a held pick, whose photo links may be older than an hour.
 */
export function journeyViews(): Promise<SessionView[]> {
  const views = fresh()
  if (views) return Promise.resolve(views)
  return request().then(() => {
    const v = fresh()
    if (!v) throw new Error('journey unavailable')
    return v
  })
}

const warmed: HTMLImageElement[] = []

/**
 * Mei's first face photo (the "Meet Mei" slide) starts loading now, at high priority, so the slide draws it from
 * the browser's memory. Called when /journey opens and when a pointer or focus reaches a link to it.
 */
export function warmFirstPhoto(views: SessionView[] | null | undefined) {
  const url = (views ?? [])
    .filter((v) => v.session.site === 'face_full' && v.session.preview)
    .sort((a, b) => a.session.created_at.localeCompare(b.session.created_at))[0]?.session.preview?.url
  if (!url || warmed.some((img) => img.src === url)) return
  const img = new Image()
  img.fetchPriority = 'high'
  img.decoding = 'async'
  img.src = url
  warmed.splice(0, warmed.length, img)
}

function request(): Promise<DemoPick> {
  inflight ??= api
    .demoJourney()
    .then((r) => {
      journey = { views: r.sessions.filter((v) => v.session.status === 'done'), at: Date.now() }
      return journey.views.length ? ({ source: 'real', views: journey.views } as const) : ({ source: 'unavailable', views: null, reason: 'empty' } as const)
    })
    .catch(() => ({ source: 'unavailable', views: null, reason: 'error' }) as const)
    .then((p) => {
      inflight = null
      if (!held) pick = p
      return p
    })
  return inflight
}

/** Why the demo journey is unavailable (for honest copy), or null when it is not. */
export function demoUnavailable(): 'empty' | 'error' | null {
  return pick?.source === 'unavailable' ? pick.reason : null
}

/** The current pick, or null while undecided (or when the journey's photo links have gone stale). */
export function peekDemo(): DemoPick | null {
  if (pick?.source === 'real' && !fresh()) return null
  return pick
}

/** Demo mode holds its pick from entry until it is left. An unavailable pick is never held: the next ask tries again. */
export function holdDemo(p: DemoPick) {
  pick = p
  held = p.source === 'real'
}
export function releaseDemo() {
  held = false
}
