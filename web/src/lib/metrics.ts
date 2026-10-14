import type { Metric, MetricGroup, MetricId, Site, Unit, Verdict } from '../data/types'

/** Per-metric wording from docs/UX_SPEC.md. Never "better/worse" for tone. */
export const METRIC_META: Record<
  MetricId,
  { label: string; group: MetricGroup; decrease: string; increase: string; note?: string; sites: Site[] }
> = {
  tone_ita: { label: 'Skin tone (ITA°)', group: 'tone_pigment', decrease: 'change detected', increase: 'change detected', note: 'Descriptive only. No direction is better.', sites: ['face_full', 'cheek_macro', 'forearm_treated', 'forearm_control'] },
  pigment_spots: { label: 'Dark spots', group: 'tone_pigment', decrease: 'fewer / lighter spots', increase: 'more visible spots', sites: ['face_full', 'cheek_macro'] },
  tone_evenness: { label: 'Tone evenness', group: 'tone_pigment', decrease: 'more even', increase: 'less even', note: 'Lower is more even.', sites: ['face_full'] },
  redness: { label: 'Redness', group: 'redness', decrease: 'calmer', increase: 'more redness', note: 'Harder to read on deep skin tones.', sites: ['face_full', 'cheek_macro', 'forearm_treated', 'forearm_control'] },
  blemishes: { label: 'Blemishes', group: 'clarity', decrease: 'fewer blemishes', increase: 'more blemishes', sites: ['face_full', 'cheek_macro', 'nose_macro'] },
  pores: { label: 'Pores', group: 'texture_pores', decrease: 'less visible pores', increase: 'more visible pores', sites: ['cheek_macro', 'nose_macro'] },
  texture: { label: 'Texture', group: 'texture_pores', decrease: 'smoother', increase: 'rougher', sites: ['cheek_macro'] },
  lines: { label: 'Lines', group: 'lines', decrease: 'softer lines', increase: 'more visible lines', sites: ['face_full'] },
  dark_circles: { label: 'Under-eye', group: 'eye_area', decrease: 'darker under-eye', increase: 'brighter under-eye', sites: ['face_full'] },
  shine: { label: 'Shine', group: 'oil_glow', decrease: 'less shine', increase: 'more shine', sites: ['face_full'] },
  glow: { label: 'Glow', group: 'oil_glow', decrease: 'less glow', increase: 'more glow', sites: ['face_full'] },
}

export const GROUP_META: Record<MetricGroup, { label: string; order: number }> = {
  tone_pigment: { label: 'Tone & pigment', order: 0 },
  redness: { label: 'Redness', order: 1 },
  clarity: { label: 'Clarity', order: 2 },
  texture_pores: { label: 'Texture & pores', order: 3 },
  lines: { label: 'Lines', order: 4 },
  eye_area: { label: 'Under-eye', order: 5 },
  oil_glow: { label: 'Oil & glow', order: 6 },
}

export const UNIT_LABEL: Record<Unit, string> = {
  deg: '°',
  pct_area: '%',
  index: '',
  a_star: 'a*',
  count: '',
  per_cm2: '/cm²',
  delta_l_star: 'ΔL*',
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  real_change: 'Real change',
  within_noise: 'Within normal photo variation',
  no_baseline: 'First reading',
  low_quality: 'Photo quality too low to compare',
}

/**
 * Sites the deployed engine measures today. Other sites are saved and marked "not measured yet"
 * (the api never shows the engine's placeholder numbers). Update when the engine adds a site.
 */
export const MEASURED_SITES: Site[] = ['face_full', 'forearm_treated', 'forearm_control']

export const SITE_LABEL: Record<Site, string> = {
  face_full: 'Face',
  cheek_macro: 'Cheek close-up',
  nose_macro: 'Nose close-up',
  forearm_treated: 'Forearm, treated',
  forearm_control: 'Forearm, control',
}

