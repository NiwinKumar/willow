/**
 * Words for the structured parts of a metric's story (api metric_story / story_insights): each area against the same
 * area of the baseline, spots by area, and each routine product since it started. Every status is a glyph and words,
 * never colour alone; a change is "Improved" or, gently, "Moved the other way", never "worse". Pure, so `npm test`
 * reads it without the app.
 */
import type { StoryArea, StoryProduct, StorySpotArea } from '../../lib/api.ts'

export type Status = { glyph: string; text: string; tone: 'good' | 'away' | 'quiet' }

export function areaStatus(a: StoryArea): Status {
  if (a.verdict_vs_baseline === 'real_change') {
    if (a.way === 'improved') return { glyph: '◆', text: 'Improved', tone: 'good' }
    if (a.way === 'other_way') return { glyph: '◇', text: 'Moved the other way', tone: 'away' }
    return { glyph: '◆', text: 'Shifted', tone: 'quiet' }
  }
  if (a.verdict_vs_baseline === 'within_noise') return { glyph: '○', text: 'Within its normal range', tone: 'quiet' }
  if (a.verdict_vs_baseline === 'no_band') return { glyph: '◌', text: "Can't judge yet", tone: 'quiet' }
  return { glyph: '—', text: 'Not in your baseline', tone: 'quiet' }
}

/** "2 new · 3 still there · 1 fading", only the parts that are not zero. */
export function spotLine(r: StorySpotArea): string {
  const parts: [number, string][] = [
    [r.new_this_time, 'new'],
    [r.still_there, 'still there'],
    [r.fading, 'fading'],
    [r.not_seen_this_time, 'not seen this time'],
  ]
  return parts.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`).join(' · ')
}

/** How long marks in an area usually stay visible, as a range (only from 3+ faded marks). */
export function typicalLine(r: StorySpotArea): string | null {
  const t = r.typical_days_visible
  if (!t) return null
  const lo = Math.round(t.at_least)
  const hi = Math.round(t.at_most)
  if (lo < 1) return `Spots here usually stay up to ${hi} days`
  return lo === hi ? `Spots here usually stay about ${lo} days` : `Spots here usually stay ${lo} to ${hi} days`
}

/** "left cheek" -> "Left cheek" (sentence case, as the app writes labels). */
export const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function productStatus(p: StoryProduct): Status | null {
  const s = p.since_start
  if (!s) return null
  switch (s.status) {
    case 'helping':
      return { glyph: '◆', text: 'Improved since you started it', tone: 'good' }
    case 'moving_other_way':
      return { glyph: '◇', text: 'Moved the other way since you started it', tone: 'away' }
    case 'changed':
      return { glyph: '◆', text: 'Shifted since you started it', tone: 'quiet' }
    case 'no_change_yet':
      return { glyph: '○', text: 'No change beyond your normal range yet', tone: 'quiet' }
    case 'too_early':
      return { glyph: '◌', text: 'Too early to tell', tone: 'quiet' }
    default:
      return { glyph: '◌', text: "Can't judge yet", tone: 'quiet' }
  }
}

/** "Week 5 · used 29 of 35 days" */
export function productLine(p: StoryProduct): string {
  const bits: string[] = []
  if (p.since_start) bits.push(p.since_start.weeks === 0 ? 'Started this week' : `Week ${p.since_start.weeks}`)
  if (p.use) bits.push(`used ${p.use.days_used} of ${p.use.of_days} days since last check-in`)
  return bits.join(' · ')
}
