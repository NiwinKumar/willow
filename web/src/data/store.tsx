/**
 * Data seam. Demo mode serves the illustrative sample journeys; live mode reads the signed-in
 * person's sessions from the api. Screens never know which one they got.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, type SessionView } from '../lib/api'
import { syncConsent } from '../lib/consent'
import { prefs } from '../lib/prefs'
import { useAuth } from '../lib/useAuth'
import { DEMO_SERIES, DEMO_SITES } from '../mock/series'
import { DataContext, type DataState, type DataStatus } from './context'
import { groupBySite, sitesWithResults } from './live'
import { DEMO_EVENT } from './useData'

const noop = async () => {}

function storedDemo(): boolean {
  try {
    return sessionStorage.getItem('willow.demo') === '1'
  } catch {
    return false
  }
}

function demoGoals(): string[] {
  try {
    const goals = JSON.parse(sessionStorage.getItem('willow.goals') ?? '[]') as string[]
    return goals.length ? goals : ['even_tone', 'calmer']
  } catch {
    return ['even_tone', 'calmer']
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [params] = useSearchParams()
  const [stored, setStored] = useState(storedDemo)
  useEffect(() => {
    const on = () => setStored(storedDemo())
    window.addEventListener(DEMO_EVENT, on)
    return () => window.removeEventListener(DEMO_EVENT, on)
  }, [])
  const demo = params.get('demo') === '1' || stored
  const { user, getIdToken } = useAuth()
  const uid = user?.uid ?? null
  const [views, setViews] = useState<SessionView[]>([])
  const [loaded, setLoaded] = useState<{ uid: string | null; status: DataStatus }>({ uid: null, status: 'idle' })

  const load = useCallback(async (forUid: string) => {
    try {
      const res = await api.listSessions(await getIdToken())
      return { uid: forUid, status: 'ready' as const, sessions: res.sessions }
    } catch {
      return { uid: forUid, status: 'error' as const, sessions: null }
    }
  }, [getIdToken])

  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    if (r.sessions) setViews(r.sessions)
    setLoaded({ uid: r.uid, status: r.status })
  }, [])

  const refresh = useCallback(async () => {
    if (demo || !uid) return
    apply(await load(uid))
  }, [demo, uid, load, apply])

  // Consent given on this device belongs to the account once someone is signed in.
  useEffect(() => {
    if (demo || !uid) return
    syncConsent(uid, getIdToken).catch(() => undefined)
  }, [demo, uid, getIdToken])

  // Until this uid's first answer arrives, status derives as loading (see value below).
  useEffect(() => {
    if (demo || !uid) return
    let alive = true
    void load(uid).then((r) => alive && apply(r))
    return () => {
      alive = false
    }
  }, [demo, uid, load, apply])

  // Demo mode prefers the seeded real journey (api /v1/demo/journey) and falls back to the illustration.
  // Signed photo URLs last about an hour: refetch when demo mode is entered again after 10 minutes.
  const [journey, setJourney] = useState<{ views: SessionView[]; at: number } | null>(null)
  useEffect(() => {
    if (!demo || (journey && Date.now() - journey.at < 600_000)) return
    let alive = true
    api
      .demoJourney()
      .then((r) => alive && setJourney({ views: r.sessions.filter((v) => v.session.status === 'done'), at: Date.now() }))
      .catch(() => alive && setJourney({ views: [], at: Date.now() }))
    return () => {
      alive = false
    }
  }, [demo, journey])

  const upsert = useCallback((view: SessionView) => {
    setViews((vs) => [...vs.filter((v) => v.session.id !== view.session.id), view])
  }, [])

  const value = useMemo<DataState>(() => {
    if (demo) {
      if (journey?.views.length) {
        const real = groupBySite(journey.views)
        return { mode: 'demo', demoSource: 'real', status: 'ready', sites: sitesWithResults(real), series: (site) => real[site] ?? null, goals: demoGoals(), refresh: noop, upsert: () => {} }
      }
      return { mode: 'demo', demoSource: 'illustrative', status: 'ready', sites: DEMO_SITES, series: (site) => DEMO_SERIES[site] ?? null, goals: demoGoals(), refresh: noop, upsert: () => {} }
    }
    const status: DataStatus = !uid ? 'idle' : loaded.uid === uid ? loaded.status : 'loading'
    const mine = loaded.uid === uid ? views : []
    const bySite = groupBySite(mine)
    return { mode: 'live', status, sites: sitesWithResults(bySite), series: (site) => bySite[site] ?? null, goals: prefs.goals(), refresh, upsert }
  }, [demo, journey, uid, loaded, views, refresh, upsert])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
