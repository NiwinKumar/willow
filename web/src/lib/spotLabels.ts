/**
 * Gemini's spot labels (api/app/labeller.py): what each engine-found spot looks like, in plain
 * cosmetic words. The ids are the api's enum (the contract, unchanged); the screen only ever shows the
 * descriptors below, never an id. Always shown as AI-suggested. A mark labelled `mole` is never shown,
 * counted or compared (spots.ts drops it); where spots appear, the mole note stands instead.
 */
export type SpotLabel =
  | 'papule_pustule'
  | 'open_comedone'
  | 'closed_comedone'
  | 'post_blemish_mark'
  | 'freckle'
  | 'mole'
  | 'scar'
  | 'pore'
  | 'hair_or_artifact'
  | 'uncertain'

export type LabelDetail = { label: SpotLabel; confidence: 'low' | 'medium' | 'high'; visible_features: string[] }

export const SPOT_NAME: Record<SpotLabel, [string, string]> = {
  papule_pustule: ['Raised blemish', 'Raised blemishes'],
  open_comedone: ['Open pore / blackhead', 'Open pores / blackheads'],
  closed_comedone: ['Small bump', 'Small bumps'],
  post_blemish_mark: ['Mark left by a blemish', 'Marks left by blemishes'],
  freckle: ['Freckle', 'Freckles'],
  // Never displayed: moles are left out of every list, count and comparison (spots.ts).
  mole: ['Mole', 'Moles'],
  scar: ['Scar', 'Scars'],
  pore: ['Visible pore', 'Visible pores'],
  hair_or_artifact: ['Hair or photo artefact', 'Hairs or photo artefacts'],
  uncertain: ['Unclear', 'Unclear'],
}

/** Verbatim from CLAUDE.md. Shown wherever spots are shown. */
export const MOLE_NOTE = 'Not a medical assessment; see a dermatologist for changing moles.'

/** Left off the photo unless picked in the list: hair and glare are not on the skin. */
export const HIDDEN_RINGS: SpotLabel[] = ['hair_or_artifact']

/** Never shown, counted or compared anywhere: Willow does not assess moles. */
export const NEVER_SHOWN: SpotLabel[] = ['mole']
