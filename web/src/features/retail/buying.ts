import type { BuyingItem, BuyingList } from '../../lib/api'

/**
 * Willow Proof · Buying list: the pure parts (the copyable brief), so `npm test` can read them without the app.
 * Shapes and rules: api buying.py. Candidates keep their label, so a copied brief never reads as proof.
 */

export function itemText(it: BuyingItem): string {
  const lines = [`${it.title}${it.price ? ` (${it.tier_label}, ${it.price})` : ''}`, it.brief]
  if (it.candidates.length) {
    lines.push('Look at first (already in the catalog):')
    for (const c of it.candidates) lines.push(`- ${c.brand} ${c.product} — ${c.label}. ${c.why}`)
  }
  return lines.join('\n')
}

/** The whole list as plain text for a buyer: numbered briefs, then the caveat and where it came from. */
export function listText(list: BuyingList, cohortLabel: string): string {
  const body = list.items.map((it, i) => `${i + 1}. ${itemText(it)}`).join('\n\n')
  return `Willow Proof buying list (${cohortLabel})\n\n${body}\n\n${list.caveat}`
}

/** The badge for a gap's kind (the word carries it; tone only repeats it). */
export const KIND_BADGE: Record<BuyingItem['kind'], { word: string; tone: 'red' | 'amber' | 'gray' | 'outline' }> = {
  missing: { word: 'No option', tone: 'red' },
  weak: { word: 'Weak results', tone: 'amber' },
  low_everywhere: { word: 'Low in every tier', tone: 'amber' },
  unmeasured: { word: 'Not measured', tone: 'gray' },
  thin: { word: 'One option', tone: 'outline' },
}
