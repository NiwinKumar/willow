import type { ShelfCategory, ShelfFlag, ShelfKind } from '../../lib/api'

/**
 * Willow Proof · Shelf vs results: the pure parts (the template file, badges), so `npm test` can read them
 * without the app. Shapes and rules: api shelf.py.
 */

/** A starter CSV a retailer fills in: every measured product, facings left blank. */
export function templateCsv(categories: ShelfCategory[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const rows = categories.flatMap((c) => c.products.map((p) => [p.product_id, `${p.brand} ${p.product}`, c.label, ''].map(esc).join(',')))
  return ['product_id,product,category,facings', ...rows].join('\n') + '\n'
}

export const KIND_TONE: Record<ShelfKind, 'red' | 'green' | 'amber'> = {
  taking_space: 'amber',
  under_shelved: 'green',
  stocked_unused: 'amber',
  used_understocked: 'green',
}

/** Flags for one category first, then the rest (the panel follows the category picked above). */
export function flagsFor(flags: ShelfFlag[], category: string): ShelfFlag[] {
  return [...flags.filter((f) => f.category === category), ...flags.filter((f) => f.category !== category)]
}
