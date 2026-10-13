import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '../components/Button'
import { api, putSigned, type CaptureMode, type ObjectStatus, type Site } from '../lib/api'
import { useAuth } from '../lib/useAuth'

type Row = { file: File; contentType: string; progress: number; state: 'ready' | 'uploading' | 'done' | 'failed'; error?: string }

const EXT_TYPE: Record<string, string> = {
  dng: 'image/x-adobe-dng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
  heif: 'image/heif',
}

function contentTypeFor(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TYPE[ext] ?? null
}

function base64ToHex(b64: string): string {
  const bin = atob(b64)
  let out = ''
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0')
  return out
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function UploadTest() {
  const { user, loading, continueAsGuest, getIdToken } = useAuth()
  const [site, setSite] = useState<Site>('forearm_treated')
  const [rows, setRows] = useState<Row[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [objects, setObjects] = useState<ObjectStatus[] | null>(null)
  const [busy, setBusy] = useState(false)

  const mode: CaptureMode | null =
    rows.length === 0 ? null : rows.every((r) => r.contentType === 'image/x-adobe-dng') ? 'calibrated_raw' : 'uncalibrated'
  const mixed = rows.length > 0 && rows.some((r) => r.contentType === 'image/x-adobe-dng') && mode !== 'calibrated_raw'

  function onPick(files: FileList | null) {
    if (!files) return
    const next: Row[] = []
    for (const file of Array.from(files)) {
      const ct = contentTypeFor(file)
      if (!ct) {
        toast.error(`${file.name}: only .dng, .jpg or .heic files`)
        continue
      }
      if (file.size === 0) {
        toast.error(`${file.name} is empty on this phone. Open it once in the Files app so iCloud downloads it, then choose it again.`)
        continue
      }
      next.push({ file, contentType: ct, progress: 0, state: 'ready' })
    }
    setRows((prev) => [...prev, ...next].slice(0, 5))
    setObjects(null)
    setSessionId(null)
  }

  async function upload() {
    if (!mode || mixed || rows.length === 0) return
    setBusy(true)
    try {
      const token = await getIdToken()
      const session = await api.createSession(token, {
        site,
        capture_mode: mode,
        n_frames: rows.length,
        content_types: rows.map((r) => r.contentType),
      })
      setSessionId(session.session_id)
      // Two uploads at a time; each PUT streams the File from disk.
      const queue = rows.map((_, i) => i)
      const worker = async () => {
        for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
          const idx = i
          setRows((prev) => prev.map((r, j) => (j === idx ? { ...r, state: 'uploading' } : r)))
          try {
            await putSigned(session.upload_urls[idx], rows[idx].file, (f) =>
              setRows((prev) => prev.map((r, j) => (j === idx ? { ...r, progress: f } : r))),
            )
            setRows((prev) => prev.map((r, j) => (j === idx ? { ...r, state: 'done', progress: 1 } : r)))
          } catch (e) {
            setRows((prev) => prev.map((r, j) => (j === idx ? { ...r, state: 'failed', error: String(e) } : r)))
          }
        }
      }
      await Promise.all([worker(), worker()])
      const result = await api.sessionObjects(token, session.session_id)
      setObjects(result.objects)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-text-2">Checking sign-in…</p>
  if (!user)
    return (
      <div className="max-w-[36rem]">
        <p className="text-text-2">Sign in to test an upload. A guest account is enough.</p>
        <Button className="mt-4" onClick={() => continueAsGuest().catch((e) => toast.error(String(e)))}>
          Continue as guest
        </Button>
      </div>
    )

  return (
    <div className="max-w-[36rem]">
      <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em]">Upload test</h1>
      <p className="mt-2 text-[15px] text-text-2">
        Proves a DNG lands in Cloud Storage byte-identical. On iPhone, choose files from the Files app (Browse, then
        the … menu, then Select for several). Photos converts to JPEG.
      </p>

      <label className="mt-6 block text-[13px] font-medium">
        Site
        <select
          value={site}
          onChange={(e) => setSite(e.target.value as Site)}
          className="mt-1 block w-full rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-[16px]"
        >
          <option value="forearm_treated">Forearm, treated</option>
          <option value="forearm_control">Forearm, control</option>
          <option value="face_full">Face</option>
          <option value="cheek_macro">Cheek close-up</option>
          <option value="nose_macro">Nose close-up</option>
        </select>
      </label>

      <label className="mt-4 block">
        <span className="text-[13px] font-medium">Files (1 to 5)</span>
        <input
          type="file"
          multiple
          accept=".dng,image/x-adobe-dng,image/dng,.jpg,.jpeg,image/jpeg,.heic,image/heic"
          onChange={(e) => onPick(e.target.files)}
          className="mt-1 block w-full text-[15px] file:mr-3 file:rounded-(--radius-control) file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-[15px]"
        />
      </label>

      {mixed ? <p className="mt-2 text-[13px] text-danger">Mix of RAW and JPEG. Choose one kind per session.</p> : null}

      {rows.length > 0 ? (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {rows.map((r, i) => {
            const remote = objects?.[i]
            const sizeMatch = remote?.exists && remote.size === r.file.size
            return (
              <li key={`${r.file.name}-${i}`} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{r.file.name}</span>
                  <span className="shrink-0 rounded-(--radius-chip) bg-surface-2 px-1.5 py-0.5 text-[12px] text-text-2">
                    {r.contentType === 'image/x-adobe-dng' ? 'RAW' : 'JPEG/HEIC'}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[13px] text-text-2">
                  local {formatBytes(r.file.size)} · {r.file.size.toLocaleString()} bytes
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded bg-surface-2">
                  <div
                    className={`h-full transition-[width] duration-150 ${r.state === 'failed' ? 'bg-danger' : 'bg-signal-500'}`}
                    style={{ width: `${Math.round(r.progress * 100)}%` }}
                  />
                </div>
                {r.error ? <p className="mt-1 text-[13px] text-danger">{r.error}</p> : null}
                {remote ? (
                  <div className="mt-2 font-mono text-[13px]">
                    {remote.exists ? (
                      <>
                        <div className={sizeMatch ? 'text-willow-700' : 'text-danger'}>
                          in GCS {remote.size?.toLocaleString()} bytes {sizeMatch ? '· size matches' : '· size differs'}
                        </div>
                        <div className="break-all text-text-2">md5 {remote.md5_base64 ? base64ToHex(remote.md5_base64) : '?'}</div>
                        <div className="text-text-3">compare on your Mac: md5 -q "{r.file.name}"</div>
                      </>
                    ) : (
                      <div className="text-danger">not found in GCS</div>
                    )}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={upload} disabled={busy || rows.length === 0 || mixed}>
          {busy ? 'Uploading…' : `Upload ${rows.length || ''} ${rows.length === 1 ? 'file' : 'files'}`}
        </Button>
        {rows.length > 0 ? (
          <Button variant="quiet" disabled={busy} onClick={() => { setRows([]); setObjects(null); setSessionId(null) }}>
            Clear
          </Button>
        ) : null}
      </div>
      {sessionId ? <p className="mt-3 font-mono text-[13px] text-text-3">session {sessionId}</p> : null}
    </div>
  )
}
