/**
 * Routine schedules (api/app/schedule.py): every day, every other day from an anchor day, or chosen
 * weekdays. All on the person's own calendar days. Used for "TONIGHT" / "RESTS ☾", the routine-today
 * counts (a resting product is never a missed one) and the "Alternate nights" fix.
 */
import type { RoutineEntry, RoutineSchedule } from '../../data/types'
import { localDay } from '../../lib/api'
import { parseDate } from '../../lib/format'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** 0 = Monday .. 6 = Sunday, as the api counts. */
export const weekdayOf = (day: string) => (parseDate(day).getDay() + 6) % 7
const between = (a: string, b: string) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000)

export function addDays(day: string, n: number): string {
  const d = parseDate(day)
  d.setDate(d.getDate() + n)
  return localDay(d)
}

export const isEveryDay = (s: RoutineSchedule | null | undefined) => !s || s.kind === 'daily'

/** Is `day` a use day for this schedule? (No schedule: every day.) */
export function usedOn(s: RoutineSchedule | null | undefined, day: string = localDay()): boolean {
  if (!s || s.kind === 'daily') return true
  if (s.kind === 'alternate') return ((between(s.anchor.slice(0, 10), day) % 2) + 2) % 2 === 0
  return (s.days ?? []).includes(weekdayOf(day))
}

/** Does this product rest today (its schedule skips the day)? */
export const restsOn = (e: Pick<RoutineEntry, 'schedule'>, day: string = localDay()) => !usedOn(e.schedule, day)

/** The design's small note under a product: "TONIGHT" / "TODAY" on a use day of a non-daily schedule, "RESTS ☾" on a rest day. */
export function dayNote(e: Pick<RoutineEntry, 'schedule'>, slot: 'am' | 'pm', day: string = localDay()): string | null {
  if (isEveryDay(e.schedule)) return null
  if (restsOn(e, day)) return 'RESTS ☾'
  return slot === 'pm' ? 'TONIGHT' : 'TODAY'
}

/** "Every day", "Every other night", "Mon, Wed, Fri". `night`: the product is evening-only. */
export function scheduleWords(s: RoutineSchedule | null | undefined, night = true): string {
  if (!s || s.kind === 'daily') return 'Every day'
  if (s.kind === 'alternate') return night ? 'Every other night' : 'Every other day'
  const days = s.days ?? []
  if (days.length === 7) return 'Every day'
  if (days.join() === '0,1,2,3,4') return 'Weekdays'
  return days.map((d) => WEEKDAYS[d]).join(', ')
}

/** Two products on opposite days: `tonight` is used today, `rests` tomorrow, and so on. */
export function alternatePair(day: string = localDay()): { tonight: RoutineSchedule; rests: RoutineSchedule } {
  return { tonight: { kind: 'alternate', anchor: day }, rests: { kind: 'alternate', anchor: addDays(day, 1) } }
}

/** Two alternate products that never share a day (the pair the "Alternate nights" fix made). */
export function alternatesWith(a: Pick<RoutineEntry, 'schedule'>, b: Pick<RoutineEntry, 'schedule'>): boolean {
  if (a.schedule?.kind !== 'alternate' || b.schedule?.kind !== 'alternate') return false
  return Math.abs(between(a.schedule.anchor.slice(0, 10), b.schedule.anchor.slice(0, 10))) % 2 === 1
}
