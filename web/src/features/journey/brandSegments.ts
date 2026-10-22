import { slugOf } from '../retail/ui/format'
import { findTarget } from '../tour/find'
import type { TourSegment } from '../tour/types'
import { lineText } from './narration'

// A step's caption is its narration line (voice.json): spoken and shown together.
const v = (id: string) => ({ voice: id, caption: lineText(id) })

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

export type BrandChapter = 'proof' | 'compare' | 'customers' | 'ask' | 'sell'

/** The product the story is about (the Overview spotlight) and the one with a category rival to compare. */
export type BrandIds = { hero: string; compare: string | null }

const product = (id: string) => `/retail/products/${encodeURIComponent(id)}?${AS}`

/** The claim drafts have arrived (or said why not): a draft's copy button, or the panel's alert. */
/** Ask: Gemini's answer has finished writing itself out (or the panel said why there is none). */
const askDone = () => Boolean(document.querySelector('dialog[open] [aria-busy="false"], dialog[open] [role="alert"]'))
/** AutoCampaign: Gemini has read the typed words into a rule (or the fixed patterns did). */
const ruleRead = () => Boolean(document.querySelector('dialog[open] p[role="status"], dialog[open] [role="alert"]'))
/** The Ask panel is open (?ask=1); if the page dropped it while loading, open it again. */
const ensureAsk = async () => {
  if (document.querySelector('dialog[open]')) return
  findTarget('text:Ask anything')?.click()
  await new Promise((r) => window.setTimeout(r, 700))
}
const RULE_WORDS = 'When a product becomes Proven for dark spots, promote it to oily and combination skin for 14 days'

const claimsDone = () => Boolean(document.querySelector('section[aria-labelledby="claims-h"] [aria-label="Copy draft"], section[aria-labelledby="claims-h"] [role="alert"]'))

export function brandSegments(ids: BrandIds): Record<BrandChapter, TourSegment | null> {
  return {
    proof: {
      id: 'brand-proof',
      title: 'Proof by Willow · the proof',
      steps: [
        { route: `/retail?${AS}`, target: 'css:#spot-h', action: 'point', ...v('b-proof-open'), hold: 2200 },
        { target: 'css:#brief-h', action: 'point', ...v('b-proof-brief'), hold: 3000 },
        { target: 'text:View proof', action: 'click', ...v('b-proof-view'), hold: 1200 },
        { target: 'css:section[aria-label="Key facts"]', action: 'point', ...v('b-proof-facts'), hold: 2600 },
        { target: 'css:#journey', action: 'point', ...v('b-proof-journey'), hold: 2400 },
        { target: 'css:#next-h', action: 'point', ...v('b-proof-next'), hold: 3000 },
      ],
    },
    compare: ids.compare
      ? {
          id: 'brand-compare',
          title: 'Proof by Willow · compare',
          steps: [
            { route: product(ids.compare), target: 'css:#comp-h', action: 'point', ...v('b-cmp-rank'), hold: 2200 },
            { target: 'label:Compare with', action: 'click', ...v('b-cmp-open'), hold: 1200 },
            { target: 'css:section[aria-label="Products side by side"]', action: 'point', ...v('b-cmp-same'), hold: 2600 },
            { target: 'css:#cmp-curve', action: 'point', ...v('b-cmp-curve'), hold: 2200 },
          ],
        }
      : null,
    customers: {
      id: 'brand-customers',
      title: 'Proof by Willow · customers',
      steps: [
        { route: `/retail/customers?${AS}`, target: 'text:Skin type × goal', action: 'point', ...v('b-cust-map'), hold: 2000 },
        { target: 'text:Best product', action: 'click', ...v('b-cust-best'), hold: 1800 },
        { target: 'label:, yours. Open details', action: 'click', ...v('b-cust-open'), hold: 1200 },
        { target: 'text:Best product for this group', action: 'point', ...v('b-cust-detail'), hold: 2600 },
      ],
    },
    ask: {
      id: 'brand-ask',
      title: 'Proof by Willow · ask',
      steps: [
        { route: `/retail?${AS}&ask=1`, target: 'text:Ask anything', action: 'point', ...v('b-ask-open'), hold: 1600 },
        { run: ensureAsk, target: 'text:How do outcomes compare with non-users?', action: 'click', until: askDone, wait: 75_000, ...v('b-ask-answer'), hold: 1200 },
        { target: 'css:dialog[open] [aria-busy="false"]', action: 'point', ...v('b-ask-chart'), hold: 3600 },
        { action: 'escape', ...v('b-ask-back'), hold: 800 },
      ],
    },
    sell: {
      id: 'brand-sell',
      title: 'Proof by Willow · claims and campaigns',
      steps: [
        { route: product(ids.hero), target: 'css:#ev-h', action: 'point', ...v('b-claims-list'), hold: 2400 },
        { target: 'css:section[aria-labelledby="claims-h"] button:not([role="radio"])', action: 'click', ...v('b-claims-draft'), until: claimsDone, wait: 60_000, hold: 1500 },
        { target: 'css:#claims-h', action: 'point', ...v('b-claims-cite'), hold: 2600 },

        { route: `/retail/campaigns?${AS}&new=${encodeURIComponent(ids.hero)}`, target: 'css:#proof-new-campaign', action: 'point', ...v('b-camp-start'), hold: 2000 },
        { target: 'text:Matching profiles', action: 'point', ...v('b-camp-audience'), hold: 2400 },
        { target: 'text:Randomised holdout', action: 'point', ...v('b-camp-holdout'), hold: 2400 },
        { target: 'text:The card exactly as a matching shopper sees it', action: 'point', ...v('b-camp-card'), hold: 2400 },
        { action: 'escape', ...v('b-camp-or'), hold: 900 },
        { target: 'text:New rule', action: 'click', ...v('b-auto-new'), hold: 1200 },
        { target: 'css:dialog[open] textarea', action: 'type', text: RULE_WORDS, ...v('b-auto-type'), hold: 400 },
        { target: 'text:Read it', action: 'click', until: ruleRead, wait: 60_000, ...v('b-auto-read'), hold: 1200 },
        { target: 'text:Reads as', action: 'point', ...v('b-auto-reads'), hold: 3400 },
        { action: 'escape', ...v('b-auto-end'), hold: 1400 },
      ],
    },
  }
}
