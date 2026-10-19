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
import { DataActivateContext, DataContext, type DataState, type DataStatus } from './context'
import { holdDemo, peekDemo, pickDemo, releaseDemo, type DemoPick } from './demoSource'
import { groupBySite, inFlight, isWatched, sitesWithResults, stalled } from './live'
import { DEMO_EVENT } from './useData'

/** A session still uploading or measuring is read again on its own (GET one session), first after 5 s, then 10, then every 20. */
const POLL_FIRST_MS = 5_000
const POLL_MAX_MS = 20_000

/** The screens' shape of a list of sessions: by site, the sites with results, and every session oldest first (the same objects). */
function build(views: SessionView[]) {
  const bySite = groupBySite(views)
  const all = Object.values(bySite)
    .flatMap((s) => s.sessions)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  return { bySite, sites: sitesWithResults(bySite), all }
}

/** Same sessions with the same content (a re-read that changed nothing keeps every screen as it is). */
function sameViews(a: SessionView[], b: SessionView[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b)
}

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
  // Nothing is read for the account until a screen that shows it mounts (useActivateData); then it stays on.
  const [active, setActive] = useState(false)
  const activate = useCallback(() => setActive(true), [])
  const uidRef = useRef(uid)
  const viewsRef = useRef<SessionView[]>([])
  useEffect(() => {
    uidRef.current = uid
    viewsRef.current = owned.uid === uid ? owned.views : []
  })
  // Every upsert bumps seq and stamps its session: a list read that started before the stamp keeps the upserted
  // copy (a finished check-in is never flipped back to "processing" by an older list).
  const seq = useRef(0)
  const touched = useRef(new Map<string, number>())
  // When the list last answered (even with nothing new), for the stale-photo re-read below.
  const loadedAt = useRef(0)

  const load = useCallback(async (forUid: string) => {
    const at = seq.current
    try {
      const res = await api.listSessions(await getIdToken())
      return { uid: forUid, at, status: 'ready' as const, sessions: res.sessions }
    } catch {
      return { uid: forUid, at, status: 'error' as const, sessions: null }
    }
  }, [getIdToken])

  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    // An answer for someone who is no longer signed in here is never shown.
    if (r.uid !== uidRef.current) return
    if (r.status === 'ready') loadedAt.current = Date.now()
    const list = r.sessions
    if (list)
      setOwned((o) => {
        if (o.uid !== r.uid) return { uid: r.uid, views: list }
        const newer = o.views.filter((v) => (touched.current.get(v.session.id) ?? -1) > r.at)
        const ids = new Set(newer.map((v) => v.session.id))
        const views = [...list.filter((v) => !ids.has(v.session.id)), ...newer]
        return sameViews(o.views, views) ? o : { uid: r.uid, views }
      })
    setLoaded((l) => (l.uid === r.uid && l.status === r.status ? l : { uid: r.uid, status: r.status }))
  }, [])

  // One list read at a time. A refresh asked for while one is on its way reads once more after it (coalesced),
  // so the caller still gets an answer from after its own change.
  const flight = useRef<{ uid: string; p: Promise<void>; again: boolean } | null>(null)
  const fetchList = useCallback(
    (forUid: string, fresh: boolean): Promise<void> => {
      const f = flight.current
      if (f && f.uid === forUid) {
        if (fresh) f.again = true
        return f.p
      }
      const mine = { uid: forUid, p: Promise.resolve(), again: false }
      mine.p = (async () => {
        try {
          do {
            mine.again = false
            apply(await load(forUid))
          } while (mine.again && uidRef.current === forUid)
        } finally {
          if (flight.current === mine) flight.current = null
        }
      })()
      flight.current = mine
      return mine.p
    },
    [load, apply],
  )

  const refresh = useCallback(async () => {
    if (demo || !uid) return
    await fetchList(uid, true)
  }, [demo, uid, fetchList])

  // Consent given on this device belongs to the account once someone is signed in.
  useEffect(() => {
    if (!active || demo || !uid) return
    syncConsent(uid, getIdToken).catch(() => undefined)
  }, [active, demo, uid, getIdToken])

  // Until this uid's first answer arrives, status derives as loading (see value below).
  useEffect(() => {
    if (!active || demo || !uid) return
    void fetchList(uid, false)
  }, [active, demo, uid, fetchList])

  // Photo previews are signed URLs the api reissues with at least 2 h left (api/app/storage.py). A tab left
  // open longer than an hour reads the sessions again when it is looked at, so photos never go stale.
  useEffect(() => {
    if (!active || demo || !uid) return
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
  }, [active, demo, uid, refresh])

  // Demo mode reads the team's journey once per entry and holds it until demo mode is left.
  const [demoPick, setDemoPick] = useState<DemoPick | null>(() => (demo ? peekDemo() : null))
  const [pickedFor, setPickedFor] = useState(demo)
  if (pickedFor !== demo) {
    setPickedFor(demo)
    setDemoPick(demo ? peekDemo() : null)
  }
  useEffect(() => {
    if (!active || !demo) return
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
  }, [active, demo])
  // "Try again" in demo mode: a journey that could not be read is asked for again (a held one is kept).
  const demoRef = useRef(demo)
  useEffect(() => {
    demoRef.current = demo
  })
  const refreshDemo = useCallback(async () => {
    const p = await pickDemo()
    if (!demoRef.current) return
    holdDemo(p)
    setDemoPick(p)
  }, [])

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
    if (!active || demo || !uid) return
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
  }, [active, demo, uid, getIdToken, displayName])

  const upsert = useCallback(
    (view: SessionView) => {
      seq.current += 1
      touched.current.set(view.session.id, seq.current)
      setOwned((o) => (o.uid === uid ? { uid, views: [...o.views.filter((v) => v.session.id !== view.session.id), view] } : { uid, views: [view] }))
    },
    [uid],
  )

  // Sessions still uploading or measuring (not stalled) are read one by one until they finish, backing off
  // 5 s -> 10 s -> 20 s; one the check-in already reads closely is skipped (watchSession).
  const pollIds = useMemo(
    () =>
      owned.uid === uid
        ? owned.views
            .filter((v) => inFlight(v.session) && !stalled(v.session))
            .map((v) => v.session.id)
            .sort()
            .join(' ')
        : '',
    [owned, uid],
  )
  useEffect(() => {
    if (!active || demo || !uid || !pollIds) return
    let alive = true
    const timers = new Set<number>()
    const poll = (id: string, delay: number) => {
      const t = window.setTimeout(async () => {
        timers.delete(t)
        if (!alive) return
        const was = viewsRef.current.find((x) => x.session.id === id)
        if (!was || !inFlight(was.session)) return
        // Past the stall cutoff: one last read (so the screens show it stopped), then no more.
        const last = stalled(was.session)
        if (document.visibilityState === 'visible' && !isWatched(id)) {
          try {
            const v = await api.getSession(await getIdToken(), id)
            if (!alive) return
            // Finished (or given up on): into the cache, which ends this session's poll.
            if (!inFlight(v.session) || stalled(v.session)) return void upsert(v)
            // Still going: only a new status or stage is worth a redraw.
            if (was.session.status !== v.session.status || was.session.stage !== v.session.stage) upsert(v)
          } catch {
            /* a missed reading: the next one catches up */
          }
        }
        if (alive && !last) poll(id, Math.min(delay * 2, POLL_MAX_MS))
      }, delay)
      timers.add(t)
    }
    for (const id of pollIds.split(' ')) poll(id, POLL_FIRST_MS)
    return () => {
      alive = false
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [active, demo, uid, pollIds, getIdToken, upsert])

  // Sessions are turned into the screens' shape only when they change (not on every profile or goal change).
  const demoBuilt = useMemo(() => (demoPick?.source === 'real' ? build(demoPick.views) : null), [demoPick])
  const liveBuilt = useMemo(() => build(owned.uid === uid ? owned.views : []), [owned, uid])

  const value = useMemo<DataState>(() => {
    if (demo) {
      const goals = goalsDemo
      const empty = { mode: 'demo' as const, sites: [], series: () => null, all: [], goals, setGoals, profile, saveProfile, refresh: refreshDemo, upsert: () => {} }
      if (!demoPick) return { ...empty, status: 'loading' }
      if (!demoBuilt) return { ...empty, status: 'error' }
      const { bySite, sites, all } = demoBuilt
      return { mode: 'demo', status: 'ready', sites, series: (site) => bySite[site] ?? null, all, goals, setGoals, profile, saveProfile, refresh: refreshDemo, upsert: () => {} }
    }
    const status: DataStatus = !uid ? 'idle' : loaded.uid === uid ? loaded.status : 'loading'
    const { bySite, sites, all } = liveBuilt
    return { mode: 'live', status, sites, series: (site) => bySite[site] ?? null, all, goals: profile.goals, setGoals, profile, saveProfile, refresh, upsert }
  }, [demo, demoPick, demoBuilt, liveBuilt, uid, loaded, refresh, refreshDemo, upsert, profile, goalsDemo, setGoals, saveProfile])

  return (
    <DataActivateContext.Provider value={activate}>
      <DataContext.Provider value={value}>{children}</DataContext.Provider>
    </DataActivateContext.Provider>
  )
}
