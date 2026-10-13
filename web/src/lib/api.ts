/** Thin client for willow-api (docs/CONTRACT.md section 3, api/README.md). Every call sends the Firebase ID token. */

import type { AnalysisResult, Explanation, Product, RoutineCheck, RoutineEntry } from '../data/types'
import { DEV_UID } from './devAuth'

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
  }
  result: AnalysisResult | null
  labels: Record<string, string>
  explanation: Explanation | null
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
  remaining_today: number
}

type RetailerCell = { value: number | null; n: number; suppressed: boolean }
type TierStat = { options: number; rate: number | null }
export type RetailerInsights = {
  cohort: { synthetic: number; real: number; weeks: number; dropout: number; seed: number }
  tiles: { label: string; value: string; n: number; sub: string }[]
  needs: { goal: string; n: number; real: number; none: number; early: number }[]
  products: { product: string; brand: string; concern: string; n: number; cells: RetailerCell[]; rate: number; lift: number | null; weeks: number | null; cont: number }[]
  tone_bands: string[]
  brands: { brand: string; n: number; rate: number; lo: number; hi: number; cont: number }[]
  gaps: { goal: string; budget: TierStat; mid: TierStat; premium: TierStat; action: string }[]
  conflicts: { pair: string; share: number; fix: string; resolves: string[] }[]
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
  catalogSearch: (token: string, params: { q?: string; concern?: string; category?: string; max_price?: number; currency?: string; limit?: number }) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
    return request<{ products: Product[] }>(token, `/v1/catalog/search?${qs}`)
  },
  catalogProduct: (token: string, productId: string) => request<Product>(token, `/v1/catalog/${productId}`),
  labelScan: (token: string, images: { mime_type: string; data_base64: string }[]) =>
    request<LabelScanResponse>(token, '/v1/label-scan', { method: 'POST', ...json({ images }) }),
  routine: (token: string) => request<{ entries: RoutineEntry[] }>(token, '/v1/routine'),
  addRoutine: (token: string, entry: NewRoutineEntry) => request<RoutineEntry>(token, '/v1/routine', { method: 'POST', ...json(entry) }),
  patchRoutine: (token: string, id: string, body: { ended_at?: string | null; slots?: ('am' | 'pm')[] }) =>
    request<RoutineEntry>(token, `/v1/routine/${id}`, { method: 'PATCH', ...json(body) }),
  deleteRoutine: (token: string, id: string) => request<void>(token, `/v1/routine/${id}`, { method: 'DELETE' }),
  putConsent: (token: string, body: { version: string; aggregate_insights_opt_in: boolean }) =>
    request<{ consent: Record<string, unknown> }>(token, '/v1/me/consent', { method: 'PUT', ...json(body) }),
  routineCheck: (token: string) => request<RoutineCheck>(token, '/v1/routine/check', { method: 'POST' }),
  advisorChat: (token: string, messages: { role: 'user' | 'willow'; text: string }[]) =>
    request<AdvisorReply>(token, '/v1/advisor/chat', { method: 'POST', ...json({ messages }) }),
}

/** PUT one file to a V4 signed URL with progress. The File object streams from disk; never read it in JS. */
export function putSigned(target: UploadTarget, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', target.url)
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT failed: HTTP ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(file)
  })
}
