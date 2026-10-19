/** SessionView (api) -> Session (what the screens read). */
import type { SessionView, Site } from '../lib/api'
import type { Session, SiteSeries } from './types'

export const SITE_ORDER: Site[] = ['face_full', 'cheek_macro', 'left_cheek_macro', 'right_cheek_macro', 'forehead_macro', 'chin_macro', 'nose_macro', 'forearm_treated', 'forearm_control']

/** Short series (the self-tanner run) label ticks in hours; anything longer reads better as dates. */
const HOURS_LABEL_LIMIT = 120

export function toSession(v: SessionView): Session {
  const size = v.result?.image_size
  const h = v.session.hours_since_baseline
  return {
    id: v.session.id,
    site: v.session.site,
    capture_mode: v.session.capture_mode,
    created_at: v.session.created_at,
    status: v.session.status,
    n_frames: v.session.n_frames,
    is_baseline: v.session.is_baseline,
    result: v.result,
    labels: v.labels,
    explanation: v.explanation,
    preview: v.session.preview
      ? { url: v.session.preview.url, width: v.session.preview.width ?? size?.width ?? 3024, height: v.session.preview.height ?? size?.height ?? 4032 }
      : null,
    note: v.session.note ?? undefined,
    deviation: v.session.deviation,
    // Under an hour reads as "+0 h"; those ticks are labelled by time of day instead.
    hours_since_baseline: h !== null && h <= HOURS_LABEL_LIMIT && (h >= 1 || v.session.is_baseline) ? h : undefined,
    explanation_source: v.session.explanation_source,
    label_details: v.session.label_details,
    error: v.session.error,
    live: true,
    measured: v.session.measured,
    baseline_ref: v.session.baseline,
    counts_ref: v.session.counts_compared_with ? { session_id: v.session.counts_compared_with.session_id } : null,
    sample_id: v.session.sample_id ?? null,
    stage: v.session.stage ?? null,
    // only detail views (GET one session, analyze) carry these
    ...(v.session.frame_urls ? { frame_urls: v.session.frame_urls } : {}),
    ...(v.session.crop_urls ? { crop_urls: v.session.crop_urls } : {}),
  }
}

export function groupBySite(views: SessionView[]): Partial<Record<Site, SiteSeries>> {
  const out: Partial<Record<Site, SiteSeries>> = {}
  const sorted = [...views].sort((a, b) => a.session.created_at.localeCompare(b.session.created_at))
  for (const v of sorted) {
    const site = v.session.site
    out[site] ??= { site, sessions: [] }
    out[site].sessions.push(toSession(v))
  }
  return out
}

/** Sites that have at least one analyzed session, in a fixed order. */
export function sitesWithResults(series: Partial<Record<Site, SiteSeries>>): Site[] {
  return SITE_ORDER.filter((s) => series[s]?.sessions.some((x) => x.status === 'done'))
}

/** The baseline a session is compared with: its own baseline_ref (live), else the series' baseline. */
export function baselineFor(session: Session | null, sessions: Session[]): Session | null {
  if (!session) return null
  const id = session.baseline_ref?.session_id
  if (id) return sessions.find((s) => s.id === id) ?? null
  // A live session the api says was compared with nothing (a former baseline, demoted by "Make
  // this my baseline") has no baseline; never borrow today's, which may be newer than it.
  if (session.live && !session.is_baseline && session.baseline_ref === null && session.measured !== false) return null
  return sessions.find((s) => s.is_baseline && s.capture_mode === session.capture_mode) ?? sessions.find((s) => s.is_baseline) ?? null
}

/** Counts the api compares only with a check-in taken the same way (with or without cheek photos). */
export const SAME_WAY_COUNTS: string[] = ['blemishes', 'pigment_spots']

/** What one metric of a session was compared with: for its counts, the check-in taken the same way when the api says so; else the baseline. */
export function referenceFor(metricId: string, session: Session, baseline: Session | null, sessions: Session[]): Session | null {
  const id = SAME_WAY_COUNTS.includes(metricId) ? session.counts_ref?.session_id : undefined
  return (id && sessions.find((s) => s.id === id)) || baseline
}

/** An upload or analysis this old has stopped (the tab closed mid-upload, or the server restarted; the api gives up on a run after 6 min). */
const STALL_MS = 10 * 60_000
export const inFlight = (s: Pick<Session, 'status'>) => s.status === 'uploading' || s.status === 'processing'
/** Still uploading or measuring after STALL_MS: nothing will change by waiting, so screens stop polling it. */
export const stalled = (s: Pick<Session, 'status' | 'created_at'>) => inFlight(s) && Date.now() - Date.parse(s.created_at) > STALL_MS

/**
 * Sessions a screen already reads closely (the check-in's own 2 s reads while it measures): the DataProvider's
 * poll of sessions still in flight skips them, so one session is never polled twice. Returns the release.
 */
const watched = new Map<string, number>()
export function watchSession(id: string): () => void {
  watched.set(id, (watched.get(id) ?? 0) + 1)
  let done = false
  return () => {
    if (done) return
    done = true
    const n = (watched.get(id) ?? 1) - 1
    if (n > 0) watched.set(id, n)
    else watched.delete(id)
  }
}
export const isWatched = (id: string) => watched.has(id)

/** Live sessions the engine could not measure yet (the photos are kept, no numbers exist). */
export function isUnmeasured(s: Session | null | undefined): boolean {
  return s?.measured === false
}

/** The control-arm session taken with a treated session: same capture mode, measured, nearest in time (within 3 h). */
export function matchControl(treated: Session | null, controls: Session[]): Session | null {
  if (!treated) return null
  const t = new Date(treated.created_at).getTime()
  let best: Session | null = null
  let gap = 3 * 3_600_000
  for (const c of controls) {
    if (c.status !== 'done' || c.measured === false || !c.result || c.capture_mode !== treated.capture_mode) continue
    const d = Math.abs(new Date(c.created_at).getTime() - t)
    if (d <= gap) {
      gap = d
      best = c
    }
  }
  return best
}
