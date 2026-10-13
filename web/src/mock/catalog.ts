import type { Product } from '../data/types'

import seed from '../../../api/seed/products.json'

/**
 * The real catalog (docs/CATALOG_SPEC.md): 48 products with INCI, prices, store links and the
 * brand's own packshot, read from the same file the api serves. The demo and the live app show
 * the same products.
 */
export const CATALOG: Product[] = seed as Product[]

export const productById = (id: string): Product | undefined => CATALOG.find((p) => p.product_id === id)

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
