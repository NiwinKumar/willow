import { useMemo, useState } from 'react'

import { counts, useCheckinDue } from '../../data/useCheckin'
import { useData } from '../../data/useData'
import { parseDate } from '../../lib/format'

/**
 * What the shell's Check in button shows (Sidebar, Dock): due (today or late, from the schedule in You),
 * done (a check-in today that counts, schedule or not), or idle. `label` is the words a tooltip and a screen
 * reader get; the button itself shows the state as motion (due) or a tick (done), never a bare dot.
 */
export type CheckInState = { kind: 'due' | 'done' | 'idle'; label: string }

export function useCheckInState(): CheckInState {
  const due = useCheckinDue()
  const data = useData()
  // Today, read once per mount (the shell stays mounted; a check-in tomorrow re-reads on the next visit).
  const [today] = useState(() => new Date().toDateString())
  return useMemo(() => {
    if (data.mode !== 'live') return { kind: 'idle', label: 'Check in' }
    if (due && (due.kind === 'due' || due.kind === 'late')) return { kind: 'due', label: `Check in · ${due.short ?? 'due'}` }
    const todays = data.all.some((s) => !s.sample_id && counts(s) && parseDate(s.created_at).toDateString() === today)
    if (due?.kind === 'done' || todays) return { kind: 'done', label: 'Checked in today · check in again' }
    return { kind: 'idle', label: 'Check in' }
  }, [due, data.mode, data.all, today])
}
