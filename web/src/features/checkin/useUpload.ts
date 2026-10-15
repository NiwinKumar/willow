import { useCallback, useEffect, useRef, useState } from 'react'

import type { CaptureMode, Site } from '../../data/types'
import { ApiError, api, putSigned, type UploadTarget } from '../../lib/api'
import { useAuth } from '../../lib/useAuth'
import type { FileRow } from './files'
import { pruneMissing } from './topup'

/**
 * The session this attempt uploads into. `slots[i]` is the row uploaded as frame i+1, or null for a
 * frame that was already in the session (a top-up's earlier photos). Targets are looked up by index.
 */
type Created = { id: string; targets: UploadTarget[]; issuedAt: number; slots: (string | null)[] }

/** Signed upload links last 15 minutes (api settings): renew before any file starts after 10. */
const RENEW_AFTER = 10 * 60_000
const BACKOFF = [1000, 3000, 9000]

/**
 * The upload engine (from the old UploadList): one session per attempt, each file one XHR PUT to its V4
 * signed URL, two at a time, three tries with 1/3/9 s backoff, a 60 s stall watchdog (putSigned), signed
 * URL renewal, the screen kept awake, and a byte check (GET …/objects) before handing over.
 * Offline is a pause, not a failure: rows wait and resume on the `online` event (or Retry now).
 *
 * The photo list stays editable until analyze: rows added after the session exists become new frames
 * (POST …/frames), `remove` deletes an uploaded frame (DELETE …/frames/{i}). `topup` names an existing
 * session to add photos to instead of creating one. The byte check also reports photos identical to
 * ones uploaded before (`duplicate_of`): the hand-over then waits for Replace, Remove or `proceed`.
 */
