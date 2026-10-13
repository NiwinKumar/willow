/** SessionView (api) -> Session (what the screens read). */
import type { SessionView, Site } from '../lib/api'
import type { Session, SiteSeries } from './types'

export const SITE_ORDER: Site[] = ['face_full', 'cheek_macro', 'nose_macro', 'forearm_treated', 'forearm_control']

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
    hours_since_baseline: h !== null && h <= HOURS_LABEL_LIMIT ? h : undefined,
    explanation_source: v.session.explanation_source,
    error: v.session.error,
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

/** True when the fixture engine produced this result (it says so in its version and warnings). */
export function isSampleEngine(s: Session | null | undefined): boolean {
  return Boolean(s?.result?.engine_version.endsWith('-fixture'))
}
