/**
 * How far a product is through its usual trial window ("Is it working?" → Too early): week N of M, the share of
 * the window gone, and where the first look falls on it. Pure, so it is unit-tested (tests/trialWindow.test.ts).
 */
const WEEK = 7 * 86_400_000

export type TrialWindow = { week: number; weeks: number; done: number; look: number | null }

export function trialWindow(start: string | Date, due: Date, firstLook: Date | null, now = Date.now()): TrialWindow | null {
  const s = new Date(start).getTime()
  const span = due.getTime() - s
  if (!(span > 0)) return null
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  const weeks = Math.max(1, Math.round(span / WEEK))
  // Week 1 is the first seven days; a product not started yet sits at week 0.
  const week = now < s ? 0 : Math.min(weeks, Math.floor((now - s) / WEEK) + 1)
  const look = firstLook ? clamp((firstLook.getTime() - s) / span) : null
  return { week, weeks, done: clamp((now - s) / span), look: look !== null && look > 0 && look < 1 ? look : null }
}
