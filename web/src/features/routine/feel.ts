import type { FeelAnswer, FeelTag, FeelVerdict, RoutineEntry } from '../../data/types'
import type { Outcome } from '../../lib/outcome'

/**
 * "How it feels": the person's own verdict on a routine product (api/app/feel.py, same ids and words).
 * Self-reported, so it sits next to the readings and never changes them. Pure, so `npm test` reads it
 * without the app.
 */

export const VERDICTS: { id: FeelVerdict; label: string }[] = [
  { id: 'working', label: "It's working for me" },
  { id: 'unsure', label: 'Too soon to tell' },
  { id: 'not_for_me', label: 'Not for me' },
]
export const VERDICT_LABEL = Object.fromEntries(VERDICTS.map((v) => [v.id, v.label])) as Record<FeelVerdict, string>

/** Look and feel, cosmetic words only; the good ones first. */
export const TAGS: { id: FeelTag; label: string; good: boolean }[] = [
  { id: 'feels_nice', label: 'Nice to use', good: true },
  { id: 'absorbs', label: 'Absorbs well', good: true },
  { id: 'softer', label: 'Skin feels softer', good: true },
  { id: 'looks_better', label: 'Looks better', good: true },
  { id: 'heavy', label: 'Heavy or sticky', good: false },
  { id: 'stings', label: 'Stings or tingles', good: false },
  { id: 'drying', label: 'Dries my skin', good: false },
  { id: 'breakouts', label: 'More breakouts', good: false },
]
export const MAX_TAGS = 4

/** The nudge asks about a product in use this long, again once the last answer is this old. */
export const NUDGE_DAYS = 14
/** A stopped product is asked about once if it was used at least this long and stopped within NUDGE_DAYS. */
export const STOPPED_MIN_DAYS = 7
/** "Not now" hides the nudge this long. */
export const SNOOZE_DAYS = 7

export const PRIVACY_LINE = 'Only you see your answer. Brands only see totals from 10 or more people who share anonymous insights.'

const dayNum = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}
/** Whole calendar days from `a` to `b` (YYYY-MM-DD, or an ISO datetime's date part). */
export const daysBetween = (a: string, b: string) => Math.round(dayNum(b) - dayNum(a))

/** Whole weeks from the start date to `day`, 0 in the first week (as the api counts `week`). */
export function weekOf(startedAt: string, day: string): number {
  return Math.max(0, Math.floor(daysBetween(startedAt, day) / 7))
}

/** Tap a tag: on or off; never more than MAX_TAGS (a fifth tap does nothing). */
export function toggleTag(tags: FeelTag[], tag: FeelTag): FeelTag[] {
  if (tags.includes(tag)) return tags.filter((t) => t !== tag)
  return tags.length >= MAX_TAGS ? tags : [...tags, tag]
}

/** Selected tags in the list's order (good first). */
export const orderTags = (tags: FeelTag[]) => TAGS.filter((t) => tags.includes(t.id)).map((t) => t.id)

/** "You said “Too soon to tell” in week 3." (week 0 reads "in your first week"). */
export function saidLine(answer: Pick<FeelAnswer, 'verdict' | 'week'>): string {
  return `You said “${VERDICT_LABEL[answer.verdict]}” ${answer.week === 0 ? 'in your first week' : `in week ${answer.week}`}.`
}

/**
 * One line setting how it feels next to what the readings did. Never claims the product caused anything;
 * null when there is nothing to compare (the product targets nothing Willow measures, or no photo yet).
 */
export function feelVsReadings(verdict: FeelVerdict, kind: Outcome['kind']): string | null {
  if (kind === 'unmeasured') return null
  if (kind === 'early') return verdict === 'unsure' ? 'Too soon for your readings as well. Keep checking in weekly to see how both settle.' : 'Your readings need more check-ins before they can sit next to how it feels.'
  if (verdict === 'working')
    return kind === 'real' ? 'Your readings changed too, in step with how it feels to you. Timing is an association, not proof of cause.' : 'Readings often trail what you feel. Keep checking in weekly to see if they catch up.'
  if (verdict === 'unsure')
    return kind === 'real' ? 'Your readings show a change even though it feels too soon to tell. Keep checking in to see if it holds.' : 'Your readings are within your normal range too. Most changes take several weeks to show.'
  return kind === 'real' ? 'Your readings show a change, and how it feels to use matters too. The advisor can suggest other ways to use it or alternatives.' : 'Your readings haven’t moved beyond your normal range either.'
}

export type FeelNudge = { entry: RoutineEntry; weeks: number; stopped: boolean }

/**
 * Which product the routine nudge asks about, at most one: in use for NUDGE_DAYS or more with no answer
 * in the last NUDGE_DAYS, or stopped within the last NUDGE_DAYS after STOPPED_MIN_DAYS or more of use and
 * never answered. Oldest start first. `today` is the person's own day (YYYY-MM-DD).
 */
export function feelNudge(entries: RoutineEntry[], today: string): FeelNudge | null {
  const due = entries.filter((e) => {
    if (!e.ended_at) return daysBetween(e.started_at, today) >= NUDGE_DAYS && (!e.feel || daysBetween(e.feel.at, today) >= NUDGE_DAYS)
    const sinceStop = daysBetween(e.ended_at, today)
    return !e.feel && sinceStop >= 0 && sinceStop <= NUDGE_DAYS && daysBetween(e.started_at, e.ended_at) >= STOPPED_MIN_DAYS
  })
  const entry = [...due].sort((a, b) => a.started_at.localeCompare(b.started_at))[0]
  if (!entry) return null
  return { entry, weeks: weekOf(entry.started_at, entry.ended_at ?? today), stopped: Boolean(entry.ended_at) }
}

/** "Quick check: how's Niacinamide 10% after 3 weeks?" (a stopped product: "how was it over 2 weeks?"). */
export function nudgeQuestion(n: Pick<FeelNudge, 'weeks' | 'stopped'>, name: string): string {
  const weeks = `${n.weeks} ${n.weeks === 1 ? 'week' : 'weeks'}`
  return n.stopped ? `Quick check: how was ${name} over ${weeks}?` : `Quick check: how’s ${name} after ${weeks}?`
}

/** "Not now" holds while today is before the stored day (YYYY-MM-DD). */
export const snoozed = (until: string | null, today: string) => Boolean(until && /^\d{4}-\d{2}-\d{2}$/.test(until) && daysBetween(today, until) > 0)