export function useUpload({ site, mode, onDone, topup = null }: { site: Site; mode: CaptureMode; onDone: (sessionId: string) => void; topup?: string | null }) {
  const { getIdToken } = useAuth()
  const [rows, setRowsState] = useState<FileRow[]>([])
  const rowsRef = useRef<FileRow[]>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  // Duplicates found by the byte check: measuring waits for the person.
  const [held, setHeld] = useState(false)
  const acceptDuplicates = useRef(false)
  const created = useRef<Created | null>(null)
  const topupRef = useRef(topup)
  topupRef.current = topup
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

  /** The session to upload into: this attempt's, a top-up's (read back from the api), or a new one. */
  const ensureSession = async (token: string, good: FileRow[]): Promise<Created> => {
    if (!created.current && topupRef.current) {
      // Frames a dropped earlier attempt added but never sent are removed first, so they can't block measuring.
      const id = topupRef.current
      const { frames } = await pruneMissing(token, id)
      created.current = { id, targets: [], issuedAt: 0, slots: Array.from({ length: frames }, () => null) }
    }
    if (!created.current) {
      const res = await api.createSession(token, { site, capture_mode: mode, n_frames: good.length, content_types: good.map((r) => r.contentType) })
      created.current = { id: res.session_id, targets: res.upload_urls, issuedAt: Date.now(), slots: good.map((r) => r.id) }
      setSessionId(res.session_id)
      return created.current
    }
    const c = created.current
    const pending = good.filter((r) => !c.slots.includes(r.id))
    if (pending.length) {
      const res = await api.addFrames(token, c.id, { add: pending.length, content_types: pending.map((r) => r.contentType) })
      // Dropped frames (left out by an earlier measurement) shift every index: older targets are stale.
      const shifted = res.dropped.length > 0
      created.current = {
        ...c,
        slots: [...c.slots.filter((_, i) => !res.dropped.includes(i + 1)), ...pending.map((r) => r.id)],
        targets: [...(shifted ? [] : c.targets), ...res.upload_urls],
        issuedAt: shifted || !c.issuedAt ? Date.now() : c.issuedAt,
      }
    }
    setSessionId(c.id)
    return created.current
  }

  const run = useCallback(async () => {
    if (busyRef.current) return
    const good = rowsRef.current.filter((r) => !r.problem)
    if (!good.length) return
    busyRef.current = true
    setBusy(true)
    setFatal(null)
    setHeld(false)
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
      const s = await ensureSession(await getIdToken(), good)
      let renewing: Promise<void> | null = null
      const targetFor = async (slot: number) => {
        const find = () => created.current!.targets.find((t) => t.index === slot + 1)
        if (Date.now() - created.current!.issuedAt > RENEW_AFTER || !find()) {
          // Assigned before any await, so both workers share one renewal.
          renewing ??= (async () => {
            const fresh = await api.reissueUploadUrls(await getIdToken(), s.id)
            created.current = { ...created.current!, targets: fresh.upload_urls, issuedAt: Date.now() }
          })().finally(() => {
            renewing = null // a failed renewal is retried by the next attempt
          })
          await renewing
        }
        const t = find()
        if (!t) throw new Error('no upload link for this photo')
        return t
      }
      const queue = s.slots.filter((id): id is string => id !== null && rowsRef.current.find((r) => r.id === id)?.state !== 'done')
      const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          let attempt = 0
          while (attempt < 3 && alive.current) {
            patch(id, { state: 'uploading', error: undefined })
            try {
              const row = rowsRef.current.find((r) => r.id === id)!
              await putSigned(await targetFor(created.current!.slots.indexOf(id)), row.file, (f) => patch(id, { progress: f }), abort.current.signal)
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
      const slots = created.current!.slots
      const mine = rowsRef.current.filter((r) => slots.includes(r.id))
      if (mine.every((r) => r.state === 'done')) {
        // Byte check: every object exists in the bucket before analysis is asked for.
        const res = await api.sessionObjects(await getIdToken(), s.id)
        const missing = res.objects.filter((o) => !o.exists || !o.size)
        if (missing.length) {
          for (const o of missing) {
            const id = slots[o.index - 1]
            if (id) patch(id, { state: 'failed', progress: 0, error: 'Willow did not receive this photo · retry' })
          }
          if (missing.some((o) => !slots[o.index - 1])) setFatal('Some earlier photos of this check-in are no longer stored, so it can’t be measured. Start a new check-in.')
          return
        }
        // Photos uploaded before (this attempt's rows only): mark them and wait for the person.
        const dup = new Map<string, { session_id: string; index: number }>()
        for (const o of res.objects) {
          const id = slots[o.index - 1]
          if (id && o.duplicate_of) dup.set(id, o.duplicate_of)
        }
        setRows(rowsRef.current.map((r) => (dup.has(r.id) ? { ...r, duplicate: dup.get(r.id) } : r.duplicate ? { ...r, duplicate: undefined } : r)))
        if (dup.size && !acceptDuplicates.current) {
          setHeld(true)
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
  const runRef = useRef(run)
  runRef.current = run

  /**
   * Take a photo out of the check-in. Before upload it just leaves the list; once it is a frame of the
   * session, the frame is deleted on the server too (later frames move up). `after` adjusts the rest of
   * the list (re-check, or add the replacement). Throws when the api refuses; the list is then unchanged.
   */
  const remove = useCallback(
    async (id: string, after: (rest: FileRow[]) => FileRow[] = (rest) => rest) => {
      if (busyRef.current) return
      const c = created.current
      const slot = c ? c.slots.indexOf(id) : -1
      if (c && slot >= 0) {
        if (c.slots.length === 1) {
          // The only photo of a new session: the next upload starts a fresh one (this one stays unmeasured).
          created.current = null
          setSessionId(null)
        } else {
          const res = await api.deleteFrame(await getIdToken(), c.id, slot + 1)
          created.current = { ...c, slots: c.slots.filter((_, i) => i !== slot), targets: res.upload_urls, issuedAt: Date.now() }
        }
      }
      const next = after(rowsRef.current.filter((r) => r.id !== id))
      setRows(next)
      if (!next.some((r) => r.duplicate)) setHeld(false)
      // What is left is all uploaded (a duplicate was removed): check the bytes again and hand over.
      const good = next.filter((r) => !r.problem)
      if (created.current && good.length && good.every((r) => r.state === 'done')) void runRef.current()
    },
    [getIdToken, setRows],
  )

  /** Measure with the duplicates the byte check found (the person chose to keep them). */
  const proceed = useCallback(() => {
    const c = created.current
    if (!c || busyRef.current) return
    acceptDuplicates.current = true
    setHeld(false)
    doneRef.current(c.id)
  }, [])

  /** A new attempt: drop the session (it stays unanalysed on the server) and start the list again. */
  const reset = useCallback(
    (next: FileRow[] = []) => {
      created.current = null
      acceptDuplicates.current = false
      setSessionId(null)
      setFatal(null)
      setHeld(false)
      setRows(next.map((r) => ({ ...r, state: 'ready', progress: 0, error: undefined, duplicate: undefined })))
    },
    [setRows],
  )

  return { rows, setRows, run, remove, proceed, held, busy, fatal, offline, retryNow: wakeWaiters, sessionId, locked: sessionId !== null, reset }
}

export type Upload = ReturnType<typeof useUpload>
