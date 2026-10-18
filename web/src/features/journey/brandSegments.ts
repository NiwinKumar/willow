import { slugOf } from '../retail/ui/format'
import type { TourSegment } from '../tour/types'

/**
 * The live walkthroughs of Proof by Willow that play between the brand journey's slides (/journey/brand). Each
 * one drives the real retail app at /retail/* in The Derma Co's brand workspace (?as=brand:the-derma-co), with
 * the same data the slides read. Targets name visible text, aria-labels or ids from the retail sections
 * (Overview spotlight, product page, Compare, Customers matrix, Claim drafts, the New campaign sheet). Nothing is
 * launched or saved: the campaign sheet is only looked at. Product ids come from the api at run time, so the
 * walkthrough opens the same products the slides show.
 */

/** A real catalog brand with the strongest measured record in the cohort (two Proven products). */
export const BRAND = 'The Derma Co'
export const BRAND_SLUG = slugOf(BRAND)
const AS = `as=brand:${BRAND_SLUG}`

export type BrandChapter = 'proof' | 'compare' | 'customers' | 'claims' | 'campaign'

/** The product the story is about (the Overview spotlight) and the one with a category rival to compare. */
export type BrandIds = { hero: string; compare: string | null }

const product = (id: string) => `/retail/products/${encodeURIComponent(id)}?${AS}`

/** The claim drafts have arrived (or said why not): a draft's copy button, or the panel's alert. */
const claimsDone = () => Boolean(document.querySelector('section[aria-labelledby="claims-h"] [aria-label="Copy draft"], section[aria-labelledby="claims-h"] [role="alert"]'))

export function brandSegments(ids: BrandIds): Record<BrandChapter, TourSegment | null> {
  return {
    proof: {
      id: 'brand-proof',
      title: 'Proof by Willow · the proof',
      steps: [
        { route: `/retail?${AS}`, target: 'css:#spot-h', action: 'point', caption: `Proof opens on ${BRAND}’s workspace, with its strongest proof first.`, hold: 2200 },
        { target: 'text:View proof', action: 'click', caption: 'View proof opens what was measured for this product.', hold: 1200 },
        { target: 'css:section[aria-label="Key facts"]', action: 'point', caption: 'Visible change in its users, beside people with the same goals who don’t use it.', hold: 2600 },
        { target: 'css:#journey', action: 'point', caption: 'Every user from trying it to week 8, read from their own check-ins.', hold: 2400 },
      ],
    },
    compare: ids.compare
      ? {
          id: 'brand-compare',
          title: 'Proof by Willow · compare',
          steps: [
            { route: product(ids.compare), target: 'css:#comp-h', action: 'point', caption: 'Each product is ranked against others in its category that share a goal.', hold: 2200 },
            { target: 'label:Compare with', action: 'click', caption: 'Compare puts it side by side with the highest-ranked other product.', hold: 1200 },
            { target: 'css:section[aria-label="Products side by side"]', action: 'point', caption: 'The same figures for both, measured the same way.', hold: 2600 },
            { target: 'css:#cmp-curve', action: 'point', caption: 'When the lasting change began, week by week.', hold: 2200 },
          ],
        }
      : null,
    customers: {
      id: 'brand-customers',
      title: 'Proof by Willow · customers',
      steps: [
        { route: `/retail/customers?${AS}`, target: 'text:Skin type × goal', action: 'point', caption: 'Customers maps every skin type against the goal people chose.', hold: 2000 },
        { target: 'text:Best product', action: 'click', caption: 'Switch to the best product for each group.', hold: 1800 },
        { target: 'label:, yours. Open details', action: 'click', caption: `Open a group where ${BRAND} leads.`, hold: 1200 },
        { target: 'text:Best product for this group', action: 'point', caption: 'The leader, the runner-up and your other products for this goal.', hold: 2600 },
      ],
    },
    claims: {
      id: 'brand-claims',
      title: 'Proof by Willow · claims',
      steps: [
        { route: product(ids.hero), target: 'css:#ev-h', action: 'point', caption: 'Claim-ready statements, each with its number of people, its window and its cohort.', hold: 2400 },
        { target: 'css:section[aria-labelledby="claims-h"] button:not([role="radio"])', action: 'click', caption: 'Gemini drafts copy from those statements only. Every number is checked before it shows.', until: claimsDone, hold: 1500 },
        { target: 'css:#claims-h', action: 'point', caption: 'Each draft names the statements it rests on.', hold: 2600 },
      ],
    },
    campaign: {
      id: 'brand-campaign',
      title: 'Proof by Willow · campaign',
      steps: [
        { route: `/retail/campaigns?${AS}&new=${encodeURIComponent(ids.hero)}`, target: 'css:#proof-new-campaign', action: 'point', caption: 'Only a Proven product can be promoted, so the campaign starts from its proof.', hold: 2000 },
        { target: 'text:Matching profiles', action: 'point', caption: 'The audience is only the goals and skin types its evidence covers.', hold: 2400 },
        { target: 'text:Randomised holdout', action: 'point', caption: 'A random holdout never sees the card, so the lift can be measured.', hold: 2400 },
        { target: 'text:The card exactly as a matching shopper sees it', action: 'point', caption: 'The card a matching shopper sees in the Willow app. Nothing is launched here.', hold: 2400 },
      ],
    },
  }
}
