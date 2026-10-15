import { useCallback } from 'react'
import { toast } from 'sonner'

import { refreshRoutine, useOwner, useRoutine, useRoutineLog } from '../../data/hooks'
import type { RoutineEntry } from '../../data/types'
import { ApiError, api, localDay, type NewRoutineEntry } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { useAuth } from '../../lib/useAuth'
import { entryName, slotWords } from './routineModel'

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

  return { add, stop, remove, setSlots }
}

/** Honest words for a failed write or read. */
export function failureText(e: unknown, fallback: string): string {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return "You're offline. Nothing was saved; try again when you're connected."
  if (e instanceof ApiError && e.status === 429) return e.message
  return fallback
}
