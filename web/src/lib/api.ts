/** Thin client for willow-api (docs/CONTRACT.md section 3, api/README.md). Every call sends the Firebase ID token. */

import type { AnalysisResult, Explanation, FeelTag, FeelVerdict, Product, ProductTest, RoutineCheck, RoutineEntry, RoutineLogDay, RoutineSchedule, ViewName } from '../data/types'
import { DEV_UID } from './devAuth'
import type { LabelDetail } from './spotLabels'

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080'

export type Site = 'face_full' | 'cheek_macro' | 'left_cheek_macro' | 'right_cheek_macro' | 'forehead_macro' | 'chin_macro' | 'nose_macro' | 'forearm_treated' | 'forearm_control'
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
  /** A byte-identical frame of the person's earliest other session (or an earlier frame of this one). */
  duplicate_of?: { session_id: string; index: number } | null
}
/** POST /v1/sessions/{id}/frames: targets for the new frames only; `dropped`: left-out frames removed (1-based). */
export type AddFramesResponse = { session_id: string; n_frames: number; upload_urls: UploadTarget[]; expires_in_seconds: number; dropped: number[] }
/** Live analysis stage while a session is processing (api analysis.run). */
export type AnalysisStage = 'received' | 'engine' | 'explaining'

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
    /** Blemish and dark-spot counts compared with this check-in (taken the same way, with or without cheek photos) instead of the baseline. */
    counts_compared_with?: { session_id: string; session_created_at: string | null; frames: number | null } | null
    /** Check-ins with cheek photos: each photo (front, left, right) signed, with its redness map. */
    views?: { view: ViewName; frame_index: number; preview: { url: string; width: number | null; height: number | null }; redness_url: string | null }[]
    hours_since_baseline: number | null
    /** Judge mode: the hosted sample these photos were copied from. */
    sample_id?: string | null
    label_details?: Record<string, LabelDetail>
    /** Live analysis stage while processing, else null. */
    stage?: AnalysisStage | null
    /** Detail views only: signed GET per uploaded frame (null for DNG or a missing photo). */
    frame_urls?: (string | null)[]
    /** Detail views only: signed tight crop per candidate id (crops that exist). */
    crop_urls?: Record<string, string>
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
/** GET /v1/sessions/{id}/story/{metric_id}: what changed, in points. `source` "gemini": Gemini wrote them from the
 * metric's whole history (every number checked against the measurements); "facts": the same facts written by code
 * (Gemini down, or a point failed the checks). `reasons`: up to two AI-suggested possible reasons. */
