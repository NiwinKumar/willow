/**
 * The one store Willow sends people to buy from: its retail partner. Set at build time with
 * VITE_PARTNER_STORE (a store name as the catalog writes it, e.g. "Nykaa"); Nykaa when unset. A product the
 * partner does not sell links to the brand's own site instead, never to another retailer.
 */
import type { Product } from '../data/types.ts'

type Store = Product['stores'][number]

const env = (import.meta as { env?: Record<string, string | undefined> }).env
export const PARTNER_STORE = env?.VITE_PARTNER_STORE?.trim() || 'Nykaa'

/** The purchase link to show for a product: the partner's page, else the brand site, else none. */
export function purchaseLink(stores: Store[], partner: string = PARTNER_STORE): Store | null {
  const named = (name: string) => stores.find((s) => s.store.trim().toLowerCase() === name.toLowerCase())
  return named(partner) ?? named('Brand site') ?? null
}
