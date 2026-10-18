import type { AnalysisResult } from '../data/types'
import { isCloseUp, qualityCopy } from './metrics'

const PEN_DOTS = /pen-dot square not found/i
/** The engine's notes in the app's words (close-ups: docs/METRICS.md, pores and texture). */
const PLAIN: [RegExp, string][] = [
  [/^uncalibrated photo: results are a trend only/i, 'Phone photo, no colour reference: read as a trend against your baseline, with a wider normal range'],
  [/^no colour card: colours as captured by the camera/i, 'No colour card: colours are as the camera captured them, so readings carry wider uncertainty'],
  [/^close-up scale assumed, not measured/i, 'Size on this close-up is estimated, not measured: pore and texture numbers compare with your own close-ups taken the same way, not as exact sizes'],
  [/^pores need a closer photo/i, 'Pores need a closer photo: hold the phone about 10 cm (a hand’s width) from your face, or closer'],
  [/^pores and texture need a closer photo/i, 'Pores and texture need a closer photo: hold the phone about 10 cm (a hand’s width) from your face, or closer'],
  [/^face not found in the selfie close-up/i, 'Willow could not find your face in the close-up, so size could not be measured: keep your nose and at least one eye in the photo'],
  [/^no cheek skin found in the photos/i, 'No cheek skin was found in the photos: put your cheek in the middle of the frame, phone about 10 cm away'],
  [/^no nose skin found in the photos/i, 'No nose skin was found in the photos: put your nose in the middle of the frame, phone about 10 cm away'],
]
const TREND = PLAIN[0][1]

const PEN_DOTS_TEXT =
  'Willow could not find the four pen dots. Mark the corners of a 4 cm square on the forearm, keep all four dots in the frame, and put white paper beside the arm.'

/**
 * The engine's notes, readable: placeholders dropped, one line for every photo missing its pen dots,
 * and "corrected with the white paper" dropped when another note says no white reference was found.
 */
export function readableWarnings(r: AnalysisResult | null | undefined): string[] {
  const raw = (r?.warnings ?? [])
    .filter((w) => !w.startsWith('placeholder:'))
    .map((w) => PLAIN.find(([re]) => re.test(w))?.[1] ?? w)
    // One trend note is enough: a phone photo never has a colour card either.
    .filter((w, _, all) => !(w.startsWith('No colour card: colours are as') && all.includes(TREND)))
  const noWhite = raw.some((w) => /no white reference found/i.test(w))
  const dots = raw.filter((w) => PEN_DOTS.test(w)).map((w) => w.match(/photo (\d+)/i)?.[1]).filter(Boolean)
  const out = raw.filter((w) => !PEN_DOTS.test(w) && !(noWhite && /white paper only/i.test(w)))
  if (dots.length) out.push(`Pen dots not found in photo ${dots.join(', ')}; ${dots.length === 1 ? 'that photo was' : 'those photos were'} not measured`)
  // "photo 3 lines up poorly with photo 1 (...)" once per photo: one sentence for all of them.
  const poor = out.map((w) => /^photo (\d+) (?:lines up poorly|could not be lined up) with photo (\d+)/i.exec(w)).filter((m): m is RegExpExecArray => Boolean(m))
  if (poor.length) {
    const nums = poor.map((m) => m[1])
    const list = nums.length === 1 ? `Photo ${nums[0]}` : `Photos ${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`
    out.splice(0, out.length, ...out.filter((w) => !/^photo \d+ (?:lines up poorly|could not be lined up) with photo/i.test(w)))
    out.push(`${list} did not line up well with photo ${poor[0][2]} (the face moved or the expression changed), so matching spots across photos is less certain`)
  }
  // The engine says "in some photos" even for a one-photo session.
  const one = (r?.quality.per_frame?.length ?? 0) === 1
  return [...new Set(out)].map((w) => (one ? w.replace(/ in some photos/i, '') : w)).map((w) => w.charAt(0).toUpperCase() + w.slice(1))
}

/** Why a session could not be measured, in plain words; missing pen dots explain "too few frames". */
export function failureReasons(r: AnalysisResult | null | undefined): string[] {
  if (!r) return []
  const reasons = [...new Set(r.quality.reasons)]
  const text = (x: string) => qualityCopy(x, r.site)?.text ?? x
  if ((r.warnings ?? []).some((w) => PEN_DOTS.test(w)) && (reasons.includes('too_few_frames') || r.frames_used === 0)) {
    return [PEN_DOTS_TEXT, ...reasons.filter((x) => x !== 'too_few_frames').map(text)]
  }
  return reasons.map(text)
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
  const word = (x: string) => (isCloseUp(r.site) && x === 'occlusion_suspected' ? 'too little skin in view' : LEFT_OUT[x])
  const why = [...new Set(failed.flatMap((f) => f.reasons.map(word).filter(Boolean)))]
  return `${nums.length === 1 ? 'Photo' : 'Photos'} ${list} ${nums.length === 1 ? 'was' : 'were'} left out${why.length ? ` (${why.join(', ')})` : ''}.`
}
