/**
 * One session as GET /v1/sessions/{id} answers it. The list the screens read (useData) signs only each
 * session's photo; the single view also signs the redness overlay, every uploaded frame and the spot crops.
 * Read through the shared cache, so going back to a check-in never asks twice; scrubbing through check-ins
 * only reads the one the person stops on (a short settle delay).
 */
import { useEffect, useState } from 'react'

import { useOwner } from '../../data/hooks'
import { api, type SessionView } from '../../lib/api'
import { getQueryData, useQuery } from '../../lib/query'

const SETTLE_MS = 350
// Signed GET links live 6 hours (api storage._GET_TTL_SECONDS); read again well before they lapse.
const STALE_MS = 60 * 60_000

export function useSessionView(sessionId: string | null): SessionView | null {
  const uid = useOwner()
  const key = ['session-view', uid, sessionId]
  const cached = Boolean(getQueryData<SessionView>(key))
  const [settled, setSettled] = useState<string | null>(null)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(sessionId), SETTLE_MS)
    return () => window.clearTimeout(t)
  }, [sessionId])
  const q = useQuery(key, (t) => api.getSession(t, sessionId!), { enabled: Boolean(uid && sessionId) && (cached || settled === sessionId), staleMs: STALE_MS })
  return q.data && q.data.session.id === sessionId ? q.data : null
}
