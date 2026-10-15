/**
 * Topping up a baseline (/check-in?topup=<session id>): a baseline with fewer than 3 usable photos has
 * no normal range; the person adds the missing photos to that same session and it is measured again
 * (api POST /v1/sessions/{id}/frames, then analyze; the baseline is rebuilt from every photo).
 */
import type { Session } from '../../data/types'
import { ApiError, api, type SessionView } from '../../lib/api'
import { daysSince } from '../home/derive'

/** A normal range needs this many usable photos (api baselines.NOISE_BAND_FRAMES). */
export const BAND = 3
/** Photos are deleted 30 days after upload (bucket lifecycle): after that a session can't be measured again. */
export const KEEP_DAYS = 29

export type TopUpPlan =
  | { kind: 'add'; need: number; view: SessionView }
  | { kind: 'measure' }
  | { kind: 'watch' }
  | { kind: 'refuse'; why: string }

/** Usable photos of a measured baseline (what Home's "N usable photos" counts). */
export function usableFrames(s: Pick<Session, 'result' | 'n_frames'>): number {
  return s.result?.quality.passed ? s.result.frames_used : 0
}

/** Whether Home can offer "Add N photos" for this baseline, and how many. */
export function topUpNeed(s: Session | null): number {
  // uploading or failed: a top-up left part-way (the check-in picks it up where it stopped)
  if (!s || !s.live || s.sample_id || s.status === 'processing' || !s.is_baseline) return 0
  if (daysSince(s.created_at) >= KEEP_DAYS) return 0
  return Math.max(0, BAND - usableFrames(s))
}

/**
 * Delete frames of this session that never reached the bucket (an earlier top-up left unfinished), from
 * the last one up, so the rest can be measured. `stored`: photos in the bucket; `frames`: the session's
 * frame count afterwards. A measured session is never pruned (the api only removes frames before analyze;
 * its missing originals are refused by POST …/frames instead).
 */
export async function pruneMissing(token: string, id: string): Promise<{ stored: number; frames: number }> {
  const { objects } = await api.sessionObjects(token, id)
  const missing = objects.filter((o) => !o.exists || !o.size).map((o) => o.index)
  const stored = objects.length - missing.length
  let frames = objects.length
  if (!stored) return { stored, frames } // never delete the last photo (the api refuses it anyway)
  for (const i of missing.sort((a, b) => b - a)) {
    try {
      await api.deleteFrame(token, id, i)
      frames -= 1
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) break
      throw e
    }
  }
  return { stored, frames }
}

/** What a top-up of this session needs right now (it may be half-done from an earlier visit). */
export async function planTopUp(token: string, id: string): Promise<TopUpPlan> {
  const view = await api.getSession(token, id)
  const s = view.session
  if (s.sample_id) return { kind: 'refuse', why: 'Sample photos can’t be added to.' }
  if (s.status === 'processing') return { kind: 'watch' }
  if (daysSince(s.created_at) >= KEEP_DAYS) return { kind: 'refuse', why: 'The original photos of this check-in were deleted after 30 days, so it can’t take more photos. Take a new check-in with 3 or more photos and make it your baseline.' }
  if (s.status === 'done') {
    const need = BAND - (view.result?.quality.passed ? view.result.frames_used : 0)
    if (need <= 0) return { kind: 'refuse', why: 'This baseline already has a normal range.' }
    return { kind: 'add', need, view }
  }
  // uploading or failed: an earlier top-up stopped part-way. Keep what arrived, count it, add the rest.
  const { stored } = await pruneMissing(token, id)
  const need = BAND - stored
  return need > 0 ? { kind: 'add', need, view } : { kind: 'measure' }
}