/** Goals (docs/UX_SPEC.md screen 3) and the groups they pull to the top. */
export const GOALS: { id: string; label: string; groups: MetricGroup[] }[] = [
  { id: 'clearer', label: 'Clearer skin', groups: ['clarity', 'redness'] },
  { id: 'even_tone', label: 'Even tone & fewer dark spots', groups: ['tone_pigment'] },
  { id: 'calmer', label: 'Calmer skin', groups: ['redness'] },
  { id: 'smoother', label: 'Smoother texture & pores', groups: ['texture_pores'] },
  { id: 'softer_lines', label: 'Softer lines', groups: ['lines'] },
  { id: 'under_eye', label: 'Under-eye', groups: ['eye_area'] },
  { id: 'oil_glow', label: 'Oil control & glow', groups: ['oil_glow'] },
]

/** Decimals a value is shown with: never more precision than the band supports. */
export function decimalsFor(m: Pick<Metric, 'mdc95' | 'unit'>): number {
  if (m.unit === 'count') return 0
  const band = m.mdc95 ?? 1
  if (band >= 5) return 0
  if (band >= 0.5) return 1
  return 2
}

export function fmtValue(v: number | null, m: Pick<Metric, 'mdc95' | 'unit'>): string {
  if (v === null || Number.isNaN(v)) return '–'
  const s = v.toFixed(decimalsFor(m))
  // A typographic minus; a value that rounds to zero never shows as "-0.0".
  return Number(s) === 0 ? s.replace('-', '') : s.replace('-', '−')
}

export function fmtSigned(v: number | null, m: Pick<Metric, 'mdc95' | 'unit'>): string {
  if (v === null) return '–'
  const s = fmtValue(Math.abs(v), m)
  // The sign follows the number as shown: −0.02 shown as 0.0 has no sign.
  if (Number(s) === 0) return s
  return v < 0 ? `−${s}` : `+${s}`
}

export function directionText(m: Metric): string {
  const meta = METRIC_META[m.id]
  if (m.direction === 'decrease') return meta.decrease
  if (m.direction === 'increase') return meta.increase
  return ''
}

/** Order groups by the user's goals, then by the default order. */
export function orderedGroups(goalIds: string[]): MetricGroup[] {
  const lead: MetricGroup[] = []
  for (const g of goalIds) for (const grp of GOALS.find((x) => x.id === g)?.groups ?? []) if (!lead.includes(grp)) lead.push(grp)
  const rest = (Object.keys(GROUP_META) as MetricGroup[]).filter((g) => !lead.includes(g)).sort((a, b) => GROUP_META[a].order - GROUP_META[b].order)
  return [...lead, ...rest]
}

export const VERDICT_RANK: Record<Verdict, number> = { real_change: 0, within_noise: 1, low_quality: 2, no_baseline: 3 }

export const QUALITY_COPY: Record<string, { text: string; action: string }> = {
  card_not_found: { text: "We couldn't find the colour card. Put it flat next to the skin, fully in frame.", action: 'Retake one frame' },
  card_delta_e_high: { text: "The card colours are off. Check the lamp is the same and the card isn't in shadow or glare.", action: 'Retake the session' },
  blurry: { text: 'This one is soft. Hold still, or rest your elbows on the table.', action: 'Retake one frame' },
  overexposed: { text: 'Too bright. Same lamp, same distance, settings locked?', action: 'Retake the session' },
  underexposed: { text: 'Too dark. Same lamp, same distance, settings locked?', action: 'Retake the session' },
  pose_out_of_range: { text: 'Face a little turned. Look straight at the phone.', action: 'Retake one frame' },
  face_not_found: { text: 'No face found. Full face, hair back, phone at arm’s length.', action: 'Retake one frame' },
  occlusion_suspected: { text: 'Something is covering the skin (hair, glasses, hand).', action: 'Retake one frame' },
  too_few_frames: { text: 'No photo passed the quality check, so nothing could be measured.', action: 'Retake the session' },
}
