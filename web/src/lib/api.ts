/** Thin client for willow-api (docs/CONTRACT.md section 3, api/README.md). Every call sends the Firebase ID token. */

import type { AnalysisResult, Explanation, Product, RoutineCheck, RoutineEntry, RoutineLogDay } from '../data/types'
import { DEV_UID } from './devAuth'
import type { LabelDetail } from './spotLabels'

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080'

export type Site = 'face_full' | 'cheek_macro' | 'nose_macro' | 'forearm_treated' | 'forearm_control'
export type CaptureMode = 'calibrated_raw' | 'uncalibrated'

export type UploadTarget = { index: number; object_uri: string; url: string; headers: Record<string, string> }
export type CreateSessionResponse = { session_id: string; upload_urls: UploadTarget[]; expires_in_seconds: number }
export type ObjectStatus = {
  index: number
  object_uri: string
  exists: boolean
  size: number | null
  md5_base64: string | null
  content_type: string | null
}

/** SessionView as the api returns it: {session, result, labels, explanation}. */
export type SessionView = {
  session: {
    id: string
    site: Site
    capture_mode: CaptureMode
    n_frames: number
    created_at: string
    status: 'uploading' | 'processing' | 'done' | 'failed'
    is_baseline: boolean
    /** null until analysed; false when the engine cannot measure this site yet (photos kept). */
    measured: boolean | null
    /** The baseline this session is compared with (same site and capture mode). */
    baseline: { session_id: string; frames: number | null; has_noise_band: boolean } | null
    note: string | null
    deviation: boolean
    error: { code: string; message: string } | null
    explanation_source: 'template' | 'gemini' | null
    preview: { url: string; width: number | null; height: number | null } | null
    overlay_urls: Record<string, string>
    hours_since_baseline: number | null
    /** Judge mode: the hosted sample these photos were copied from. */
    sample_id?: string | null
    label_details?: Record<string, LabelDetail>
  }
  result: AnalysisResult | null
  labels: Record<string, string>
  explanation: Explanation | null
}

/** Spot diary (GET /v1/spots, api/app/tracks.py): each mark followed across face sessions by its
 * place on the face. Sessions are the columns, oldest first; tracks only lists confirmed marks. */
export type SpotZone =
  | 'forehead'
  | 'nose'
  | 'right_cheek'
  | 'left_cheek'
  | 'around_mouth'
  | 'chin'
  | 'right_jaw'
  | 'left_jaw'
/** How a mark looked: from Gemini's AI-suggested label, else from the engine's kind (red or dark). */
export type SpotStage = 'bump' | 'clogged_pore' | 'mark' | 'red_spot' | 'dark_spot'
export type SpotStatus = 'new' | 'still_there' | 'fading' | 'not_seen_last_time' | 'gone'
export type SpotSighting = {
  session_id: string
  candidate_id: string
  stage: SpotStage
  label: string | null
  kind: 'blemish' | 'spot'
  diameter_mm: number | null
  /** How much it stands out from the skin around it (a* for red marks, L* for dark ones). */
  contrast: number
  /** In that session's photo pixels (the photo_url of its column). */
  bbox: [number, number, number, number] | null
  crop_url: string | null
  context_crop_url: string | null
}
export type SpotTrack = {
  id: string
  zone: SpotZone | null
  /** Place on the canonical face, mm: x < 0 is the subject's right, y up (0,0 about the nose bridge). */
  x_mm: number
  y_mm: number
  status: SpotStatus
  confirmed: boolean
  /** Already there at the first session: when it started is unknown. */
  there_from_start: boolean
  first_seen_session: string
  last_seen_session: string
  first_seen_index: number
  last_seen_index: number
  /** Gone: visible at least / at most this many days. Still there: at least, at_most null. */
  days_visible: { at_least: number; at_most: number | null }
  came_back: boolean
  earlier_track: string | null
  observations: SpotSighting[]
}
export type SpotZoneSummary = {
  zone: SpotZone
  visible_now: number
  appeared: number
  faded: number
  came_back: number
  /** Only once 3+ marks here have faded; null before that. */
  typical_days_visible: { at_least: number; at_most: number; from: number } | null
}
export type SpotDiary = {
  sessions: { id: string; created_at: string; day: number; photo_url: string | null; marks: number }[]
  tracks: SpotTrack[]
  /** Seen once in a one-photo session and not since: not shown (could be grain or a glint). */
  unconfirmed: number
  zones: SpotZoneSummary[]
  sessions_used: number
  days_covered: number
  /** 3+ usable sessions over 2+ days. */
  enough_data: boolean
  /** Passed front-view sessions measured before the face map existed (re-measuring adds them). */
  sessions_not_mapped: number
}

export type LabelScan = {
  brand: string | null
  product_name: string | null
  category: string
  inci: string[]
  key_actives: { name: string; pct: number | null }[]
  claims_on_pack: string[]
  confidence: 'low' | 'medium' | 'high'
}
export type LabelScanResponse = { scan: LabelScan; match: { product_id: string; brand: string; name: string; score: number } | null }

