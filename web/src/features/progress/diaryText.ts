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
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

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
  if (t.status === 'gone') return v.at_most !== null ? `Faded · visible between ${v.at_least} and ${nd(v.at_most)}` : `Faded · visible at least ${nd(v.at_least)}`
  return `${STATUS_SHAPE[t.status].word} · visible at least ${nd(v.at_least)}${t.there_from_start ? ', there from the first photo' : ''}`
}

/** Tag on the photo: "New" on its first sighting, else "Here since day N". */
export function tagText(t: SpotTrack, sessionIndex: number): string {
  return sessionIndex === t.first_seen_index ? 'New' : `Here since day ${t.first_seen_index + 1}${t.status === 'fading' ? ' · fading' : ''}`
}
