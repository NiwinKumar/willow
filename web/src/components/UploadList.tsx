import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { api, putSigned, type CaptureMode, type ObjectStatus, type Site } from '../lib/api'
import { formatBytes, type Row } from '../lib/upload'
import { useAuth } from '../lib/useAuth'

type Props = {
  site: Site
  mode: CaptureMode
  rows: Row[]
  onRows: (rows: Row[]) => void
  onDone: (sessionId: string, objects: ObjectStatus[]) => void
  autoStart?: boolean
}

/**
 * Uploads each File with one XHR PUT to its V4 signed URL, two at a time, retrying per file.
 * Keeps the screen awake and re-checks in-flight uploads when the tab comes back.
 */
export function UploadList({ site, mode, rows, onRows, onDone, autoStart = true }: Props) {
  const { getIdToken } = useAuth()
  const [busy, setBusy] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const started = useRef(false)
  const wake = useRef<WakeLockSentinel | null>(null)

  const update = (i: number, patch: Partial<Row>) => onRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  useEffect(() => {
    if (!autoStart || started.current || rows.length === 0) return
    started.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, rows.length])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && wake.current === null && busy) void requestWake()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [busy])

  async function requestWake() {
    try {
      wake.current = await navigator.wakeLock?.request('screen')
      wake.current?.addEventListener('release', () => {
        wake.current = null
      })
    } catch {
      /* unsupported or denied: fine */
    }
  }

  async function run() {
    setBusy(true)
    await requestWake()
    let current = rows
    const set = (i: number, patch: Partial<Row>) => {
      current = current.map((r, j) => (j === i ? { ...r, ...patch } : r))
      onRows(current)
    }
    try {
      const token = await getIdToken()
      const session = await api.createSession(token, { site, capture_mode: mode, n_frames: rows.length, content_types: rows.map((r) => r.contentType) })
      setSessionId(session.session_id)
      const queue = rows.map((_, i) => i)
      const worker = async () => {
        for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
          const idx = i
          let attempt = 0
          while (attempt < 3) {
            set(idx, { state: 'uploading', error: undefined })
            try {
              await putSigned(session.upload_urls[idx], current[idx].file, (f) => set(idx, { progress: f }))
              set(idx, { state: 'done', progress: 1 })
              break
            } catch (e) {
              attempt += 1
              if (attempt >= 3) set(idx, { state: 'failed', error: 'Network dropped. Tap retry.' })
              else await new Promise((r) => setTimeout(r, [1000, 3000, 9000][attempt - 1]))
              void e
            }
          }
        }
      }
      await Promise.all([worker(), worker()])
      if (current.every((r) => r.state === 'done')) {
        const result = await api.sessionObjects(token, session.session_id)
        onDone(session.session_id, result.objects)
      }
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
      wake.current?.release().catch(() => undefined)
    }
  }

  const total = rows.reduce((a, r) => a + r.file.size, 0)
  const done = rows.filter((r) => r.state === 'done').length
  return (
    <div>
      <div className="flex items-center justify-between text-[13px] text-text-2">
        <span>
          {rows.length} {rows.length === 1 ? 'file' : 'files'}, {formatBytes(total)}{total > 60 * 1024 * 1024 ? ' · Wi-Fi recommended' : ''}
        </span>
        <span className="font-mono">{done}/{rows.length}</span>
      </div>
      {busy ? <p className="mt-1 rounded-(--radius-chip) bg-surface-2 px-2 py-1 text-[13px] text-text-2">Keep this tab open. Uploads pause if you switch apps or lock the phone.</p> : null}
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {rows.map((r, i) => (
          <li key={`${r.file.name}-${i}`} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-[15px] font-medium">{r.file.name}</span>
              <span className="shrink-0 rounded-(--radius-chip) bg-surface-2 px-1.5 py-0.5 text-[12px] text-text-2">{r.contentType === 'image/x-adobe-dng' ? 'RAW' : 'JPEG/HEIC'}</span>
            </div>
            <div className="mt-1 font-mono text-[12px] text-text-2">{formatBytes(r.file.size)}</div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded bg-surface-2" role="progressbar" aria-valuenow={Math.round(r.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.file.name} upload`}>
              <div className={`h-full transition-[width] duration-150 ${r.state === 'failed' ? 'bg-danger' : 'bg-signal-500'}`} style={{ width: `${Math.round(r.progress * 100)}%` }} />
            </div>
            {r.error ? (
              <div className="mt-1 flex items-center justify-between text-[13px] text-danger">
                <span>{r.error}</span>
                <button type="button" className="min-h-9 px-2 font-medium underline-offset-2 hover:underline" onClick={() => { update(i, { state: 'ready', error: undefined, progress: 0 }); started.current = false }}>
                  Retry this file
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {sessionId ? <p className="mt-2 font-mono text-[12px] text-text-3">session {sessionId}</p> : null}
    </div>
  )
}