export type MetricStory = {
  metric_id: string
  points: string[]
  reasons: string[]
  source: 'gemini' | 'facts'
  products: { name: string; brand: string; use: { days_used: number; of_days: number } | null }[]
  has_previous: boolean
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

/** One ingredient as read off the label: `low` when part of it was hard to read. Plain strings: older api answers. */
export type ScannedIngredient = string | { name: string; confidence: 'high' | 'low' }
export type LabelScanFailure = 'glare' | 'blurry' | 'no_label' | 'cut_off'
export type LabelScan = {
  brand: string | null
  product_name: string | null
  category: string
  inci: ScannedIngredient[]
  key_actives: { name: string; pct: number | null }[]
  claims_on_pack: string[]
  confidence: 'low' | 'medium' | 'high'
  /** Why the label could not be read fully (null or missing: it could). */
  failure?: LabelScanFailure | null
}
export type LabelScanResponse = { scan: LabelScan; match: { product_id: string; brand: string; name: string; score: number } | null }

/** One block of a structured advisor answer (api advisor_blocks.py). Text uses the tiny inline markup
 * (**bold**, ==highlight==, [product:ID], [metric:ID]); a widget names data the app draws itself. */
export type AnswerBlock =
  | { type: 'answer' | 'note'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'widget'; widget: { kind: 'metric_trend' | 'session_summary' | 'routine' | 'product' | 'spot_diary' | 'product_test'; params: Record<string, string | undefined> } }
  | { type: 'products'; product_ids: string[] }

export type AdvisorReply = {
  /** Plain text of the answer (older api builds send only this). */
  message: string
  /** The structured answer, answer first; absent from older api builds. */
  blocks?: AnswerBlock[]
  product_ids: string[]
  products: Product[]
  follow_up_suggestions: string[]
  retrieval: string[]
  checks?: { model: string; tool_calls: number; numbers_checked: number; products_from_tools: number; photos_read?: number }
  /** A photo of skin or a face was attached: never answered (chat photos are for products only). */
  photos_refused?: boolean
  remaining_today: number
}

/** One paid action's count today (GET /v1/me/usage); caps reset at UTC midnight (`resets_at`). */
export type UsageCount = { used: number; cap: number; remaining: number; resets_at: string }
export type Usage = { advisor: UsageCount; routine_check: UsageCount; label_scan: UsageCount; retailer_ask?: UsageCount }

/** A product or label photo sent with an advisor question (JPEG after downscaling). */
export type ChatImage = { mime_type: 'image/jpeg' | 'image/png' | 'image/webp'; data_base64: string }

/** A stored advisor turn (GET /v1/advisor/history), oldest first. Photos are never stored, only their count. */
export type AdvisorHistoryMessage =
  | { id: string; role: 'user'; text: string; created_at: string; photos: number }
  | { id: string; role: 'willow'; text: string; created_at: string; reply: Omit<AdvisorReply, 'remaining_today'> }

/** The latest measured session's pre-written explanation, sent with a 502 advisor_unavailable. */
export type StandardExplanation = { session_id: string; site: Site; capture_mode: CaptureMode | null; created_at: string; explanation: Explanation }

/** Progress events of POST /v1/advisor/chat/stream, in the order the api works. */
export type AdvisorStage =
  | { event: 'reading_context' }
  | { event: 'asking_gemini'; step: 'tools'; photos: number }
  | { event: 'asking_gemini'; step: 'tool'; tool: 'search_catalog' | 'compare_products' | 'check_routine' | string }
  | { event: 'asking_gemini'; step: 'reply'; retrieval: string[] }
  | { event: 'checking_numbers' }

type RetailerCell = { value: number | null; n: number; suppressed: boolean }
/** n: users of that tier's products at week 8 (null under 10). */
type TierStat = { options: number; rate: number | null; n?: number | null }
/** Retailer filters (GET /v1/retailer/insights?cohort=&range=); defaults mixed + all. */
export type RetailerCohort = 'simulated' | 'mixed' | 'real'
export type RetailerRange = '30d' | '90d' | 'all'
/** A group's k of n (n ≥ 10; null when the group is under 10). */
type RetailerBase = { k: number; n: number; rate: number } | null
export type RetailerFlow = { goal: string; goal_id: string; n: number; weeks: number[]; changed: number[]; using: number[]; rate: number; median_weeks: number | null; base: RetailerBase }
export type RetailerBrand = { brand: string; n: number; rate: number; lo: number; hi: number; cont: number }
export type RetailerInsights = {
  cohort: { synthetic: number; real: number; weeks: number; dropout: number; seed: number }
  /** Fewer than 10 people in the filter: only the head count is sent. */
  empty?: boolean
  filters?: { cohort: RetailerCohort; range: RetailerRange; since: string | null; today: string }
  tiles: { label: string; value: string; n: number; sub: string }[]
  // goal_id: one of the app's 8 goals; weeks: median weeks to a real change (null when under 10 changed)
  needs: { goal: string; goal_id?: string; app_goal?: string | null; n: number; real: number; none: number; early: number; weeks?: number | null; weeks_n?: number | null }[]
  /** Goal demand per month ('YYYY-MM'): people with a reading that month; counts under 10 are null. */
  needs_by_month?: { months: string[]; people: (number | null)[]; goals: { goal: string; goal_id: string; counts: (number | null)[]; share_of_peak: (number | null)[] }[] }
  kpis?: {
    catalog: { products: number; with_outcomes: number; below_min: number; unused: number; not_measured: number } | null
    continuation_wk8: RetailerBase
  }
  products: { product_id: string; product: string; brand: string; concern: string; category?: string; goal_ids?: string[]; n: number; cells: RetailerCell[]; cells_skin?: RetailerCell[]; rate: number; lift: number | null; base?: RetailerBase; weeks: number | null; cont: number; cont8?: number }[]
  tone_bands: string[]
  skin_types?: string[]
  brands: RetailerBrand[]
  brands_hidden?: number
  categories?: { category: string; label: string; flows: RetailerFlow[]; brands: RetailerBrand[]; brands_hidden: number }[]
  gaps: { goal: string; goal_id?: string; app_goal?: string | null; budget: TierStat; mid: TierStat; premium: TierStat; action: string }[]
  conflicts: { kind?: string; pair: string; n?: number; share: number; fix: string; resolves: string[] }[]
  routines_checked?: number
  /** Every product with at least 10 people: outcome rate, people, median weeks to first real change. */
  product_outcomes?: Record<string, { n: number; rate: number; weeks: number | null; product: string; brand: string; concern: string; cont: number; category?: string; cont8?: number; lift?: number | null }>
}

export type NewRoutineEntry = Partial<Omit<RoutineEntry, 'id' | 'ended_at'>> & { source: RoutineEntry['source'] }

/** users/{uid}.profile (api me_routes.py): goals are lib/metrics GoalId values; days 0 = Monday. */
export type PhotoTime = 'morning' | 'midday' | 'evening'
export type SkinType = 'oily' | 'combination' | 'dry' | 'normal' | 'sensitive'
export type CheckinSchedule = { days: number[]; time: string; tz: string }
export type Profile = {
  goals: string[]
  photo_time: PhotoTime | null
  display_name: string | null
  skin_type: SkinType | null
  checkin: CheckinSchedule | null
  updated_at: string | null
  /** Routine's "Sponsored · Willow Proven" card off (default false; absent from older apis). */
  hide_sponsored?: boolean
}
export type ProfilePatch = Partial<Omit<Profile, 'updated_at'>>

export class ApiError extends Error {
  status: number
  code: string | null
  /** The api's whole `detail` object, for errors that carry more than code and message. */
  detail: Record<string, unknown> | null
  constructor(status: number, message: string, code: string | null = null, detail: Record<string, unknown> | null = null) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
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
    let full: Record<string, unknown> | null = null
    try {
      const detail = (JSON.parse(text) as { detail?: { code?: string; message?: string } }).detail
      if (detail && typeof detail === 'object') {
        code = detail.code ?? null
        message = detail.message ?? text
        full = detail as Record<string, unknown>
      }
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message, code, full)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

/** Gemini's answer over the retailer aggregates (api retailer_ask.py); every number checked. */
export type RetailerAnswer = {
  answer: string
  /** No numbers given: individual-level or unavailable data, or no draft passed the checks. */
  refused?: boolean
  /** n: the group a percent bar's rate is of (null for counts, weeks, or labels without one). */
  chart: { title: string; unit: 'percent' | 'count' | 'weeks'; bars: { label: string; value: number; n?: number | null }[] } | null
  /** The aggregate tables the answer drew on (product_outcomes, needs, brands, …). */
  source?: string[]
  follow_ups: string[]
  checks: { model: string; numbers_checked: number; rejected_attempts: number } | null
}

/** Hosted sample photos for judge mode (api/app/demo.py). */
export type DemoSample = { id: string; title: string; note: string; site: Site; capture_mode: CaptureMode; credit: string; n_frames: number }

/** waking: the engine sleeps when idle; it was still starting when checked (about 35 s). */
type ServiceState = { status: 'ok' | 'waking' | 'unreachable' | 'unavailable' | 'degraded'; error?: string }
/** A live check (cached 60 s by the api): degraded = answered slowly, busy, or only partly. Optional: older api builds sent configuration only. */
export type LiveCheck = { status?: 'ok' | 'degraded' | 'unreachable'; latency_ms?: number | null; reason?: 'slow' | 'busy' }
export type DemoStatus = {
  api: ServiceState & { version: string; runtime: string }
  engine: ServiceState & { version?: string; mode: string; latency_ms?: number }
  gemini: LiveCheck & { model: string; endpoint: string }
  bigquery: ServiceState & { dataset?: string; people?: number; synthetic?: number; latency_ms?: number | null; reason?: 'slow' | 'busy' }
  catalog: { products: number }
  storage: LiveCheck & { bucket: string }
  checked_at: string
}

/** Retailer reads give up after this, so a stalled request shows the error state (with Retry) instead of a skeleton forever. A cold api plus BigQuery answers well inside it. */
const RETAILER_TIMEOUT_MS = 30_000

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
  retailerInsights: async (filters?: { cohort: RetailerCohort; range: RetailerRange }) => {
    const qs = filters ? `?${new URLSearchParams(filters).toString()}` : ''
    const res = await fetch(`${API_URL}/v1/retailer/insights${qs}`, { signal: AbortSignal.timeout(RETAILER_TIMEOUT_MS) })
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
  /** What changed for one metric since the previous check-in, in points (api app/metric_story.py). */
  metricStory: (token: string, sessionId: string, metricId: string) => request<MetricStory>(token, `/v1/sessions/${sessionId}/story/${metricId}`),
  patchSession: (token: string, sessionId: string, body: { note?: string | null; deviation?: boolean }) =>
    request<SessionView>(token, `/v1/sessions/${sessionId}`, { method: 'PATCH', ...json(body) }),
  /** `force`: measure a done session again with every frame (counts as an analysis). */
  analyze: (token: string, sessionId: string, force = false) =>
    request<SessionView>(token, `/v1/sessions/${sessionId}/analyze${force ? '?force=1' : ''}`, { method: 'POST' }),
  /** More photos for a session (an edit before analyze, or a baseline top-up). */
  addFrames: (token: string, sessionId: string, body: { add: number; content_types: string[] }) =>
    request<AddFramesResponse>(token, `/v1/sessions/${sessionId}/frames`, { method: 'POST', ...json(body) }),
  /** Remove photo `index` (1-based) before analyze; answers fresh upload links for every frame. */
  deleteFrame: (token: string, sessionId: string, index: number) =>
    request<CreateSessionResponse>(token, `/v1/sessions/${sessionId}/frames/${index}`, { method: 'DELETE' }),
  setBaseline: (token: string, site: Site, sessionId: string) =>
    request<{ site: Site; session_id: string }>(token, `/v1/baselines/${site}`, { method: 'POST', ...json({ session_id: sessionId }) }),
  deleteMe: (token: string) => request<void>(token, '/v1/me', { method: 'DELETE' }),
  /** The account as the api knows it: uid, the consent and the profile on record (each null before any). */
  me: (token: string) => request<{ uid: string; consent: { version: string; accepted_at: string; aggregate_insights_opt_in: boolean } | null; profile: Profile | null }>(token, '/v1/me'),
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
  patchRoutine: (token: string, id: string, body: { ended_at?: string | null; slots?: ('am' | 'pm')[]; schedule?: RoutineSchedule | null }) =>
    request<RoutineEntry>(token, `/v1/routine/${id}`, { method: 'PATCH', ...json(body) }),
  deleteRoutine: (token: string, id: string) => request<void>(token, `/v1/routine/${id}`, { method: 'DELETE' }),
  /** How the product feels to the person (self-reported): a verdict and up to 4 look-and-feel tags. Answers the entry. */
  putFeel: (token: string, id: string, body: { verdict: FeelVerdict; tags: FeelTag[] }) => request<RoutineEntry>(token, `/v1/routine/${id}/feel`, { method: 'PUT', ...json(body) }),
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
  /** Partial: only the fields sent change; null clears one. */
  putProfile: (token: string, patch: ProfilePatch) => request<{ profile: Profile }>(token, '/v1/me/profile', { method: 'PUT', ...json(patch) }),
  routineCheck: (token: string) => request<RoutineCheck>(token, '/v1/routine/check', { method: 'POST' }),
  retailerAsk: (token: string, question: string, filters?: { cohort: RetailerCohort; range: RetailerRange }) =>
    request<RetailerAnswer>(token, '/v1/retailer/ask', { method: 'POST', ...json({ question, ...filters }) }),
  /** Claim drafts for one channel (api proof_ai.claims): sign-in, 30 a day; 429 `daily_limit`. */
  retailerClaims: (token: string, productId: string, body: { channel: RetailerClaimChannel } & RetailerFilters) =>
    request<RetailerClaims>(token, `/v1/retailer/products/${encodeURIComponent(productId)}/claims`, { method: 'POST', ...json(body) }),
  spots: (token: string) => request<SpotDiary>(token, '/v1/spots'),
  demoSamples: () => publicGet<{ samples: DemoSample[] }>('/v1/demo/samples'),
  demoJourney: () => publicGet<{ sessions: SessionView[] }>('/v1/demo/journey'),
  demoStatus: () => publicGet<DemoStatus>('/v1/demo/status'),
  startSample: (token: string, sampleId: string) =>
    request<{ session_id: string; site: Site; n_frames: number }>(token, `/v1/demo/samples/${sampleId}/session`, { method: 'POST' }),
  judgeSetup: (token: string) => request<{ routine_added: number }>(token, '/v1/demo/judge-setup', { method: 'POST' }),
  advisorChat: (token: string, messages: { role: 'user' | 'willow'; text: string }[], images: ChatImage[] = []) =>
    request<AdvisorReply>(token, '/v1/advisor/chat', { method: 'POST', ...json(images.length ? { messages, images } : { messages }) }),
  /** Product tests (forearm): the running one first. */
  productTests: (token: string) => request<{ tests: ProductTest[] }>(token, '/v1/product-tests'),
  startProductTest: (token: string, body: { entry_id?: string; product_id?: string; name?: string; length_days?: number; started_at?: string }) =>
    request<ProductTest>(token, '/v1/product-tests', { method: 'POST', ...json(body) }),
  patchProductTest: (token: string, id: string, body: { name?: string; length_days?: number; ended_at?: string | null }) =>
    request<ProductTest>(token, `/v1/product-tests/${id}`, { method: 'PATCH', ...json(body) }),
  deleteProductTest: (token: string, id: string) => request<void>(token, `/v1/product-tests/${id}`, { method: 'DELETE' }),
  /** Check-in reminders (api routes/reminders_routes.py): the schedule as a calendar file, and Web Push. */
  reminderIcs: async (token: string): Promise<Blob> => {
    const res = await fetch(`${API_URL}/v1/me/reminder.ics`, { headers: { Authorization: `Bearer ${token}`, ...(DEV_UID ? { 'X-Dev-Uid': DEV_UID } : {}) } })
    if (!res.ok) throw new ApiError(res.status, 'calendar file unavailable')
    return res.blob()
  },
  /** enabled false: the api has no VAPID keys, so reminders are by calendar only. */
  pushKey: (token: string) => request<{ enabled: boolean; public_key: string | null }>(token, '/v1/me/push/key'),
  pushSubscribe: (token: string, subscription: PushSubscriptionJSON) => request<{ id: string; enabled: boolean }>(token, '/v1/me/push', { method: 'POST', ...json(subscription) }),
  pushUnsubscribe: (token: string, endpoint: string) => request<void>(token, '/v1/me/push', { method: 'DELETE', ...json({ endpoint }) }),
  pushTest: (token: string) => request<{ sent: number; removed: number; failed: number }>(token, '/v1/me/push/test', { method: 'POST' }),
  /** Today's counts for the paid actions (read without counting). */
  usage: (token: string) => request<Usage>(token, '/v1/me/usage'),
  advisorHistory: (token: string) => request<{ messages: AdvisorHistoryMessage[]; keep: number }>(token, '/v1/advisor/history'),
  clearAdvisorHistory: (token: string) => request<void>(token, '/v1/advisor/history', { method: 'DELETE' }),
  advisorChatStream,
  /** Proof-gated promotion (api campaign_routes.py): the consumer's sponsored card and its events. */
  sponsored: (token: string, placement: SponsoredPlacement = 'routine') => request<{ item: SponsoredItem | null }>(token, `/v1/sponsored?placement=${placement}`),
  sponsoredEvent: (token: string, campaignId: string, kind: SponsoredEventKind) => request<void>(token, `/v1/sponsored/${encodeURIComponent(campaignId)}/events`, { method: 'POST', ...json({ kind }) }),
  /** Retailer campaigns (Willow Proof "Promote"): sign-in, guest ok. */
  eligibility: (token: string) => request<{ products: PromoEligibility[] }>(token, '/v1/retailer/eligibility'),
  createCampaign: (token: string, body: NewCampaign) => request<Campaign>(token, '/v1/retailer/campaigns', { method: 'POST', ...json(body) }),
  listCampaigns: (token: string) => request<{ campaigns: Campaign[] }>(token, '/v1/retailer/campaigns'),
  updateCampaign: (token: string, id: string, body: { status: 'active' | 'paused' | 'ended' }) => request<Campaign>(token, `/v1/retailer/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', ...json(body) }),
  deleteCampaign: (token: string, id: string) => request<void>(token, `/v1/retailer/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

/** Proof-gated promotion types (docs/CONTRACT.md section 3, docs/RETAILER_INSIGHTS.md). */
export type SponsoredPlacement = 'routine'
export type SponsoredEventKind = 'impression' | 'click' | 'add'
export type SponsoredItem = {
  campaign_id: string
  product_id: string
  product: string
  brand: string
  image_url: string | null
  category: string
  /** Deterministic, claim-ready line with its n (from the eligibility evidence). */
  evidence: string
  cohort_label: string
  label: 'Sponsored'
  /** What matched the person's own profile ("Why am I seeing this?"). */
  matched: { goals: string[]; skin_type: SkinType | null }
  disclosure: string
}
/** One product's promotion eligibility (cohort mixed, all time: the evidence shoppers see). */
export type PromoEligibility = {
  product_id: string
  product: string
  brand: string
  tier: 'proven' | 'promising' | 'unclear' | 'too_few'
  eligible: boolean
  reasons: string[]
  goals: string[]
  skin_types: string[]
  evidence: string
}
export type NewCampaign = {
  product_id: string
  /** 'retailer' or a catalog brand (a brand may only promote its own products). */
  workspace: string
  goals: string[]
  /** Within the product's eligible skin types; [] = all eligible skin types. */
  skin_types: SkinType[]
  days: 7 | 14 | 30
  placement?: SponsoredPlacement
  /** Randomised holdout share, 0.1-0.5 (default 0.2). */
  holdout_pct?: number
}
/** Delivery counts as counted (once per person per day per kind; never split by goal or skin type). */
export type CampaignDay = { day: string; impressions: number; clicks: number; adds: number }
export type IncrementalityGroup = { n: number; added: number; rate: number }
export type CampaignStats = {
  /** Unique people shown the card at least once (each person once, ever). Missing from older api builds. */
  reach?: number
  impressions: number
  clicks: number
  adds: number
  /** clicks / impressions (null at 0 impressions). */
  ctr: number | null
  daily: CampaignDay[]
  /** Adoption exposed vs randomised holdout; null until both groups have 10 people. */
  incrementality: { exposed: IncrementalityGroup; holdout: IncrementalityGroup; lift: number; lift_lo: number; lift_hi: number } | null
  incrementality_note: string
}
export type Campaign = {
  id: string
  workspace: string
  product_id: string
  goals: string[]
  skin_types: SkinType[]
  placement: SponsoredPlacement
  /** Randomised holdout share of the people the campaign matches. */
  holdout_pct?: number
  status: 'active' | 'paused' | 'ended'
  days: 7 | 14 | 30
  starts_at: string
  ends_at: string
  created_at: string
  product: string | null
  brand: string | null
  category: string | null
  image_url: string | null
  stats: CampaignStats
}

/** The stream could not be used at all (old api, a proxy, no readable body): nothing was sent or counted. */
export class StreamUnavailable extends Error {}

/**
 * POST /v1/advisor/chat/stream: progress events as the api really works, then the checked reply (never partial
 * text). Errors before any work (422, 429) are plain HTTP errors (ApiError); a failure during the turn arrives as
 * an `error` event and is thrown as ApiError with its detail. StreamUnavailable means "use the plain endpoint".
 */
async function advisorChatStream(token: string, messages: { role: 'user' | 'willow'; text: string }[], images: ChatImage[], onStage: (s: AdvisorStage) => void, signal?: AbortSignal): Promise<AdvisorReply> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/v1/advisor/chat/stream`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(DEV_UID ? { 'X-Dev-Uid': DEV_UID } : {}) },
      body: JSON.stringify(images.length ? { messages, images } : { messages }),
    })
  } catch (e) {
    if (signal?.aborted) throw e
    // Never reached the api (offline, CORS on an old build): nothing counted, the plain endpoint may still work.
    throw new StreamUnavailable(String(e))
  }
  if (res.status === 404 || res.status === 405) throw new StreamUnavailable(`stream route ${res.status}`)
  if (!res.ok) {
    const text = await res.text()
    let detail: Record<string, unknown> | null = null
    try {
      const d = (JSON.parse(text) as { detail?: unknown }).detail
      if (d && typeof d === 'object') detail = d as Record<string, unknown>
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, typeof detail?.message === 'string' ? detail.message : text, typeof detail?.code === 'string' ? detail.code : null, detail)
  }
  if (!res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) throw new StreamUnavailable('no event stream')
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      let event = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7)
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      if (!data) continue // a keep-alive comment
      const payload = JSON.parse(data) as Record<string, unknown>
      if (event === 'done') {
        void reader.cancel()
        return payload.reply as AdvisorReply
      }
      if (event === 'error') {
        void reader.cancel()
        throw new ApiError(Number(payload.status) || 500, String(payload.message ?? 'The advisor is unavailable right now.'), typeof payload.code === 'string' ? payload.code : null, payload)
      }
      onStage({ event, ...payload } as AdvisorStage)
    }
  }
  // The connection closed mid-answer: the question reached the api, so it may have counted.
  throw new Error('The connection closed before the answer arrived.')
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

/* ───────────── Willow Proof (retail) intelligence: GET /v1/retailer/{products,segments,brands,brief} ───────────── */
// Public aggregates like /v1/retailer/insights: no sign-in, every group under 10 people suppressed by the api.
// Shapes: docs/CONTRACT.md section 3 (retail intelligence rows). Rates are fractions (0.48), lifts too.

export type RetailerFilters = { cohort: RetailerCohort; range: RetailerRange }
export type RetailerProofTier = 'proven' | 'promising' | 'unclear' | 'too_few'
/** One product's scoreboard row; numbers are null when the tier is too_few (or the product is unused). */
export type RetailerProductRow = {
  product_id: string
  product: string
  brand: string
  category: string
  category_label: string
  goal_ids: string[]
  price_tier: 'budget' | 'mid' | 'premium'
  image_url: string | null
  users: number | null
  n: number | null
  rate: number | null
  rate_lo: number | null
  rate_hi: number | null
  base_rate: number | null
  lift: number | null
  lift_lo: number | null
  lift_hi: number | null
  weeks: number | null
  cont8: number | null
  routine_share: number | null
  tier: RetailerProofTier
  /** Why a product has no numbers: nobody used it, its targets aren't measured, or fewer than 10 people. */
  reason?: 'unused' | 'not_measured' | 'few'
  /** The tier in words ("No clear effect yet"). */
  tier_label?: string
  /** Promising only: about how many more people at week 8 would make it Proven if the rates hold. */
  to_proven?: number | null
  /** Self-reported (never part of the tier): share of `felt_n` who said "It's working for me", 2 dp; null under 10. */
  felt?: number | null
  /** People who said how it feels at week 2 or later (latest answer each); null under 10. */
  felt_n?: number | null
}
type RetailerHead = { filters: { cohort: RetailerCohort; range: RetailerRange; since: string | null; today: string }; cohort: RetailerInsights['cohort'] }
export type RetailerProducts = RetailerHead & {
  products: RetailerProductRow[]
  counts: { products: number; measured: number; too_few: number; unused: number; not_measured: number }
}
export type RetailerSeg = { id: string; label: string; n: number | null; rate: number | null; base_rate: number | null; suppressed: boolean }
type RetailerProductRef = { product_id: string; product: string; brand: string }
export type RetailerProductDetail = RetailerHead & {
  product: RetailerProductRow & { key_actives: { name: string; pct: number | null }[]; size: string | null; price: { amount: number; currency: string } | null; image_source: string | null; stores: number }
  curve: { weeks: number[]; users: (number | null)[]; base: (number | null)[] }
  segments: { skin: RetailerSeg[]; tone: RetailerSeg[]; goal: RetailerSeg[] }
  competitors: { rows: (RetailerProductRow & { is_self: boolean })[]; rank: number | null; of: number; note?: string }
  co_used: (RetailerProductRef & { category: string; image_url: string | null; n: number; share: number })[]
  switching: { stopped: number | null; to: (RetailerProductRef & { n: number })[]; from: (RetailerProductRef & { n: number })[]; to_brands?: RetailerBrandFlow[]; from_brands?: RetailerBrandFlow[] }
  conflicts: { kind: string; label: string; fix: string; n: number; share: number }[]
  evidence: RetailerEvidence[]
  evidence_caveat?: string
  eligibility: { eligible: boolean; tier: RetailerProofTier; reasons: string[]; goals: string[]; skin_types: string[] }
  /** How it feels to the people using it (self-reported, shown next to the measurements); null under 10 people. */
  feel?: RetailerFeel | null
}
export type RetailerFeelVerdict = 'working' | 'unsure' | 'not_for_me'
export type RetailerFeelTag = { tag: string; label: string; good: boolean; n: number; share: number }
/**
 * Self-reported answers on a product, each person's latest at week 2 or later. Shares are of `n`, 2 dp; tags
 * with 10+ people only, most first. `agree`: people at week 8 with an answer on a measured product, felt
 * ("It's working for me") against measured (a visible change in what it targets); null under 10 or unmeasured.
 */
export type RetailerFeel = {
  n: number
  working: number
  unsure: number
  not_for_me: number
  tags: RetailerFeelTag[]
  agree: { n: number; both: number; felt_only: number; measured_only: number; neither: number } | null
  note: string
}
/** A switching flow by brand (people, >= 10); the product's own brand reads "Same brand, other product". */
export type RetailerBrandFlow = { brand: string; label: string; same_brand: boolean; n: number }
/** One claim-ready statement: cosmetic, observational, numbers only from the row, with its method and cohort. */
export type RetailerEvidence = { id: string; text: string; n: number; kind: 'efficacy' | 'speed' | 'segment' | 'retention'; method?: string; window?: string; cohort_label?: string; caveat?: string }
type RetailerPick = RetailerProductRef & { rate: number; n: number }
export type RetailerSegments = RetailerHead & {
  skin_types: { id: string; label: string; users: number | null }[]
  goals: { id: string; label: string }[]
  cells: { skin: string; goal: string; users: number | null; unmet: number | null; best: RetailerPick | null; runner_up: RetailerPick | null }[]
  by_skin: {
    skin: string
    label: string
    users: number | null
    top_goals: { goal_id: string; label: string; share: number }[]
    top_products: (RetailerProductRef & { image_url: string | null; rate: number; n: number; lift: number | null })[]
    conflict_share: number | null
  }[]
}
export type RetailerBrandSummary = { brand: string; products: number; users: number | null; n: number | null; rate: number | null; lo: number | null; hi: number | null; cont8: number | null; routine_share: number | null }
export type RetailerBrandDetail = RetailerHead & {
  brand: string
  products: RetailerProductRow[]
  goals: { goal_id: string; label: string; brand: { rate: number; n: number; lo: number; hi: number } | null; market: { rate: number; n: number } | null; best_competitor: { brand: string; rate: number; n: number } | null; rank: number | null; of: number }[]
  share: { category: string; label: string; brand_share: number | null; users: number | null }[]
  switching: { won: { brand: string; n: number }[]; lost: { brand: string; n: number }[]; net: number | null }
  positioning: { brand: string; rate: number; cont8: number; users: number; is_self: boolean }[]
  skin: { skin: string; label: string; brand_rate: number | null; market_rate: number | null; n: number | null }[]
  /** "Observational comparison under the same method; …" (shown next to every comparison). */
  note?: string
}
export type RetailerBriefSection = 'products' | 'categories' | 'segments' | 'competitors' | 'demand' | 'promote'
export type RetailerBriefCard = {
  id: string
  kind: 'win' | 'risk' | 'opportunity' | 'trend' | 'gap'
  title: string
  body: string
  value: number | string | null
  unit: string | null
  n: number | null
  link: { section: RetailerBriefSection; id?: string }
}
/** `summary_pending`: Gemini is still writing the summary; ask again in a few seconds (the cards never wait). */
export type RetailerBrief = RetailerHead & { cards: RetailerBriefCard[]; summary: { text: string; validated: true } | null; summary_pending?: boolean }

function retailerQs(filters?: Partial<RetailerFilters> & { brand?: string }): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filters ?? {})) if (v) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** GETs that keep the api's status on failure (404 = unknown id, or an endpoint this api build doesn't have yet). */
async function retailerGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(RETAILER_TIMEOUT_MS) })
  if (!res.ok) throw new ApiError(res.status, `${path.split('?')[0]} unavailable`)
  return (await res.json()) as T
}

export const retailerProducts = (filters?: RetailerFilters) => retailerGet<RetailerProducts>(`/v1/retailer/products${retailerQs(filters)}`)
export const retailerProduct = (productId: string, filters?: RetailerFilters) =>
  retailerGet<RetailerProductDetail>(`/v1/retailer/products/${encodeURIComponent(productId)}${retailerQs(filters)}`)
export const retailerSegments = (filters?: RetailerFilters) => retailerGet<RetailerSegments>(`/v1/retailer/segments${retailerQs(filters)}`)
export const retailerBrands = (filters?: RetailerFilters) => retailerGet<{ brands: RetailerBrandSummary[]; note?: string }>(`/v1/retailer/brands${retailerQs(filters)}`)
export const retailerBrand = (brand: string, filters?: RetailerFilters) =>
  retailerGet<RetailerBrandDetail>(`/v1/retailer/brands/${encodeURIComponent(brand)}${retailerQs(filters)}`)
export const retailerBrief = (filters?: RetailerFilters & { brand?: string }) => retailerGet<RetailerBrief>(`/v1/retailer/brief${retailerQs(filters)}`)

/* ───────────── AI in Willow Proof (api proof_ai.py): next steps and claim drafts on the product page ───────────── */

export type RetailerActionId = 'promote_segment' | 'set_expectations' | 'answer_feedback' | 'keep_users' | 'reach_proven' | 'avoid_segment' | 'educate_routine' | 'bundle' | 'draft_claims'
export type RetailerActionSection = 'campaigns' | 'claims' | 'feel' | 'switching' | 'pipeline' | 'segments' | 'conflicts' | 'co_used'
export type RetailerClaimChannel = 'pack' | 'pdp' | 'listing' | 'social'
/** One next step: the title, why (only numbers from the facts, checked) and where in Proof it is done. */
export type RetailerAction = {
  id: RetailerActionId
  title: string
  why: string
  link: { section: RetailerActionSection; id: string; skin_types?: string[]; channel?: RetailerClaimChannel }
}
/** GET /v1/retailer/products/{id}/actions: 0-3 steps; `considered` = how many the data supports. */
export type RetailerActions = { product_id: string; source: 'gemini' | 'rules'; considered: number; actions: RetailerAction[] }
/** What a claim may rest on: the measured evidence statements, then possibly `perception` (self-reported). */
export type RetailerClaimSource = { id: string; kind: string; text: string; n: number; measured: boolean }
/**
 * POST /v1/retailer/products/{id}/claims. `source`: gemini (checked drafts), statements (Gemini unavailable: the
 * evidence statements themselves), none (blocked). `blocked`: why claims aren't available for this product.
 */
export type RetailerClaims = {
  product_id: string
  channel: RetailerClaimChannel
  caveat: string | null
  sources: RetailerClaimSource[]
  drafts: { text: string; sources: string[] }[]
  source: 'gemini' | 'statements' | 'none'
  blocked: string | null
}

export const retailerActions = (productId: string, filters?: RetailerFilters) =>
  retailerGet<RetailerActions>(`/v1/retailer/products/${encodeURIComponent(productId)}/actions${retailerQs(filters)}`)
