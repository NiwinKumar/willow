import { useCallback } from 'react'
import { toast } from 'sonner'

import { refreshRoutine, useOwner, useRoutine, useRoutineLog } from '../../data/hooks'
import type { FeelTag, FeelVerdict, RoutineEntry, RoutineSchedule } from '../../data/types'
import { ApiError, api, localDay, type NewRoutineEntry } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { getQueryData, setQueryData } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import { weekOf } from './feel'
import { entryName, slotWords } from './routineModel'
import { alternatePair, scheduleWords } from './schedule'

/**
 * Every routine write, each followed by refreshRoutine(uid) so Home, Routine, the check and the advisor's
 * context all read the new routine. Errors reach the caller (inline states) or a toast (one-tap actions).
 */
export function useRoutineWrites() {
  const uid = useOwner()
  const { getIdToken } = useAuth()
  const { refetch: refetchRoutine } = useRoutine()
  const { refetch: refetchLog } = useRoutineLog()
  // refreshRoutine starts the refetch; writes wait for it so the next screen shows the new routine.
  const refresh = useCallback(() => {
    refreshRoutine(uid)
    return Promise.all([refetchRoutine(), refetchLog()])
  }, [uid, refetchRoutine, refetchLog])

  const add = useCallback(
    async (entry: NewRoutineEntry) => {
      const saved = await api.addRoutine(await getIdToken(), entry)
      await refresh()
      toast(`Added to ${slotWords(saved.slots)} · from ${fmtDate(saved.started_at)}`)
      return saved
    },
    [getIdToken, refresh],
  )

  /** Stop using: reversible (ended_at back to null), so the ✕ acts at once and offers Undo. */
  const stop = useCallback(
    async (e: RoutineEntry) => {
      try {
        await api.patchRoutine(await getIdToken(), e.id, { ended_at: localDay() })
      } catch {
        toast(`Couldn't update ${entryName(e)}. Nothing changed; try again.`)
        return
      }
      await refresh()
      toast(`Stopped ${entryName(e)}. It stays under "Stopped" with its dates.`, {
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await api.patchRoutine(await getIdToken(), e.id, { ended_at: null })
              await refresh()
            } catch {
              toast(`Couldn't undo. ${entryName(e)} is still marked as stopped.`)
            }
          },
        },
      })
    },
    [getIdToken, refresh],
  )

  /** Added by mistake: a DELETE, which also deletes that product's ticks. Not undoable, so the UI confirms first. */
  const remove = useCallback(
    async (e: RoutineEntry) => {
      await api.deleteRoutine(await getIdToken(), e.id)
      await refresh()
      toast(`Removed ${entryName(e)} from your routine.`)
    },
    [getIdToken, refresh],
  )

  const setSlots = useCallback(
    async (e: RoutineEntry, slots: ('am' | 'pm')[]) => {
      await api.patchRoutine(await getIdToken(), e.id, { slots })
      await refresh()
      toast(`${entryName(e)}: ${slotWords(slots).toLowerCase()}`)
    },
    [getIdToken, refresh],
  )

  /** Every day (null), every other day from an anchor, or chosen weekdays. */
  const setSchedule = useCallback(
    async (e: RoutineEntry, schedule: RoutineSchedule | null) => {
      await api.patchRoutine(await getIdToken(), e.id, { schedule })
      await refresh()
      toast(`${entryName(e)}: ${scheduleWords(schedule, !e.slots.includes('am')).toLowerCase()}`)
    },
    [getIdToken, refresh],
  )

  /** The routine check's "Alternate nights" fix: `tonight` is used today, `rests` tomorrow, then they swap. */
  const alternate = useCallback(
    async (tonight: RoutineEntry, rests: RoutineEntry) => {
      const pair = alternatePair(localDay())
      const token = await getIdToken()
      await api.patchRoutine(token, tonight.id, { schedule: pair.tonight })
      try {
        await api.patchRoutine(token, rests.id, { schedule: pair.rests })
      } catch (e) {
        // Never leave one of the two alternating alone: put the first back as it was.
        await api.patchRoutine(token, tonight.id, { schedule: tonight.schedule ?? null }).catch(() => undefined)
        throw e
      }
      await refresh()
      toast(`${entryName(tonight)} and ${entryName(rests)} now alternate nights. ${entryName(tonight)} is tonight.`)
    },
    [getIdToken, refresh],
  )

  /**
   * How it feels (the person's own verdict and tags). Optimistic: the routine shows the answer at once, the
   * api's entry replaces it, and a failure puts the old routine back and reaches the caller.
   */
  const setFeel = useCallback(
    async (e: RoutineEntry, verdict: FeelVerdict, tags: FeelTag[]) => {
      const key = ['routine', uid]
      const prev = getQueryData<RoutineEntry[]>(key)
      const swap = (next: (x: RoutineEntry) => RoutineEntry) => (list: RoutineEntry[] | undefined) => (list ?? []).map((x) => (x.id === e.id ? next(x) : x))
      setQueryData<RoutineEntry[]>(key, swap((x) => ({ ...x, feel: { verdict, tags, week: weekOf(x.started_at, localDay()), at: new Date().toISOString() } })))
      let saved: RoutineEntry
      try {
        saved = await api.putFeel(await getIdToken(), e.id, { verdict, tags })
      } catch (err) {
        if (prev) setQueryData<RoutineEntry[]>(key, prev)
        throw err
      }
      setQueryData<RoutineEntry[]>(key, swap((x) => ({ ...x, feel: saved.feel ?? null, feel_history: saved.feel_history ?? [], updated_at: saved.updated_at ?? x.updated_at })))
      await refresh()
      return saved
    },
    [uid, getIdToken, refresh],
  )

  return { add, stop, remove, setSlots, setSchedule, alternate, setFeel }
}

/** Honest words for a failed write or read. */
export function failureText(e: unknown, fallback: string): string {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return "You're offline. Nothing was saved; try again when you're connected."
  if (e instanceof ApiError && e.status === 429) return e.message
  return fallback
}