export type AdvisorReply = {
  message: string
  product_ids: string[]
  products: Product[]
  follow_up_suggestions: string[]
  retrieval: string[]
  checks?: { model: string; tool_calls: number; numbers_checked: number; products_from_tools: number }
  remaining_today: number
}

type RetailerCell = { value: number | null; n: number; suppressed: boolean }
type TierStat = { options: number; rate: number | null }
export type RetailerInsights = {
  cohort: { synthetic: number; real: number; weeks: number; dropout: number; seed: number }
  tiles: { label: string; value: string; n: number; sub: string }[]
  // app_goal: the goal a person picks in the app that this finer retailer goal belongs to (null: none)
  needs: { goal: string; app_goal?: string | null; n: number; real: number; none: number; early: number }[]
  products: { product_id: string; product: string; brand: string; concern: string; n: number; cells: RetailerCell[]; rate: number; lift: number | null; weeks: number | null; cont: number }[]
  tone_bands: string[]
  brands: { brand: string; n: number; rate: number; lo: number; hi: number; cont: number }[]
  gaps: { goal: string; app_goal?: string | null; budget: TierStat; mid: TierStat; premium: TierStat; action: string }[]
  conflicts: { pair: string; share: number; fix: string; resolves: string[] }[]
  /** Every product with at least 10 people: outcome rate, people, median weeks to first real change. */
  product_outcomes?: Record<string, { n: number; rate: number; weeks: number | null; product: string; brand: string; concern: string; cont: number }>
}

export type NewRoutineEntry = Partial<Omit<RoutineEntry, 'id' | 'ended_at'>> & { source: RoutineEntry['source'] }

export class ApiError extends Error {
  status: number
  code: string | null
  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(DEV_UID ? { 'X-Dev-Uid': DEV_UID } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    let code: string | null = null
    let message = text
    try {
      const detail = (JSON.parse(text) as { detail?: { code?: string; message?: string } }).detail
      if (detail && typeof detail === 'object') {
        code = detail.code ?? null
        message = detail.message ?? text
      }
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message, code)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

/** Gemini's answer over the retailer aggregates (api retailer_ask.py); every number checked. */
export type RetailerAnswer = {
  answer: string
  chart: { title: string; unit: 'percent' | 'count' | 'weeks'; bars: { label: string; value: number }[] } | null
  follow_ups: string[]
  checks: { model: string; numbers_checked: number; rejected_attempts: number } | null
}

/** Hosted sample photos for judge mode (api/app/demo.py). */
export type DemoSample = { id: string; title: string; note: string; site: Site; capture_mode: CaptureMode; credit: string; n_frames: number }

/** waking: the engine sleeps when idle; it was still starting when checked (about 35 s). */
type ServiceState = { status: 'ok' | 'waking' | 'unreachable' | 'unavailable'; error?: string }
export type DemoStatus = {
  api: ServiceState & { version: string; runtime: string }
  engine: ServiceState & { version?: string; mode: string; latency_ms?: number }
  gemini: { model: string; endpoint: string }
  bigquery: ServiceState & { dataset?: string; people?: number; synthetic?: number }
  catalog: { products: number }
  storage: { bucket: string }
  checked_at: string
}

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) throw new ApiError(res.status, `${path} unavailable`)
  return (await res.json()) as T
}

