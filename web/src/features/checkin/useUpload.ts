import { useCallback, useEffect, useRef, useState } from 'react'

import type { CaptureMode, Site } from '../../data/types'
import { ApiError, api, putSigned, type UploadTarget } from '../../lib/api'
import { useAuth } from '../../lib/useAuth'
import type { FileRow } from './files'

type Created = { id: string; targets: UploadTarget[]; issuedAt: number; ids: string[] }

/** Signed upload links last 15 minutes (api settings): renew before any file starts after 10. */
const RENEW_AFTER = 10 * 60_000
const BACKOFF = [1000, 3000, 9000]

/**
 * The upload engine (from the old UploadList): one session per attempt, created with the frame count
 * and content types (fixed from then on, so the list locks), each file one XHR PUT to its V4 signed
 * URL, two at a time, three tries with 1/3/9 s backoff, a 60 s stall watchdog (putSigned), signed
 * URL renewal, the screen kept awake, and a byte check (GET …/objects) before handing over.
 * Offline is a pause, not a failure: rows wait and resume on the `online` event (or Retry now).
 */
export function useUpload({ site, mode, onDone }: { site: Site; mode: CaptureMode; onDone: (sessionId: string) => void }) {
  const { getIdToken } = useAuth()
  const [rows, setRowsState] = useState<FileRow[]>([])
  const rowsRef = useRef<FileRow[]>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const created = useRef<Created | null>(null)
  const wake = useRef<WakeLockSentinel | null>(null)
  const alive = useRef(true)
  // Aborts the PUTs in flight when the check-in closes.
  const abort = useRef(new AbortController())
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  // Everyone waiting for the network (paused rows, a run started offline) wakes on `online` or Retry now.
  const waiters = useRef<(() => void)[]>([])
  const wakeWaiters = useCallback(() => {
    const w = waiters.current
    waiters.current = []
    w.forEach((f) => f())
  }, [])
  const waitOnline = () => new Promise<void>((resolve) => waiters.current.push(resolve))

  const setRows = useCallback((next: FileRow[]) => {
    rowsRef.current = next
    setRowsState(next)
  }, [])

  useEffect(() => {
    alive.current = true
    if (abort.current.signal.aborted) abort.current = new AbortController()
    const on = () => {
      setOffline(false)
      wakeWaiters()
    }
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      alive.current = false
      abort.current.abort()
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      // Rows paused for the network stop waiting; their workers see alive=false and end.
      wakeWaiters()
      wake.current?.release().catch(() => undefined)
    }
  }, [wakeWaiters])

  // The wake lock is dropped when the tab hides; take it again when it comes back mid-upload.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && wake.current === null && busyRef.current) void requestWake()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  async function requestWake() {
    try {
      const lock = (await navigator.wakeLock?.request('screen')) ?? null
      // Closed while the lock was being granted: let it go straight away.
      if (!alive.current) {
        lock?.release().catch(() => undefined)
        return
      }
      wake.current = lock
      wake.current?.addEventListener('release', () => {
        wake.current = null
      })
    } catch {
      /* unsupported or denied: fine */
    }
  }

  const patch = (id: string, p: Partial<FileRow>) => {
    if (!alive.current) return
    setRows(rowsRef.current.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }

  const run = useCallback(async () => {
    if (busyRef.current) return
    const good = rowsRef.current.filter((r) => !r.problem)
    if (!good.length) return
    busyRef.current = true
    setBusy(true)
    setFatal(null)
    await requestWake()
    // Done rows stay done (a retry never sends them again); everything else starts over.
    setRows(rowsRef.current.map((r) => (r.problem || r.state === 'done' ? r : { ...r, state: 'ready', error: undefined, progress: 0 })))
    try {
      while (!navigator.onLine && alive.current) {
        setOffline(true)
        await waitOnline()
      }
      // Closed while waiting for the network: never create a session nobody uploads to.
      if (!alive.current) return
      const token = await getIdToken()
      if (!created.current) {
        const res = await api.createSession(token, { site, capture_mode: mode, n_frames: good.length, content_types: good.map((r) => r.contentType) })
        created.current = { id: res.session_id, targets: res.upload_urls, issuedAt: Date.now(), ids: good.map((r) => r.id) }
        setSessionId(res.session_id)
      }
      const s = created.current
      let renewing: Promise<void> | null = null
      const targetsNow = async () => {
        const c = created.current!
        if (Date.now() - c.issuedAt > RENEW_AFTER) {
          // Assigned before any await, so both workers share one renewal.
          renewing ??= (async () => {
            const fresh = await api.reissueUploadUrls(await getIdToken(), c.id)
            created.current = { ...c, targets: fresh.upload_urls, issuedAt: Date.now() }
          })().finally(() => {
            renewing = null // a failed renewal is retried by the next attempt
          })
          await renewing
        }
        return created.current!.targets
      }
      const queue = s.ids.filter((id) => rowsRef.current.find((r) => r.id === id)?.state !== 'done')
      const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          const slot = s.ids.indexOf(id)
          let attempt = 0
          while (attempt < 3 && alive.current) {
            patch(id, { state: 'uploading', error: undefined })
            try {
              const row = rowsRef.current.find((r) => r.id === id)!
              await putSigned((await targetsNow())[slot], row.file, (f) => patch(id, { progress: f }), abort.current.signal)
              patch(id, { state: 'done', progress: 1 })
              break
            } catch {
              if (!alive.current) break
              if (!navigator.onLine) {
                // Offline: wait without spending a try; the row resumes from the start.
                patch(id, { state: 'paused', progress: 0 })
                setOffline(true)
                await waitOnline()
                continue
              }
              attempt += 1
              if (attempt >= 3) patch(id, { state: 'failed', error: 'Upload failed · connection dropped' })
              else await new Promise((r) => setTimeout(r, BACKOFF[attempt - 1]))
            }
          }
        }
      }
      await Promise.all([worker(), worker()])
      if (!alive.current) return
      const mine = rowsRef.current.filter((r) => s.ids.includes(r.id))
      if (mine.every((r) => r.state === 'done')) {
        // Byte check: every object exists in the bucket before analysis is asked for.
        const res = await api.sessionObjects(await getIdToken(), s.id)
        const missing = res.objects.filter((o) => !o.exists || !o.size).map((o) => o.index)
        if (missing.length) {
          for (const i of missing) {
            const id = s.ids[i]
            if (id) patch(id, { state: 'failed', progress: 0, error: 'Willow did not receive this photo · retry' })
          }
          return
        }
        doneRef.current(s.id)
      }
    } catch (e) {
      if (!alive.current) return
      const signedOut = e instanceof Error && /not signed in/i.test(e.message)
      setFatal(
        e instanceof ApiError
          ? e.message
          : signedOut
            ? 'You were signed out. Sign in again to keep uploading.'
            : !navigator.onLine
              ? 'You’re offline. Nothing was lost; try again when you’re back online.'
              : 'Could not reach Willow. Check your connection.',
      )
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(false)
      wake.current?.release().catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads rows through the ref on purpose
  }, [getIdToken, site, mode, setRows])

  /** A new attempt: drop the session (it stays unanalysed on the server) and unlock the list. */
  const reset = useCallback(
    (next: FileRow[] = []) => {
      created.current = null
      setSessionId(null)
      setFatal(null)
      setRows(next.map((r) => ({ ...r, state: 'ready', progress: 0, error: undefined })))
    },
    [setRows],
  )

  return { rows, setRows, run, busy, fatal, offline, retryNow: wakeWaiters, sessionId, locked: sessionId !== null, reset }
}

export type Upload = ReturnType<typeof useUpload>
