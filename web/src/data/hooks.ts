/**
 * Shared reads for the app's screens. Sessions come from the DataProvider (useData); everything else the
 * signed-in person owns is read here through the shared cache (lib/query.ts), so Home, Routine and the
 * advisor never ask twice or disagree. Demo mode has no routine, log, spots or account: these stay idle.
 */
import { useCallback } from 'react'

import { api, localDay } from '../lib/api'
import { clearQueries, getQueryData, invalidate, setQueryData, useQuery } from '../lib/query'
import { useAuth } from '../lib/useAuth'
import type { RoutineCheck, RoutineEntry, RoutineLogDay } from './types'
import { useData } from './useData'

/** The signed-in person's uid when their own data can be read (live mode, signed in), else null. */
export function useOwner(): string | null {
  const { user } = useAuth()
  const data = useData()
  return data.mode === 'live' && user ? user.uid : null
}

export function useRoutine() {
  const uid = useOwner()
  return useQuery(['routine', uid], (t) => api.routine(t).then((r) => r.entries), { enabled: Boolean(uid) })
}

/** Products in use today, for a slot. "Stop using" sets ended_at to today, so a product stopped today is gone. */
export function activeIn(entries: RoutineEntry[] | undefined, slot: 'am' | 'pm'): RoutineEntry[] {
  const today = localDay()
  return (entries ?? []).filter((e) => e.slots.includes(slot) && (!e.ended_at || e.ended_at.slice(0, 10) > today) && e.started_at.slice(0, 10) <= today)
}

/** Routine ticks for a range of the person's own days (default: today only). */
export function useRoutineLog(from: string = localDay(), to: string = from) {
  const uid = useOwner()
  return useQuery(['routine-log', uid, from, to], (t) => api.routineLog(t, { from, to }).then((r) => r.days), { enabled: Boolean(uid) })
}

/** Tick or untick one product for a day and slot. Optimistic; the api's answer for that day wins. */
export function useSetRoutineUse() {
  const uid = useOwner()
  const { getIdToken } = useAuth()
  return useCallback(
    async (day: string, entryId: string, slot: 'am' | 'pm', used: boolean) => {
      const key = ['routine-log', uid, day, day]
      const prev = getQueryData<RoutineLogDay[]>(key)
      const patch = (days: RoutineLogDay[] | undefined): RoutineLogDay[] => {
        const d = days?.find((x) => x.date === day) ?? { date: day, used: {} }
        const slots = new Set(d.used[entryId] ?? [])
        if (used) slots.add(slot)
        else slots.delete(slot)
        const next = { date: day, used: { ...d.used, [entryId]: (['am', 'pm'] as const).filter((s) => slots.has(s)) } }
        if (!next.used[entryId].length) delete next.used[entryId]
        return [...(days ?? []).filter((x) => x.date !== day), next]
      }
      setQueryData<RoutineLogDay[]>(key, patch)
      try {
        const answer = await api.setRoutineUse(await getIdToken(), day, entryId, slot, used)
        setQueryData<RoutineLogDay[]>(key, (days) => [...(days ?? []).filter((x) => x.date !== day), answer])
        // recent use ("used on N of 14 days") changes with every tick
        invalidate(['routine', uid])
        invalidate(['routine-log', uid])
      } catch (e) {
        setQueryData<RoutineLogDay[]>(key, prev ?? [])
        throw e
      }
    },
    [uid, getIdToken],
  )
}

/**
 * The routine check (conflicts, duplicates, gaps). It counts against a daily cap, so it is keyed by the
 * routine itself: one check per routine version, shared by Home and Routine.
 */
export function useRoutineCheck(entries: RoutineEntry[] | undefined) {
  const uid = useOwner()
  const version = (entries ?? [])
    .filter((e) => !e.ended_at)
    .map((e) => `${e.id}:${e.slots.join('')}${e.schedule && e.schedule.kind !== 'daily' ? `:${e.schedule.kind}:${e.schedule.anchor}:${(e.schedule.days ?? []).join('')}` : ''}`)
    .sort()
    .join(',')
  // Kept for this tab too, so a reload doesn't spend another check on the same routine (cleared on sign-out).
  const saved = `willow.check.${uid}.${version}`
  const query = useQuery(
    ['routine-check', uid, version],
    async (t) => {
      try {
        const hit = sessionStorage.getItem(saved)
        if (hit) return JSON.parse(hit) as RoutineCheck
      } catch {
        /* private mode */
      }
      const check = await api.routineCheck(t)
      try {
        sessionStorage.setItem(saved, JSON.stringify(check))
      } catch {
        /* private mode or full */
      }
      return check
    },
    { enabled: Boolean(uid) && entries !== undefined && version.length > 0, staleMs: Infinity },
  )
  const { refetch } = query
  /** "Run again": a fresh check, not the one kept for this tab. */
  const rerun = useCallback(() => {
    try {
      sessionStorage.removeItem(saved)
    } catch {
      /* private mode */
    }
    return refetch()
  }, [saved, refetch])
  return { ...query, rerun }
}

export function useSpots() {
  const uid = useOwner()
  // signed crop URLs last about an hour
  return useQuery(['spots', uid], (t) => api.spots(t), { enabled: Boolean(uid), staleMs: 10 * 60_000 })
}

/** The account as the api knows it (consent on record). */
export function useMe() {
  const uid = useOwner()
  return useQuery(['me', uid], (t) => api.me(t), { enabled: Boolean(uid), staleMs: 5 * 60_000 })
}

/** After a routine write: refresh the routine, its check and recent use. */
export function refreshRoutine(uid: string | null) {
  invalidate(['routine', uid])
  invalidate(['routine-log', uid])
}

export { clearQueries }
