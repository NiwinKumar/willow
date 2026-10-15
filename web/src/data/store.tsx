/**
 * Data seam. Demo mode serves the team's seeded journey (or the illustrative one); live mode reads the signed-in
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
import { holdDemo, peekDemo, pickDemo, releaseDemo, type DemoPick } from './demoSource'
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

  // Demo mode prefers the seeded real journey (api /v1/demo/journey) and falls back to the illustration.
  // The source is picked once per demo entry (waiting up to 1.5 s) and held until demo mode is left,
  // so a report never swaps its data under the viewer.
  const [demoPick, setDemoPick] = useState<DemoPick | null>(() => (demo ? peekDemo() : null))
  const [pickedFor, setPickedFor] = useState(demo)
  if (pickedFor !== demo) {
    setPickedFor(demo)
    setDemoPick(demo ? peekDemo() : null)
  }
  useEffect(() => {
    if (!demo) return
    let alive = true
    // A pick already made (the one the landing page described) is held at once; otherwise wait for one.
    const now = peekDemo()
    if (now) holdDemo(now)
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

  const upsert = useCallback(
    (view: SessionView) => {
      setOwned((o) => (o.uid === uid ? { uid, views: [...o.views.filter((v) => v.session.id !== view.session.id), view] } : { uid, views: [view] }))
    },
    [uid],
  )

  const value = useMemo<DataState>(() => {
    if (demo) {
      const goals = demoGoals()
      if (!demoPick) return { mode: 'demo', status: 'loading', sites: [], series: () => null, goals, refresh: noop, upsert: () => {} }
      if (demoPick.source === 'real') {
        const real = groupBySite(demoPick.views)
        return { mode: 'demo', demoSource: 'real', status: 'ready', sites: sitesWithResults(real), series: (site) => real[site] ?? null, goals, refresh: noop, upsert: () => {} }
      }
      return { mode: 'demo', demoSource: 'illustrative', status: 'ready', sites: DEMO_SITES, series: (site) => DEMO_SERIES[site] ?? null, goals, refresh: noop, upsert: () => {} }
    }
    const status: DataStatus = !uid ? 'idle' : loaded.uid === uid ? loaded.status : 'loading'
    const mine = owned.uid === uid ? owned.views : []
    const bySite = groupBySite(mine)
    return { mode: 'live', status, sites: sitesWithResults(bySite), series: (site) => bySite[site] ?? null, goals: prefs.goals(), refresh, upsert }
  }, [demo, demoPick, uid, loaded, owned, refresh, upsert])

  // Screens read demo data as always ready, so they wait here (at most 1.5 s) until the source is picked.
  return (
    <DataContext.Provider value={value}>
      {demo && !demoPick ? (
        <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
          <p className="text-[15px] text-text-2">Loading the sample journey…</p>
        </div>
      ) : (
        children
      )}
    </DataContext.Provider>
  )
}
