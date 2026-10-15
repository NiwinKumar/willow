/**
 * Data seam. Demo mode serves the team's own measured journey (read-only); live mode reads the signed-in
 * person's sessions from the api. Screens never know which one they got. Nothing here is made up.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, type ProfilePatch, type SessionView } from '../lib/api'
import { syncConsent } from '../lib/consent'
import { cleanGoals, migrateGoals, type GoalId } from '../lib/metrics'
import { localProfile, pushProfile, syncProfile, writeLocal } from '../lib/profile'
import { invalidate } from '../lib/query'
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

/** The demo journey's goals (this tab). A list saved under the old goal ids ('willow.goals') is read as the new ones. */
const DEMO_GOALS: GoalId[] = ['dark_spots', 'even_tone', 'redness']
function demoGoals(): GoalId[] {
  try {
    const now = sessionStorage.getItem('willow.goals2')
    const goals = now !== null ? cleanGoals(JSON.parse(now)) : migrateGoals(JSON.parse(sessionStorage.getItem('willow.goals') ?? '[]'))
    return goals.length ? goals : DEMO_GOALS
  } catch {
    return DEMO_GOALS
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

  // Photo previews are signed URLs the api reissues with at least 2 h left (api/app/storage.py). A tab left
  // open longer than an hour reads the sessions again when it is looked at, so photos never go stale.
  const loadedAt = useRef(0)
  useEffect(() => {
    if (loaded.status === 'ready') loadedAt.current = Date.now()
  }, [owned, loaded.status])
  useEffect(() => {
    if (demo || !uid) return
    const STALE_MS = 60 * 60_000
    const check = () => {
      if (document.visibilityState === 'visible' && loadedAt.current && Date.now() - loadedAt.current > STALE_MS) void refresh()
    }
    document.addEventListener('visibilitychange', check)
    const t = window.setInterval(check, 10 * 60_000)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.clearInterval(t)
    }
  }, [demo, uid, refresh])

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

  // The profile (goals, photo time, skin type, check-in days): a copy on this device, held in state so a change
  // in You re-orders Home and results at once. Signed in, the account is the source of truth (lib/profile).
  const [profile, setProfile] = useState(localProfile)
  const [goalsDemo, setGoalsDemo] = useState(demoGoals)
  const edits = useRef(0)
  const displayName = user && !user.isAnonymous ? user.displayName : null

  const saveProfile = useCallback(
    async (patch: ProfilePatch) => {
      edits.current += 1
      writeLocal(patch)
      setProfile(localProfile())
      // Someone not signed in yet sends it at sign-in (syncProfile).
      if (!uid) return
      await pushProfile(getIdToken)
      invalidate(['me', uid])
    },
    [uid, getIdToken],
  )

  const setGoals = useCallback(
    (goals: string[]) => {
      const clean = cleanGoals(goals)
      // The demo journey (this tab) orders by the same goals, so it gets a copy too.
      try {
        sessionStorage.setItem('willow.goals2', JSON.stringify(clean))
      } catch {
        /* private mode */
      }
      setGoalsDemo(clean)
      if (!demo) void saveProfile({ goals: clean }).catch(() => undefined)
    },
    [demo, saveProfile],
  )

  // A new person on this device (sign-in, sign-out) reads their own copy, then the account's (account wins).
  const [profileUid, setProfileUid] = useState(uid)
  if (profileUid !== uid) {
    setProfileUid(uid)
    setProfile(localProfile())
  }
  useEffect(() => {
    if (demo || !uid) return
    let alive = true
    const at = edits.current
    syncProfile(getIdToken, displayName)
      .then((p) => {
        // A change made while this was in flight is newer than the account's copy: keep it.
        if (alive && edits.current === at) setProfile(p)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [demo, uid, getIdToken, displayName])

  const upsert = useCallback(
    (view: SessionView) => {
      setOwned((o) => (o.uid === uid ? { uid, views: [...o.views.filter((v) => v.session.id !== view.session.id), view] } : { uid, views: [view] }))
    },
    [uid],
  )

  const value = useMemo<DataState>(() => {
    if (demo) {
      const goals = goalsDemo
      const empty = { mode: 'demo' as const, sites: [], series: () => null, all: [], goals, setGoals, profile, saveProfile, refresh: noop, upsert: () => {} }
      if (!demoPick) return { ...empty, status: 'loading' }
      if (demoPick.source !== 'real') return { ...empty, status: 'error' }
      const real = groupBySite(demoPick.views)
      const all = demoPick.views.map(toSession).sort((a, b) => a.created_at.localeCompare(b.created_at))
      return { mode: 'demo', status: 'ready', sites: sitesWithResults(real), series: (site) => real[site] ?? null, all, goals, setGoals, profile, saveProfile, refresh: noop, upsert: () => {} }
    }
    const status: DataStatus = !uid ? 'idle' : loaded.uid === uid ? loaded.status : 'loading'
    const mine = owned.uid === uid ? owned.views : []
    const bySite = groupBySite(mine)
    const all = mine.map(toSession).sort((a, b) => a.created_at.localeCompare(b.created_at))
    return { mode: 'live', status, sites: sitesWithResults(bySite), series: (site) => bySite[site] ?? null, all, goals: profile.goals, setGoals, profile, saveProfile, refresh, upsert }
  }, [demo, demoPick, uid, loaded, owned, refresh, upsert, profile, goalsDemo, setGoals, saveProfile])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
