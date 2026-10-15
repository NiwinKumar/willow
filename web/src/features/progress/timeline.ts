/** "Notes and routine changes": routine starts and stops, the baseline, unusable check-ins, left-out photos, the person's notes. */
import type { RoutineEntry, Session } from '../../data/types'
import { failureReasons, leftOutPhotos } from '../../lib/warnings'
import { REASON_SHORT, dayOf, sessionState, usedFrames } from './model'

export type Note = { day: string; text: string; dot: string; kind: 'routine' | 'baseline' | 'rejected' | 'note' | 'quality' }

export const NOTE_DOT = {
  routine: 'var(--willow-400)',
  baseline: 'var(--signal-baseline)',
  rejected: 'var(--aura-coral)',
  note: 'var(--action-primary)',
  quality: '#C9C6C0',
} as const

export const productName = (e: RoutineEntry) => e.custom_name || [e.brand].filter(Boolean).join(' ') || 'a product'

/** Notes of one session (day detail). */
export function sessionNotes(s: Session): Note[] {
  const day = dayOf(s)
  const out: Note[] = []
  const st = sessionState(s)
  if (st === 'baseline') out.push({ day, kind: 'baseline', dot: NOTE_DOT.baseline, text: `Baseline · ${usedFrames(s)} ${usedFrames(s) === 1 ? 'photo' : 'photos'}` })
  if (st === 'rejected') {
    const reasons = [...new Set(s.result?.quality.reasons ?? [])].map((r) => REASON_SHORT[r] ?? r)
    out.push({ day, kind: 'rejected', dot: NOTE_DOT.rejected, text: `Not usable${reasons.length ? ` · ${reasons.join(', ').toLowerCase()}` : ''}` })
  }
  const left = leftOutPhotos(s.result)
  if (left) out.push({ day, kind: 'quality', dot: NOTE_DOT.quality, text: left })
  if (s.note) out.push({ day, kind: 'note', dot: NOTE_DOT.note, text: `“${s.note}”` })
  return out
}

export function routineNotes(entries: RoutineEntry[]): Note[] {
  return entries.flatMap((e) => [
    { day: e.started_at.slice(0, 10), kind: 'routine' as const, dot: NOTE_DOT.routine, text: `Started ${productName(e)}` },
    ...(e.ended_at ? [{ day: e.ended_at.slice(0, 10), kind: 'routine' as const, dot: NOTE_DOT.quality, text: `Stopped ${productName(e)}` }] : []),
  ])
}

/** Reasons a check-in could not be measured, in full sentences (day detail). */
export const rejectNote = (s: Session) => failureReasons(s.result).join(' ')
