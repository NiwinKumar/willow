import { useCallback, useEffect, useRef, useState } from 'react'

import { watchSession } from '../../data/live'
import { useData } from '../../data/useData'
import { ApiError, api, type AnalysisStage, type SessionView } from '../../lib/api'
import { useAuth } from '../../lib/useAuth'

/** What the first read of the session said, so the screen can name the site before the result lands. */
export type SessionMeta = Pick<SessionView['session'], 'id' | 'site' | 'capture_mode' | 'n_frames' | 'status'> & { sample_id?: string | null; stage?: AnalysisStage | null }

export type AnalysisState =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: number }
  | { kind: 'done'; view: SessionView; fresh: boolean; startedAt: number; endedAt: number }
  | { kind: 'error'; status: number | null; code: string | null; message: string; startedAt: number; endedAt: number }
  | { kind: 'offline'; startedAt: number }

/** How often the live stage is read while measuring (GET /v1/sessions/{id}). */
const STAGE_POLL_MS = 2000

/**
 * Analyse a session exactly once, whatever reloads happen (the old analyzeOnce): a finished session is
 * shown as it is, one that another tab (or a reload) is analysing is waited for (up to the api's 6 min
 * stale window), anything else is analysed. analyze is one synchronous call (~35 s on a cold engine);
 * while it runs, `watch` reads the session's live `stage` every 2 s so the steps tick when the api moves on.
 */
async function analyzeOnce(
  token: string,
  sessionId: string,
  onMeta: (m: SessionMeta) => void,
  alive: () => boolean,
  watch: () => () => void,
): Promise<{ view: SessionView; fresh: boolean }> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let current = await api.getSession(token, sessionId)
  onMeta(current.session)
  for (let i = 0; current.session.status === 'processing' && i < 190 && alive(); i++) {
    await wait(STAGE_POLL_MS)
    current = await api.getSession(token, sessionId)
    onMeta(current.session)
  }
  if (current.session.status === 'done') return { view: current, fresh: false }
  // Closed while waiting: never start (or re-try) a run nobody is watching.
  if (!alive()) throw new Error('closed')
  const stop = watch()
  try {
    return { view: await api.analyze(token, sessionId), fresh: true }
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'conflict') return analyzeOnce(token, sessionId, onMeta, alive, watch)
    throw e
  } finally {
    stop()
  }
}

/**
 * The flow's measuring state, kept above the steps so Back or a re-render never starts a second run.
 * `note`/`deviation` ("Anything different today?") are PATCHed onto the session right before analyze.
 * `stage` is the api's live analysis stage (received → engine → explaining) while measuring, else null.
 */
export function useAnalysis(sessionId: string | null, extra: { note: string; deviation: boolean }) {
  const { user, loading: authLoading, getIdToken } = useAuth()
  const data = useData()
  const [state, setState] = useState<AnalysisState>({ kind: 'idle' })
  const [meta, setMeta] = useState<SessionMeta | null>(null)
  const [stage, setStage] = useState<AnalysisStage | null>(null)
  const [attempt, setAttempt] = useState(0)
  const ran = useRef<string | null>(null)
  const mounted = useRef(true)
  const patched = useRef<string | null>(null)
  const extraRef = useRef(extra)
  const upsert = useRef(data.upsert)
  // A new attempt (a new session id, or none) starts from a clean slate.
  const [forId, setForId] = useState(sessionId)
  if (forId !== sessionId) {
    setForId(sessionId)
    setState({ kind: 'idle' })
    setMeta(null)
    setStage(null)
  }
  const currentId = useRef(sessionId)
  // Latest values for the async run below (declared first, so it runs before the run effect).
  useEffect(() => {
    extraRef.current = extra
    upsert.current = data.upsert
    currentId.current = sessionId
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Offline while measuring: the server keeps going; on reconnect this run is picked up by polling.
  useEffect(() => {
    if (state.kind !== 'offline') return
    const on = () => setAttempt((a) => a + 1)
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [state.kind])

  useEffect(() => {
    // Wait for the signed-in person to be restored after a reload before asking the api.
    if (!sessionId || authLoading || !user) return
    const key = `${sessionId}:${attempt}`
    if (ran.current === key) return // React runs effects twice in development; one call per attempt
    ran.current = key
    const startedAt = Date.now()
    setState({ kind: 'running', startedAt })
    setStage(null)
    const live = () => mounted.current && currentId.current === sessionId
    const onMeta = (m: SessionMeta) => {
      if (!live()) return
      setMeta(m)
      setStage(m.status === 'processing' ? (m.stage ?? null) : null)
    }
    /** Read the stage every STAGE_POLL_MS while analyze is in flight; returns the stop function. */
    const watch = () => {
      let on = true
      void (async () => {
        while (on && live()) {
          await new Promise((r) => setTimeout(r, STAGE_POLL_MS))
          if (!on || !live()) break
          try {
            const v = await api.getSession(await getIdToken(), sessionId)
            if (on && live()) setStage(v.session.stage ?? null)
          } catch {
            /* a missed reading: the next one, or the answer, catches up */
          }
        }
      })()
      return () => {
        on = false
      }
    }
    void (async () => {
      if (!navigator.onLine) {
        setState({ kind: 'offline', startedAt })
        return
      }
      // This run reads the session itself (every 2 s): the DataProvider's own poll leaves it alone meanwhile.
      const unwatch = watchSession(sessionId)
      try {
        const token = await getIdToken()
        const { note, deviation } = extraRef.current
        if ((note.trim() || deviation) && patched.current !== sessionId) {
          try {
            await api.patchSession(token, sessionId, { note: note.trim() || null, deviation })
            patched.current = sessionId
          } catch {
            /* the note is optional: measuring goes ahead without it */
          }
        }
        const { view, fresh } = await analyzeOnce(token, sessionId, onMeta, live, watch)
        // Into the cache even if the person closed the check-in: Home shows it without a refetch.
        upsert.current(view)
        if (!live()) return
        setMeta(view.session)
        setState({ kind: 'done', view, fresh, startedAt, endedAt: Date.now() })
      } catch (e) {
        if (!live()) return
        if (!(e instanceof ApiError) && !navigator.onLine) {
          setState({ kind: 'offline', startedAt })
          return
        }
        const status = e instanceof ApiError ? e.status : null
        const code = e instanceof ApiError ? e.code : e instanceof TypeError ? 'network' : null
        setState({ kind: 'error', status, code, message: e instanceof Error ? e.message : '', startedAt, endedAt: Date.now() })
      } finally {
        unwatch()
      }
    })()
  }, [sessionId, attempt, authLoading, user, getIdToken])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  return { state, meta, stage, retry }
}
