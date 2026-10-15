/**
 * The person's check-in schedule (GET /v1/me profile.checkin) and where they stand against it today,
 * shared by Home, the shell's check-in button and You. Demo mode and guests without a schedule get null.
 */
import { useMemo } from 'react'

import { parseDate } from '../lib/format'
import { checkinOf, dueOf, type Checkin, type Due } from '../lib/schedule'
import type { Session } from './types'
import { inFlight, stalled } from './live'
import { useMe } from './hooks'
import { useData } from './useData'

const EMPTY: Session[] = []

/** Check-ins that count for the schedule: finished or still running (not failed, not abandoned). */
export const counts = (s: Session) => s.status === 'done' || (inFlight(s) && !stalled(s))

export function useCheckin(): Checkin | null {
  const me = useMe()
  return useMemo(() => checkinOf(me.data), [me.data])
}

/** Due today, late, done or upcoming; null without a schedule or before the first face check-in. */
export function useCheckinDue(): Due | null {
  const data = useData()
  const checkin = useCheckin()
  const face = data.series('face_full')?.sessions ?? EMPTY
  return useMemo(() => {
    if (data.mode !== 'live' || !checkin) return null
    const days = face.filter(counts).map((s) => parseDate(s.created_at))
    return days.length ? dueOf(checkin, days) : null
  }, [data.mode, checkin, face])
}
