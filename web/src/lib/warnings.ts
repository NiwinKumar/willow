import type { AnalysisResult } from '../data/types'
import { QUALITY_COPY } from './metrics'

const PEN_DOTS = /pen-dot square not found/i
const PEN_DOTS_TEXT =
  'Willow could not find the four pen dots. Mark the corners of a 4 cm square on the forearm, keep all four dots in the frame, and put white paper beside the arm.'

/**
 * The engine's notes, readable: placeholders dropped, one line for every photo missing its pen dots,
 * and "corrected with the white paper" dropped when another note says no white reference was found.
 */
export function readableWarnings(r: AnalysisResult | null | undefined): string[] {
  const raw = (r?.warnings ?? []).filter((w) => !w.startsWith('placeholder:'))
  const noWhite = raw.some((w) => /no white reference found/i.test(w))
  const dots = raw.filter((w) => PEN_DOTS.test(w)).map((w) => w.match(/photo (\d+)/i)?.[1]).filter(Boolean)
  const out = raw.filter((w) => !PEN_DOTS.test(w) && !(noWhite && /white paper only/i.test(w)))
  if (dots.length) out.push(`Pen dots not found in photo ${dots.join(', ')}; ${dots.length === 1 ? 'that photo was' : 'those photos were'} not measured`)
  // The engine says "in some photos" even for a one-photo session.
  const one = (r?.quality.per_frame?.length ?? 0) === 1
  return [...new Set(out)].map((w) => (one ? w.replace(/ in some photos/i, '') : w)).map((w) => w.charAt(0).toUpperCase() + w.slice(1))
}

/** Why a session could not be measured, in plain words; missing pen dots explain "too few frames". */
export function failureReasons(r: AnalysisResult | null | undefined): string[] {
  if (!r) return []
  const reasons = [...new Set(r.quality.reasons)]
  if ((r.warnings ?? []).some((w) => PEN_DOTS.test(w)) && (reasons.includes('too_few_frames') || r.frames_used === 0)) {
    return [PEN_DOTS_TEXT, ...reasons.filter((x) => x !== 'too_few_frames').map((x) => QUALITY_COPY[x]?.text ?? x)]
  }
  return reasons.map((x) => QUALITY_COPY[x]?.text ?? x)
}

const LEFT_OUT: Partial<Record<string, string>> = {
  blurry: 'soft',
  overexposed: 'too bright',
  underexposed: 'too dark',
  pose_out_of_range: 'face turned',
  face_not_found: 'no face found',
  occlusion_suspected: 'skin covered',
  card_not_found: 'no colour card',
  card_delta_e_high: 'card colours off',
}

/**
 * "Photos 1, 2 and 3 were left out (soft, face turned)." when a session passed but some of its
 * photos did not. Photos without a reason (pen dots not found) are covered by readableWarnings.
 */
export function leftOutPhotos(r: AnalysisResult | null | undefined): string | null {
  if (!r?.quality.passed) return null
  const failed = (r.quality.per_frame ?? []).filter((f) => !f.passed && f.reasons.length)
  if (!failed.length) return null
  const nums = failed.map((f) => String(f.index + 1))
  const list = nums.length === 1 ? nums[0] : `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`
  const why = [...new Set(failed.flatMap((f) => f.reasons.map((x) => LEFT_OUT[x]).filter(Boolean)))]
  return `${nums.length === 1 ? 'Photo' : 'Photos'} ${list} ${nums.length === 1 ? 'was' : 'were'} left out${why.length ? ` (${why.join(', ')})` : ''}.`
}

/** "5 photos, 2 used" when the quality check left some out; else "5 photos". */
export function photosUsed(s: { n_frames: number; result?: AnalysisResult | null }): string {
  const used = s.result?.quality.passed ? s.result.frames_used : null
  const n = s.n_frames === 1 ? '1 photo' : `${s.n_frames} photos`
  return used !== null && used !== undefined && used < s.n_frames ? `${n}, ${used} used` : n
}
