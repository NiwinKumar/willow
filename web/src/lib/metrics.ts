import type { Metric, MetricGroup, MetricId, Site, Unit, Verdict } from '../data/types'

/** Close-ups (engine pipeline_macro REGIONS). One cheek, forehead and chin are RAW close-ups; sides are the person's own. */
export const CLOSE_UPS: Site[] = ['cheek_macro', 'left_cheek_macro', 'right_cheek_macro', 'forehead_macro', 'chin_macro', 'nose_macro']
/** Close-ups measured like a cheek (tone, spots, redness, blemishes, pores, texture): all but the nose. */
const SKIN_CLOSE_UPS = CLOSE_UPS.filter((s) => s !== 'nose_macro')
/** The close-up's place in a sentence ("Too little forehead skin in view"). */
export const CLOSE_UP_WORD: Partial<Record<Site, string>> = {
  cheek_macro: 'cheek',
  left_cheek_macro: 'left cheek',
  right_cheek_macro: 'right cheek',
  forehead_macro: 'forehead',
  chin_macro: 'chin',
  nose_macro: 'nose',
}
export const closeUpPlace = (site: Site, capital = false) => {
  const w = CLOSE_UP_WORD[site] ?? 'cheek'
  return capital ? w[0].toUpperCase() + w.slice(1) : w
}

/** Per-metric wording from docs/UX_SPEC.md. Never "better/worse" for tone. */
export const METRIC_META: Record<
  MetricId,
  { label: string; group: MetricGroup; decrease: string; increase: string; note?: string; sites: Site[] }
