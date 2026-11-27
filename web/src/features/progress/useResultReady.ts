import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { inFlight } from '../../data/live'
import type { Session } from '../../data/types'
import { useData } from '../../data/useData'
import { SITE_LABEL } from '../../lib/metrics'

/** Status each session had the last time any screen with this notice looked (module-wide, so leaving a page keeps it). */
const seen = new Map<string, Session['status']>()
/** A result that lands hours later is not news: only check-ins started within this window are announced. */
const FRESH_MS = 2 * 60 * 60 * 1000

/**
 * "Your result is ready": a check-in the person left while it was measuring (closed the check-in, or a several-
 * place walk that ends before the results) finished. The DataProvider keeps reading in-flight sessions; this
 * watches them go from uploading/processing to done and says so with a View action. Nothing while the check-in
 * is open (it shows its own result) or while the person is already on that result.
 *
 * Used by Home and Progress (the pages the check-in returns to). Used once in the app shell instead, it would
 * cover every page; `seen` is shared, so using it in more places never announces a result twice.
 */
export function useResultReady() {
  const data = useData()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  useEffect(() => {
    if (data.mode !== 'live') return
    const landed: Session[] = []
    for (const s of data.all) {
      const before = seen.get(s.id)
      seen.set(s.id, s.status)
      if (s.sample_id || s.status !== 'done' || !before || !inFlight({ status: before })) continue
      if (Date.now() - Date.parse(s.created_at) > FRESH_MS) continue
      landed.push(s)
    }
    if (!landed.length || pathname === '/check-in') return
    const news = landed.filter((s) => !pathname.includes(s.id) && !search.includes(s.id))
    if (!news.length) return
    const lead = news.find((s) => s.site === 'face_full') ?? news[0]
    const ok = news.some((s) => s.result?.quality.passed)
    toast(ok ? (news.length > 1 ? 'Your results are ready' : 'Your result is ready') : 'Your check-in is back', {
      id: 'result-ready',
      duration: 10_000,
      description: news.map((s) => SITE_LABEL[s.site]).join(' · '),
      action: { label: 'View', onClick: () => navigate(`/result/${lead.id}`) },
    })
  }, [data.all, data.mode, pathname, search, navigate])
}
