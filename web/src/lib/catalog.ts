/** Catalog vocabulary (docs/CATALOG_SPEC.md): concern and category names, and which metrics a concern
 * moves. Products themselves always come from the api (/v1/catalog). */

export const CONCERN_LABEL: Record<string, string> = {
  acne_blemishes: 'blemishes',
  dark_spots_pigmentation: 'dark spots',
  uneven_tone: 'uneven tone',
  redness_sensitivity: 'redness',
  texture_pores: 'texture & pores',
  oiliness_shine: 'oiliness',
  fine_lines: 'fine lines',
  dark_circles: 'under-eye',
  dryness_barrier: 'dryness',
  dullness: 'dullness',
}

/** Product categories as people say them (docs/CATALOG_SPEC.md keys; label scans may add others). */
export const CATEGORY_LABEL: Record<string, string> = {
  cleanser: 'Cleanser',
  toner: 'Toner',
  serum: 'Serum',
  treatment: 'Treatment',
  exfoliant: 'Exfoliant',
  moisturizer: 'Moisturiser',
  sunscreen: 'Sunscreen',
  eye_care: 'Eye care',
  mask: 'Mask',
  other: 'Other',
}
export const categoryLabel = (c: string): string => CATEGORY_LABEL[c] ?? (c ? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ') : 'Other')

/** docs/CATALOG_SPEC.md concern -> metric map. */
export const CONCERN_METRICS: Record<string, string[]> = {
  acne_blemishes: ['blemishes', 'redness'],
  dark_spots_pigmentation: ['pigment_spots'],
  uneven_tone: ['tone_evenness'],
  redness_sensitivity: ['redness'],
  texture_pores: ['pores', 'texture'],
  oiliness_shine: ['shine'],
  fine_lines: ['lines'],
  dark_circles: ['dark_circles'],
  dryness_barrier: [],
  dullness: ['glow'],
}