> = {
  tone_ita: { label: 'Skin tone (ITA°)', group: 'tone_pigment', decrease: 'change detected', increase: 'change detected', note: 'Descriptive only. No direction is better.', sites: ['face_full', ...SKIN_CLOSE_UPS, 'forearm_treated', 'forearm_control'] },
  pigment_spots: { label: 'Dark spots', group: 'tone_pigment', decrease: 'fewer / fainter spots', increase: 'more visible spots', sites: ['face_full', ...SKIN_CLOSE_UPS] },
  tone_evenness: { label: 'Tone evenness', group: 'tone_pigment', decrease: 'more even', increase: 'less even', note: 'Lower is more even.', sites: ['face_full'] },
  redness: { label: 'Redness', group: 'redness', decrease: 'calmer', increase: 'more redness', note: 'Harder to read on deep skin tones.', sites: ['face_full', ...SKIN_CLOSE_UPS, 'forearm_treated', 'forearm_control'] },
  blemishes: { label: 'Blemishes', group: 'clarity', decrease: 'fewer blemishes', increase: 'more blemishes', sites: ['face_full', ...CLOSE_UPS] },
  pores: { label: 'Pores', group: 'texture_pores', decrease: 'less visible pores', increase: 'more visible pores', sites: CLOSE_UPS },
  texture: { label: 'Texture', group: 'texture_pores', decrease: 'smoother', increase: 'rougher', sites: SKIN_CLOSE_UPS },
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

/** Units a metric's number carries where its contract unit is too generic ("index"). */
const METRIC_UNIT: Partial<Record<MetricId, string>> = { lines: ' mm/cm²' }

/** The unit written after a metric's number (rows, detail, band). */
export function unitOf(m: { id: MetricId; unit: Unit }): string {
  return METRIC_UNIT[m.id] ?? UNIT_LABEL[m.unit]
}

export const UNIT_LABEL: Record<Unit, string> = {
  deg: '°',
  pct_area: '%',
  index: '',
  // Colour-space units (a*, ΔL*) mean nothing to most people: the number stands alone.
  a_star: '',
  count: '',
  per_cm2: '/cm²',
  delta_l_star: '',
}

/**
 * Sites the deployed engine measures today. Other sites are saved and marked "not measured yet"
 * (the api never shows the engine's placeholder numbers). Update when the engine adds a site.
 */
export const MEASURED_SITES: Site[] = ['face_full', ...CLOSE_UPS, 'forearm_treated', 'forearm_control']

/** Close-ups: size comes from the iris, so one eye stays in the photo, phone about 10 cm away. */
export const isCloseUp = (site: Site) => CLOSE_UPS.includes(site)

export const SITE_LABEL: Record<Site, string> = {
  face_full: 'Face',
  cheek_macro: 'Cheek close-up',
  left_cheek_macro: 'Left cheek close-up',
  right_cheek_macro: 'Right cheek close-up',
  forehead_macro: 'Forehead close-up',
  chin_macro: 'Chin close-up',
  nose_macro: 'Nose close-up',
  forearm_treated: 'Treated forearm',
  forearm_control: 'Control forearm',
}

/** The goals a person can pick (up to three), each matched 1:1 to catalog concerns and to the metrics it
 * pulls to the top of results. Ids are stored on the account (users/{uid}.profile.goals). */
export type GoalId = 'dark_spots' | 'even_tone' | 'redness' | 'blemishes' | 'pores_texture' | 'lines' | 'under_eye' | 'oil_glow'
export const GOALS: { id: GoalId; label: string; metrics: MetricId[] }[] = [
  { id: 'dark_spots', label: 'Dark spots', metrics: ['pigment_spots'] },
  { id: 'even_tone', label: 'Tone evenness', metrics: ['tone_evenness'] },
  { id: 'redness', label: 'Redness', metrics: ['redness'] },
  { id: 'blemishes', label: 'Blemishes', metrics: ['blemishes'] },
  { id: 'pores_texture', label: 'Pores and texture', metrics: ['pores', 'texture'] },
  { id: 'lines', label: 'Lines', metrics: ['lines'] },
  { id: 'under_eye', label: 'Under-eye', metrics: ['dark_circles'] },
  { id: 'oil_glow', label: 'Shine and glow', metrics: ['shine', 'glow'] },
]
export const MAX_GOALS = 3

/** Goal ids saved before the 8 goals (this device only), and what each became. */
const OLD_GOALS: Record<string, GoalId[]> = {
  even_tone: ['dark_spots', 'even_tone'],
  clearer: ['blemishes'],
  calmer: ['redness'],
  smoother: ['pores_texture'],
  softer_lines: ['lines'],
  under_eye: ['under_eye'],
  oil_glow: ['oil_glow'],
}

const isGoal = (g: unknown): g is GoalId => GOALS.some((x) => x.id === g)

/** Known goal ids only, each once, at most three (anything else stored is dropped). */
export function cleanGoals(ids: unknown): GoalId[] {
  return Array.isArray(ids) ? [...new Set(ids.filter(isGoal))].slice(0, MAX_GOALS) : []
}

/** A list saved with the old goal ids, in the new ones. */
export function migrateGoals(old: unknown): GoalId[] {
  return Array.isArray(old) ? cleanGoals(old.flatMap((g) => (typeof g === 'string' ? (OLD_GOALS[g] ?? []) : []))) : []
}

/** The metrics the chosen goals target, in goal order. */
export function goalMetrics(goalIds: string[]): MetricId[] {
  return [...new Set(goalIds.flatMap((g) => GOALS.find((x) => x.id === g)?.metrics ?? []))]
}

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

/** Order groups by the user's goals (the groups of their goal metrics first), then by the default order. */
export function orderedGroups(goalIds: string[]): MetricGroup[] {
  const lead: MetricGroup[] = []
  for (const id of goalMetrics(goalIds)) if (!lead.includes(METRIC_META[id].group)) lead.push(METRIC_META[id].group)
  const rest = (Object.keys(GROUP_META) as MetricGroup[]).filter((g) => !lead.includes(g)).sort((a, b) => GROUP_META[a].order - GROUP_META[b].order)
  return [...lead, ...rest]
}

/**
 * Compares two metrics for goal order: groups as orderedGroups, then a goal's own metrics first inside their
 * group (in goal order), and skin tone (descriptive only) never leading its group. 0 = no preference.
 */
export function byGoalOrder(goalIds: string[]): (a: MetricId, b: MetricId) => number {
  const groups = orderedGroups(goalIds)
  const picked = goalMetrics(goalIds)
  const pick = (id: MetricId) => (picked.includes(id) ? picked.indexOf(id) : picked.length)
  const tone = (id: MetricId) => (id === 'tone_ita' ? 1 : 0)
  return (a, b) => groups.indexOf(METRIC_META[a].group) - groups.indexOf(METRIC_META[b].group) || pick(a) - pick(b) || tone(a) - tone(b)
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

/** Close-ups fail differently: the face is mostly out of frame on purpose, and "covered" means too little skin. */
const CLOSE_UP_COPY: Partial<Record<string, { text: string; action: string }>> = {
  face_not_found: { text: 'Willow could not find your face to measure size. Keep your nose and at least one eye in the photo, phone about 10 cm away.', action: 'Retake one frame' },
}

/** QUALITY_COPY for this site: close-ups get their own wording for face and skin checks. */
export function qualityCopy(reason: string, site?: Site | null): { text: string; action: string } | undefined {
  if (site && isCloseUp(site)) {
    if (reason === 'occlusion_suspected') return { text: `Too little ${closeUpPlace(site)} skin in view. Put it in the middle of the photo, with hair and hands out of the way.`, action: 'Retake one frame' }
    if (CLOSE_UP_COPY[reason]) return CLOSE_UP_COPY[reason]
  }
  return QUALITY_COPY[reason]
}