/** The person's own calendar day (YYYY-MM-DD) in their time zone: routine ticks are per local day. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const api = {
  /** Public aggregates (synthetic cohort, groups under 10 suppressed): no sign-in. */
  retailerInsights: async () => {
    const res = await fetch(`${API_URL}/v1/retailer/insights`)
    if (!res.ok) throw new ApiError(res.status, 'insights unavailable')
    return (await res.json()) as RetailerInsights
  },
  health: () => fetch(`${API_URL}/v1/health`).then((r) => r.json() as Promise<Record<string, string>>),
  createSession: (token: string, body: { site: Site; capture_mode: CaptureMode; n_frames: number; content_types: string[] }) =>
    request<CreateSessionResponse>(token, '/v1/sessions', { method: 'POST', ...json(body) }),
  reissueUploadUrls: (token: string, sessionId: string) => request<CreateSessionResponse>(token, `/v1/sessions/${sessionId}/upload-urls`, { method: 'POST' }),
  sessionObjects: (token: string, sessionId: string) =>
    request<{ session_id: string; objects: ObjectStatus[] }>(token, `/v1/sessions/${sessionId}/objects`),
  listSessions: (token: string, site?: Site) =>
    request<{ sessions: SessionView[] }>(token, `/v1/sessions${site ? `?site=${site}` : ''}`),
  getSession: (token: string, sessionId: string) => request<SessionView>(token, `/v1/sessions/${sessionId}`),
  patchSession: (token: string, sessionId: string, body: { note?: string | null; deviation?: boolean }) =>
    request<SessionView>(token, `/v1/sessions/${sessionId}`, { method: 'PATCH', ...json(body) }),
  analyze: (token: string, sessionId: string) => request<SessionView>(token, `/v1/sessions/${sessionId}/analyze`, { method: 'POST' }),
  setBaseline: (token: string, site: Site, sessionId: string) =>
    request<{ site: Site; session_id: string }>(token, `/v1/baselines/${site}`, { method: 'POST', ...json({ session_id: sessionId }) }),
  deleteMe: (token: string) => request<void>(token, '/v1/me', { method: 'DELETE' }),
  /** The account as the api knows it: uid and the consent on record (null before any). */
  me: (token: string) => request<{ uid: string; consent: { version: string; accepted_at: string; aggregate_insights_opt_in: boolean } | null }>(token, '/v1/me'),
  catalogSearch: (token: string, params: { q?: string; concern?: string; category?: string; max_price?: number; currency?: string; limit?: number }) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
    return request<{ products: Product[] }>(token, `/v1/catalog/search?${qs}`)
  },
  catalogProduct: (token: string, productId: string) => request<Product>(token, `/v1/catalog/${productId}`),
  labelScan: (token: string, images: { mime_type: string; data_base64: string }[]) =>
    request<LabelScanResponse>(token, '/v1/label-scan', { method: 'POST', ...json({ images }) }),
  // `today`: the person's own calendar day, so recent use counts their days, not the server's
  routine: (token: string) => request<{ entries: RoutineEntry[] }>(token, `/v1/routine?today=${localDay()}`),
  addRoutine: (token: string, entry: NewRoutineEntry) => request<RoutineEntry>(token, '/v1/routine', { method: 'POST', ...json(entry) }),
  patchRoutine: (token: string, id: string, body: { ended_at?: string | null; slots?: ('am' | 'pm')[] }) =>
    request<RoutineEntry>(token, `/v1/routine/${id}`, { method: 'PATCH', ...json(body) }),
  deleteRoutine: (token: string, id: string) => request<void>(token, `/v1/routine/${id}`, { method: 'DELETE' }),
  /** Routine use ticks; days are the person's own calendar days (YYYY-MM-DD, see localDay). Default range: last 14 days. */
  routineLog: (token: string, range: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(range).filter((e): e is [string, string] => Boolean(e[1])))
    const query = qs.toString() // (URLSearchParams.size is missing before Safari 17)
    return request<{ from: string; to: string; days: RoutineLogDay[] }>(token, `/v1/routine/log${query ? `?${query}` : ''}`)
  },
  /** Tick (used) or untick a routine product for a day and slot; answers that day's ticks. */
  setRoutineUse: (token: string, day: string, entryId: string, slot: 'am' | 'pm', used: boolean) =>
    request<RoutineLogDay>(token, `/v1/routine/log/${day}/${entryId}/${slot}`, { method: used ? 'PUT' : 'DELETE' }),
  putConsent: (token: string, body: { version: string; aggregate_insights_opt_in: boolean }) =>
    request<{ consent: Record<string, unknown> }>(token, '/v1/me/consent', { method: 'PUT', ...json(body) }),
  routineCheck: (token: string) => request<RoutineCheck>(token, '/v1/routine/check', { method: 'POST' }),
  retailerAsk: (token: string, question: string) => request<RetailerAnswer>(token, '/v1/retailer/ask', { method: 'POST', ...json({ question }) }),
  spots: (token: string) => request<SpotDiary>(token, '/v1/spots'),
  demoSamples: () => publicGet<{ samples: DemoSample[] }>('/v1/demo/samples'),
  demoJourney: () => publicGet<{ sessions: SessionView[] }>('/v1/demo/journey'),
  demoStatus: () => publicGet<DemoStatus>('/v1/demo/status'),
  startSample: (token: string, sampleId: string) =>
    request<{ session_id: string; site: Site; n_frames: number }>(token, `/v1/demo/samples/${sampleId}/session`, { method: 'POST' }),
  judgeSetup: (token: string) => request<{ routine_added: number }>(token, '/v1/demo/judge-setup', { method: 'POST' }),
  advisorChat: (token: string, messages: { role: 'user' | 'willow'; text: string }[]) =>
    request<AdvisorReply>(token, '/v1/advisor/chat', { method: 'POST', ...json({ messages }) }),
}

/** PUT one file to a V4 signed URL with progress. The File object streams from disk; never read it in JS. */
export function putSigned(target: UploadTarget, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Upload cancelled'))
    const xhr = new XMLHttpRequest()
    // Closing the check-in cancels the PUT in flight ("the rest are not sent").
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.open('PUT', target.url)
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v)
    // A stalled connection (or a phone that backgrounded the tab) must end in a Retry, never an
    // upload that spins forever: no progress for 60 s aborts it.
    let watchdog = 0
    const stall = () => {
      window.clearTimeout(watchdog)
      watchdog = window.setTimeout(() => xhr.abort(), 60_000)
    }
    const done = (f: () => void) => () => {
      window.clearTimeout(watchdog)
      f()
    }
    xhr.upload.onprogress = (e) => {
      stall()
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = done(() => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT failed: HTTP ${xhr.status}`))))
    xhr.onerror = done(() => reject(new Error('Network error during upload')))
    xhr.onabort = done(() => reject(new Error('Upload stalled')))
    xhr.ontimeout = done(() => reject(new Error('Upload timed out')))
    stall()
    xhr.send(file)
  })
}
