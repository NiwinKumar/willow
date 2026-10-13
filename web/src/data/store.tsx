/**
 * Data seam. Demo mode serves the illustrative sample journeys; live mode reads the signed-in
 * person's sessions from the api. Screens never know which one they got.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, type SessionView } from '../lib/api'
import { prefs } from '../lib/prefs'
import { useAuth } from '../lib/useAuth'
import { DEMO_SERIES, DEMO_SITES } from '../mock/series'
import { DataContext, type DataState, type DataStatus } from './context'
import { groupBySite, sitesWithResults } from './live'

const noop = async () => {}

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
  const demo = params.get('demo') === '1' || sessionStorage.getItem('willow.demo') === '1'
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

  // Until this uid's first answer arrives, status derives as loading (see value below).
  useEffect(() => {
    if (demo || !uid) return
    let alive = true
    void load(uid).then((r) => alive && apply(r))
    return () => {
      alive = false
    }
  }, [demo, uid, load, apply])

  const upsert = useCallback((view: SessionView) => {
    setViews((vs) => [...vs.filter((v) => v.session.id !== view.session.id), view])
  }, [])

  const value = useMemo<DataState>(() => {
    if (demo) {
      return { mode: 'demo', status: 'ready', sites: DEMO_SITES, series: (site) => DEMO_SERIES[site] ?? null, goals: demoGoals(), refresh: noop, upsert: () => {} }
    }
    const status: DataStatus = !uid ? 'idle' : loaded.uid === uid ? loaded.status : 'loading'
    const mine = loaded.uid === uid ? views : []
    const bySite = groupBySite(mine)
    return { mode: 'live', status, sites: sitesWithResults(bySite), series: (site) => bySite[site] ?? null, goals: prefs.goals(), refresh, upsert }
  }, [demo, uid, loaded, views, refresh, upsert])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
