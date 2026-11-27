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

/** The catalog has its full facts (ingredient list, actives, price): only these are suggested or checked.
 * Index products are known by name, category and stores only. Missing `detail` means full. */
export const hasFullFacts = (p: { detail?: 'full' | 'index' | null }): boolean => (p.detail ?? 'full') === 'full'

/** "Price not checked" where a price line would be, for a product with no checked price. */
export const NO_PRICE = 'Price not checked'

/** Whether opening this product should queue a request for its full facts: an index product the person has
 * not already asked about (a pending or answered request for it). */
export function needsFactsRequest(p: { product_id: string; detail?: 'full' | 'index' | null }, requests: readonly { for_product_id?: string | null; product_id?: string | null; status: string }[] | null | undefined): boolean {
  if (hasFullFacts(p) || !requests) return false
  return !requests.some((r) => r.for_product_id === p.product_id || r.product_id === p.product_id)
}
