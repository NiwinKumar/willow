/**
 * Data seam. Demo mode serves the team's own measured journey (read-only); live mode reads the signed-in
 * person's sessions from the api. Screens never know which one they got. Nothing here is made up.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, type SessionView } from '../lib/api'
import { syncConsent } from '../lib/consent'
import { prefs } from '../lib/prefs'
import { useAuth } from '../lib/useAuth'
import { DataContext, type DataState, type DataStatus } from './context'
import { holdDemo, peekDemo, pickDemo, releaseDemo, type DemoPick } from './demoSource'
import { groupBySite, sitesWithResults, toSession } from './live'
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
  // Sessions are kept with the uid they belong to, so a failed first load for the next person on
  // this device can never show the previous person's sessions.
  const [owned, setOwned] = useState<{ uid: string | null; views: SessionView[] }>({ uid: null, views: [] })
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
    if (r.sessions) setOwned({ uid: r.uid, views: r.sessions })
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

  // Demo mode reads the team's journey once per entry and holds it until demo mode is left.
  const [demoPick, setDemoPick] = useState<DemoPick | null>(() => (demo ? peekDemo() : null))
  const [pickedFor, setPickedFor] = useState(demo)
  if (pickedFor !== demo) {
    setPickedFor(demo)
    setDemoPick(demo ? peekDemo() : null)
  }
  useEffect(() => {
    if (!demo) return
    let alive = true
    void pickDemo().then((p) => {
      if (!alive) return
      holdDemo(p)
      setDemoPick(p)
    })
    return () => {
      alive = false
      releaseDemo()
    }
  }, [demo])

  // Goals live on this device; held in state so saving them in You re-orders Home and results at once.
  const [goalsLive, setGoalsLive] = useState(prefs.goals)
  const [goalsDemo, setGoalsDemo] = useState(demoGoals)
  const setGoals = useCallback(
    (goals: string[]) => {
      // The demo journey (this tab) orders by the same goals, so it gets a copy too.
      try {
        sessionStorage.setItem('willow.goals', JSON.stringify(goals))
      } catch {
        /* private mode */
      }
      setGoalsDemo(goals)
      if (!demo) {
        prefs.setGoals(goals)
        setGoalsLive(goals)
      }
    },
    [demo],
  )
  // A new person on this device (sign-in, sign-out) reads their own saved goals.
  const [goalsUid, setGoalsUid] = useState(uid)
  if (goalsUid !== uid) {
    setGoalsUid(uid)
    setGoalsLive(prefs.goals())
  }

  const upsert = useCallback(
    (view: SessionView) => {
      setOwned((o) => (o.uid === uid ? { uid, views: [...o.views.filter((v) => v.session.id !== view.session.id), view] } : { uid, views: [view] }))
    },
    [uid],
  )

  const value = useMemo<DataState>(() => {
    if (demo) {
      const goals = goalsDemo
      const empty = { mode: 'demo' as const, sites: [], series: () => null, all: [], goals, setGoals, refresh: noop, upsert: () => {} }
      if (!demoPick) return { ...empty, status: 'loading' }
      if (demoPick.source !== 'real') return { ...empty, status: 'error' }
      const real = groupBySite(demoPick.views)
      const all = demoPick.views.map(toSession).sort((a, b) => a.created_at.localeCompare(b.created_at))
      return { mode: 'demo', status: 'ready', sites: sitesWithResults(real), series: (site) => real[site] ?? null, all, goals, setGoals, refresh: noop, upsert: () => {} }
    }
    const status: DataStatus = !uid ? 'idle' : loaded.uid === uid ? loaded.status : 'loading'
    const mine = owned.uid === uid ? owned.views : []
    const bySite = groupBySite(mine)
    const all = mine.map(toSession).sort((a, b) => a.created_at.localeCompare(b.created_at))
    return { mode: 'live', status, sites: sitesWithResults(bySite), series: (site) => bySite[site] ?? null, all, goals: goalsLive, setGoals, refresh, upsert }
  }, [demo, demoPick, uid, loaded, owned, refresh, upsert, goalsLive, goalsDemo, setGoals])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
