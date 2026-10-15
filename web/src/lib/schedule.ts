/**
 * The check-in schedule a person chose (users/{uid}.profile.checkin, set in You) and what it means today:
 * due, late, done, or the next day. Pure functions on the device's own calendar days, so they agree with
 * localDay() everywhere else. The api works out the same thing in the schedule's time zone for push
 * reminders (api/app/reminders.py).
 */

/** days: 0 = Monday … 6 = Sunday; time: 'HH:MM'; tz: IANA name. */
export type Checkin = { days: number[]; time: string; tz: string }

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** Without a schedule, "back after a gap" is 14 days without a face check-in. */
export const DEFAULT_GAP_DAYS = 14

/** 0 = Monday. */
export const weekdayOf = (d: Date) => (d.getDay() + 6) % 7
const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const dayDiff = (a: Date, b: Date) => Math.round((startOf(b).getTime() - startOf(a).getTime()) / 86_400_000)

/** The schedule from GET /v1/me (`{profile: {checkin}}`), or null when none is set or it can't be read. */
export function checkinOf(me: unknown): Checkin | null {
  const c = (me as { profile?: { checkin?: Partial<Checkin> | null } | null } | null | undefined)?.profile?.checkin
  if (!c || !Array.isArray(c.days) || typeof c.time !== 'string' || !/^\d{1,2}:\d{2}$/.test(c.time)) return null
  const days = [...new Set(c.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
  return days.length ? { days, time: c.time, tz: typeof c.tz === 'string' && c.tz ? c.tz : 'UTC' } : null
}

/** The first scheduled day on or after `from` (or strictly after, when `after`). */
export function nextScheduled(c: Checkin, from: Date, after = false): Date {
  const start = startOf(from)
  for (let i = after ? 1 : 0; i <= 7; i++) {
    const d = addDays(start, i)
    if (c.days.includes(weekdayOf(d))) return d
  }
  return start
}

/** The last scheduled day strictly before `from`. */
export function previousScheduled(c: Checkin, from: Date): Date {
  const start = startOf(from)
  for (let i = 1; i <= 7; i++) {
    const d = addDays(start, -i)
    if (c.days.includes(weekdayOf(d))) return d
  }
  return addDays(start, -7)
}

/** The longest stretch between two scheduled days (7 for once a week, 1 for every day). */
export function longestInterval(c: Checkin): number {
  const ds = c.days
  if (ds.length <= 1) return 7
  return Math.max(...ds.map((d, i) => (ds[(i + 1) % ds.length] - d + 7) % 7 || 7))
}

/** "Back after a gap": twice the longest scheduled interval, else 14 days. */
export const gapDaysFor = (c: Checkin | null) => (c ? 2 * longestInterval(c) : DEFAULT_GAP_DAYS)

/** The weekly summary's day: the schedule's first day (Monday first). */
export const weeklyDayOf = (c: Checkin | null): number | null => (c ? c.days[0] : null)

/** Close-ups (texture goal) alternate with the face: one on the last scheduled day of the week. */
export const closeUpDayOf = (c: Checkin): number => c.days[c.days.length - 1]

/** "Sat 17 Oct". */
export const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** "Mon, Wed and Fri at 08:30", "Every day at 08:30". */
export function scheduleText(c: Checkin): string {
  if (c.days.length === 7) return `Every day at ${c.time}`
  const names = c.days.map((d) => (c.days.length === 1 ? WEEKDAY_LONG[d] : WEEKDAY_SHORT[d]))
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${list} at ${c.time}`
}

export type DueKind = 'due' | 'late' | 'done' | 'upcoming'
export type Due = {
  kind: DueKind
  /** Home's line: "Check-in due today", "2 days late", "Next check-in Sat 17 Oct". */
  label: string
  /** For the shell's check-in button ("due today", "2 days late"); null when nothing is due. */
  short: string | null
  lateDays: number
  /** The next scheduled day (today when due). */
  next: Date
}

const late = (n: number) => `${n} day${n === 1 ? '' : 's'} late`

/**
 * Where the person stands against their schedule. `checkIns` are the dates of check-ins that count (face,
 * not failed), any order. Late = a scheduled day passed with no check-in on or after it; on a scheduled
 * day the check-in is simply due today.
 */
export function dueOf(c: Checkin, checkIns: Date[], now: Date = new Date()): Due {
  const today = startOf(now)
  const todays = checkIns.some((d) => dayDiff(d, today) === 0)
  if (todays) {
    const next = nextScheduled(c, today, true)
    return { kind: 'done', label: `Next check-in ${fmtDay(next)}`, short: null, lateDays: 0, next }
  }
  const latest = checkIns.reduce<Date | null>((a, d) => (!a || d > a ? d : a), null)
  // Scheduled today, or back after a gap (Home's "Welcome back"): no counting of missed days, just today.
  const away = latest !== null && dayDiff(latest, today) >= gapDaysFor(c)
  if (c.days.includes(weekdayOf(today)) || away) return { kind: 'due', label: 'Check-in due today', short: 'due today', lateDays: 0, next: today }
  const missed = previousScheduled(c, today)
  const next = nextScheduled(c, today)
  if (latest && dayDiff(latest, missed) > 0) {
    const n = dayDiff(missed, today)
    return { kind: 'late', label: `Check-in ${late(n)}`, short: late(n), lateDays: n, next }
  }
  return { kind: 'upcoming', label: `Next check-in ${fmtDay(next)}`, short: null, lateDays: 0, next }
}

/**
 * The lead card's place chips: "Face · due" / "Face · Sat", and with the texture goal "Cheek close-up · Sat"
 * (due on the schedule's last day of the week) unless one was taken today.
 */
export function dueChips(c: Checkin, due: Due, closeUp: { wanted: boolean; doneToday: boolean }, now: Date = new Date()): string[] {
  const chips = [due.kind === 'due' || due.kind === 'late' ? 'Face · due' : due.kind === 'done' ? 'Face' : `Face · ${WEEKDAY_SHORT[weekdayOf(due.next)]}`]
  if (closeUp.wanted && !closeUp.doneToday) {
    const day = closeUpDayOf(c)
    chips.push(`Cheek close-up · ${weekdayOf(now) === day ? 'due' : WEEKDAY_SHORT[day]}`)
  }
  return chips
}

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`

/**
 * The calendar event built on this device, used when the api's file can't be fetched: the same weekly
 * event, in floating local time (whatever time zone the calendar is in), with an alert at the time.
 */
export function icsFor(c: Checkin, appUrl: string, now: Date = new Date()): string {
  const [hh, mm] = c.time.split(':').map(Number)
  const start = nextScheduled(c, now)
  const url = `${appUrl.replace(/\/$/, '')}/home`
  const utc = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Willow//Check-in reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:checkin-${Date.now().toString(36)}@willow`,
    `DTSTAMP:${utc}`,
    `DTSTART:${stamp(start)}T${pad(hh)}${pad(mm)}00`,
    'DURATION:PT10M',
    `RRULE:FREQ=WEEKLY;BYDAY=${c.days.map((d) => BYDAY[d]).join(',')}`,
    'SUMMARY:Willow check-in',
    `DESCRIPTION:Face photos by the same window light as last time. Open Willow: ${url}`.replace(/,/g, '\\,'),
    `URL:${url}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Willow check-in',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}

/** RFC 5545: lines over 75 octets continue after CRLF + space (all ASCII here). */
function fold(line: string): string {
  if (line.length <= 75) return line
  const parts = [line.slice(0, 75)]
  for (let i = 75; i < line.length; i += 74) parts.push(line.slice(i, i + 74))
  return parts.join('\r\n ')
}
