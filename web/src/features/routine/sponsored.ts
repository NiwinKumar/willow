import type { SponsoredItem } from '../../lib/api'

/**
 * The sponsored card's words (docs/RETAILER_INSIGHTS.md "Proof-gated promotion"). Pure, so `npm test` can read it
 * without the app: labels come in as arguments.
 */

/** The disclosure, first on the card: the word "Sponsored" in text, never only a tooltip or a colour. */
export const SPONSORED_EYEBROW = 'Sponsored · Willow Proven'

/** Skin type labels (profile values), shared with Willow Proof's campaign audience. */
export const SKIN_LABEL: Record<string, string> = { oily: 'Oily', combination: 'Combination', dry: 'Dry', normal: 'Normal', sensitive: 'Sensitive' }

/** "Why am I seeing this?": what matched from the person's own profile, then the disclosure. */
export function whyLines(item: Pick<SponsoredItem, 'matched' | 'disclosure'>, goalLabel: (id: string) => string): { matched: string[]; disclosure: string } {
  const goals = item.matched.goals.map(goalLabel)
  const matched = goals.length ? [`${goals.length === 1 ? 'Your goal' : 'Your goals'}: ${goals.join(', ')}`] : []
  if (item.matched.skin_type) matched.push(`Your skin type: ${SKIN_LABEL[item.matched.skin_type] ?? item.matched.skin_type}`)
  return { matched, disclosure: item.disclosure }
}

/** Show the card? Never in the demo journey, never for a product already in the routine (any entry). */
export function showSponsored(item: Pick<SponsoredItem, 'product_id'> | null | undefined, opts: { demo: boolean; inRoutine: ReadonlySet<string> }): boolean {
  return Boolean(item) && !opts.demo && !opts.inRoutine.has(item!.product_id)
}
