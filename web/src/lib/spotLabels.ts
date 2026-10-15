/**
 * Gemini's spot labels (api/app/labeller.py): what each engine-found spot looks like, in plain
 * cosmetic words. Always shown as AI-suggested; a mole always carries the dermatologist note.
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
  open_comedone: ['Blackhead', 'Blackheads'],
  closed_comedone: ['Whitehead', 'Whiteheads'],
  post_blemish_mark: ['Mark left by a blemish', 'Marks left by blemishes'],
  freckle: ['Freckle', 'Freckles'],
  mole: ['Mole', 'Moles'],
  scar: ['Scar', 'Scars'],
  pore: ['Visible pore', 'Visible pores'],
  hair_or_artifact: ['Hair or photo artefact', 'Hairs or photo artefacts'],
  uncertain: ['Unclear', 'Unclear'],
}

/** Verbatim from CLAUDE.md. */
export const MOLE_NOTE = 'Not a medical assessment; see a dermatologist for changing moles.'

/** Left off the photo unless picked in the list: hair and glare are not on the skin. */
export const HIDDEN_RINGS: SpotLabel[] = ['hair_or_artifact']
