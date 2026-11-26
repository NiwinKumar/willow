/** Spot diary words and shapes (design SH/STG/ZN), shared by the diary and the photo stage. */
import type { SpotDiary as Diary, SpotStatus, SpotTrack, SpotZone } from '../../lib/api'
import { fmtDate } from '../../lib/format'

export const ZONE_NAME: Record<SpotZone, string> = {
  forehead: 'Forehead',
  nose: 'Nose',
  right_cheek: 'Right cheek',
  left_cheek: 'Left cheek',
  around_mouth: 'Around the mouth',
  chin: 'Chin',
  right_jaw: 'Right jawline',
  left_jaw: 'Left jawline',
}
const STAGE_NAME: Record<string, string> = { bump: 'Raised spot', clogged_pore: 'Blackhead or whitehead', mark: 'Mark left behind', red_spot: 'Red spot', dark_spot: 'Dark spot' }
export const STAGE_COLOUR: Record<string, [string, string]> = { bump: ['#F25FA8', '#FBC6E1'], clogged_pore: ['#5E5B56', '#CFCCC6'], mark: ['#C98A5E', '#F1D3BC'], red_spot: ['#FF6B4A', '#FFC7B8'], dark_spot: ['#7A5240', '#D9C2B4'] }

/** Status = shape + words, never colour alone (design SH). */
export const STATUS_SHAPE: Record<SpotStatus, { border: string; bg: string; halo: string; word: string }> = {
  new: { border: '2px solid var(--text-primary)', bg: 'var(--text-primary)', halo: '0 0 0 2.5px var(--bg-surface), 0 0 0 4px var(--text-primary)', word: 'New' },
  still_there: { border: '2px solid var(--text-primary)', bg: 'var(--text-primary)', halo: 'none', word: 'Still there' },
  fading: { border: '2px solid var(--text-primary)', bg: 'linear-gradient(90deg, var(--text-primary) 50%, var(--bg-surface) 50%)', halo: 'none', word: 'Fading' },
  not_seen_last_time: { border: '2px dashed var(--text-primary)', bg: 'rgba(250,250,248,.6)', halo: 'none', word: 'Not seen last time' },
  gone: { border: '1.5px solid rgba(18,18,18,.6)', bg: 'transparent', halo: 'none', word: 'Faded' },
}
export const ORDER: SpotStatus[] = ['new', 'fading', 'still_there', 'gone', 'not_seen_last_time']

const nd = (n: number) => (n === 1 ? '1 day' : `${n} days`)
/** The api's day spans carry one decimal (0.1 = a couple of hours): whole days, or "under a day". */
export const fmtDays = (n: number) => (n < 0.95 ? 'under a day' : nd(Math.round(n)))
/** The timestamp falls on the person's own today (local time). */
export const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

export function stageName(o: { stage: string; label: string | null }): string {
  if (o.stage === 'clogged_pore' && /blackhead|open_comedone/i.test(o.label ?? '')) return 'Blackhead'
  if (o.stage === 'clogged_pore' && /whitehead|closed_comedone/i.test(o.label ?? '')) return 'Whitehead'
  return STAGE_NAME[o.stage] ?? 'Spot'
}

/** "New · first seen today", "Faded · visible between 4 and 8 days", "Still there · visible at least 6 days". */
export function statusText(t: SpotTrack, d: Diary): string {
  const ls = d.sessions[t.last_seen_index]
  if (t.status === 'new') return `New · first seen ${ls && isToday(ls.created_at) ? 'today' : `on ${ls ? fmtDate(ls.created_at) : 'the last photo'}`}`
  const v = t.days_visible
  if (t.status === 'gone') {
    if (v.at_most === null) return `Faded · visible at least ${fmtDays(v.at_least)}`
    const lo = fmtDays(v.at_least)
    const hi = fmtDays(v.at_most)
    return lo === hi ? `Faded · visible about ${hi}` : v.at_least < 0.95 ? `Faded · visible up to ${hi}` : `Faded · visible between ${Math.round(v.at_least)} and ${hi}`
  }
  return `${STATUS_SHAPE[t.status].word} · ${v.at_least < 0.95 ? 'visible for under a day so far' : `visible at least ${fmtDays(v.at_least)}`}${t.there_from_start ? ', there from the first photo' : ''}`
}

/**
 * Tag on the photo: "New" on its first sighting, else "Here since 14 Oct". The date, not "day N": the diary
 * can hold several photos a day, so a photo's place in the list is not a day count.
 */
export function tagText(t: SpotTrack, sessionIndex: number, d: Diary): string {
  if (sessionIndex === t.first_seen_index && !t.there_from_start) return 'New'
  const first = d.sessions[t.first_seen_index]
  const since = t.there_from_start ? 'Here from the first photo' : first ? `Here since ${fmtDate(first.created_at)}` : 'Seen before'
  return `${since}${t.status === 'fading' ? ' · fading' : ''}`
}
