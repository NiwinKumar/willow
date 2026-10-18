/** Places to track: what every check-in covers (type-only imports, so `npm test` can load it). */
import type { TrackPlace } from './api'

export type { TrackPlace }

/**
 * Places to track (users/{uid}.profile.track): chosen once in onboarding, every check-in covers them all.
 * Close-ups first (back camera), then the face (front camera), then the forearms (a product test).
 */
export const TRACK_ORDER: TrackPlace[] = ['cheek_macro', 'nose_macro', 'face_full', 'forearm_treated', 'forearm_control']

/** The choices as onboarding and You show them: the forearms are one choice and two places. */
export type TrackChoice = 'cheek' | 'nose' | 'face' | 'arms'
export const CHOICE_SITES: Record<TrackChoice, TrackPlace[]> = {
  cheek: ['cheek_macro'],
  nose: ['nose_macro'],
  face: ['face_full'],
  arms: ['forearm_treated', 'forearm_control'],
}
export const TRACK_CHOICES: TrackChoice[] = ['cheek', 'face', 'nose', 'arms']

/** What each choice measures, in the person's words (engine pipelines; same facts as model SITE_MEASURES). */
export const CHOICE_COPY: Record<TrackChoice, { title: string; line: string; tag?: string }> = {
  cheek: { title: 'Cheek close-up', line: 'Pores, texture, tone, spots and redness, up close.', tag: 'Recommended' },
  face: { title: 'Face photo', line: 'Lines, under-eye, shine and glow across your face.' },
  nose: { title: 'Nose close-up', line: 'Pores and blemishes, up close.' },
  arms: { title: 'Forearms', line: 'For testing a product: one arm with it, one without.' },
}

/** Goals the face photo alone measures (lines, under-eye, shine and glow): they put the face on by default. */
const FACE_GOALS = ['lines', 'under_eye', 'oil_glow']

/** Before anyone chooses: the cheek close-up (Willow's detail), plus the face when a goal is only seen there. */
export function defaultTrack(goals: string[]): TrackPlace[] {
  return goals.some((g) => FACE_GOALS.includes(g)) ? ['cheek_macro', 'face_full'] : ['cheek_macro']
}

/** Clean a saved list: known places only, in capture order, at least one. */
export function cleanTrack(raw: unknown, goals: string[] = []): TrackPlace[] {
  const list = Array.isArray(raw) ? raw.filter((x): x is TrackPlace => TRACK_ORDER.includes(x as TrackPlace)) : []
  const ordered = TRACK_ORDER.filter((p) => list.includes(p))
  return ordered.length ? ordered : defaultTrack(goals)
}

export const choicesOf = (track: TrackPlace[]): TrackChoice[] => TRACK_CHOICES.filter((c) => CHOICE_SITES[c].every((s) => track.includes(s)))
export const trackOf = (choices: TrackChoice[]): TrackPlace[] => TRACK_ORDER.filter((p) => choices.some((c) => CHOICE_SITES[c].includes(p)))

/** About how long a check-in takes, rounded up to whole minutes (a close-up place ~40 s, the face ~30 s, each arm ~45 s). */
export function minutesFor(track: TrackPlace[]): number {
  const sec = track.reduce((t, p) => t + (p === 'face_full' ? 30 : p.startsWith('forearm') ? 45 : 40), 0)
  return Math.max(1, Math.ceil(sec / 60))
}

/** ?places= in the check-in URL: the places left, in order. */
export const parsePlaces = (raw: string | null): TrackPlace[] => (raw ? TRACK_ORDER.filter((p) => raw.split(',').includes(p)) : [])
