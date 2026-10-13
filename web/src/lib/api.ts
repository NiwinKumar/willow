/** Thin client for willow-api (docs/CONTRACT.md section 3). Every call sends the Firebase ID token. */

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

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return (await res.json()) as T
}

export const api = {
  healthz: () => fetch(`${API_URL}/healthz`).then((r) => r.json() as Promise<Record<string, string>>),
  createSession: (token: string, body: { site: Site; capture_mode: CaptureMode; n_frames: number; content_types: string[] }) =>
    request<CreateSessionResponse>(token, '/v1/sessions', { method: 'POST', body: JSON.stringify(body) }),
  sessionObjects: (token: string, sessionId: string) =>
    request<{ session_id: string; objects: ObjectStatus[] }>(token, `/v1/sessions/${sessionId}/objects`),
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
