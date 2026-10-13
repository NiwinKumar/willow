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
  return [...new Set(out)].map((w) => w.charAt(0).toUpperCase() + w.slice(1))
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
