import { slugOf } from '../retail/ui/format'
import { findTarget } from '../tour/find'
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
        { route: `/retail?${AS}`, target: 'css:#spot-h', action: 'point', caption: `Proof opens on ${BRAND}’s workspace, with its strongest proof first.`, hold: 2200 },
        { target: 'css:#brief-h', action: 'point', caption: 'This week’s brief: what moved in its data, summarised by Gemini. Every number is checked against the cards.', hold: 3000 },
        { target: 'text:View proof', action: 'click', caption: 'View proof opens what was measured for this product.', hold: 1200 },
        { target: 'css:section[aria-label="Key facts"]', action: 'point', caption: 'Visible change in its users, beside people with the same goals who don’t use it.', hold: 2600 },
        { target: 'css:#journey', action: 'point', caption: 'Every user from trying it to week 8, read from their own check-ins.', hold: 2400 },
        { target: 'css:#next-h', action: 'point', caption: 'Next steps: Gemini picks what to do next from what the data supports. Each one opens where it’s done.', hold: 3000 },
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
    ask: {
      id: 'brand-ask',
      title: 'Proof by Willow · ask',
      steps: [
        { route: `/retail?${AS}&ask=1`, target: 'text:Ask anything', action: 'point', caption: 'Ask anything: a question in plain words, about the same data on screen.', hold: 1600 },
        { run: ensureAsk, target: 'text:How do outcomes compare with non-users?', action: 'click', until: askDone, wait: 75_000, caption: 'Gemini answers from the aggregates only. Any number it writes that isn’t in them is rejected, and no one person can be looked up.', hold: 1200 },
        { target: 'css:dialog[open] [aria-busy="false"]', action: 'point', caption: 'The answer, its chart drawn from the same numbers, and follow-up questions.', hold: 3600 },
        { action: 'escape', caption: 'Back to the workspace.', hold: 800 },
      ],
    },
    sell: {
      id: 'brand-sell',
      title: 'Proof by Willow · claims and campaigns',
      steps: [
        { route: product(ids.hero), target: 'css:#ev-h', action: 'point', caption: 'Claim-ready statements, each with its number of people, its window and its cohort.', hold: 2400 },
        { target: 'css:section[aria-labelledby="claims-h"] button:not([role="radio"])', action: 'click', caption: 'Gemini drafts copy from those statements only. Every number is checked before it shows.', until: claimsDone, wait: 60_000, hold: 1500 },
        { target: 'css:#claims-h', action: 'point', caption: 'Each draft names the statements it rests on.', hold: 2600 },

        { route: `/retail/campaigns?${AS}&new=${encodeURIComponent(ids.hero)}`, target: 'css:#proof-new-campaign', action: 'point', caption: 'Only a Proven product can be promoted, so the campaign starts from its proof.', hold: 2000 },
        { target: 'text:Matching profiles', action: 'point', caption: 'The audience is only the goals and skin types its evidence covers.', hold: 2400 },
        { target: 'text:Randomised holdout', action: 'point', caption: 'A random holdout never sees the card, so the lift can be measured.', hold: 2400 },
        { target: 'text:The card exactly as a matching shopper sees it', action: 'point', caption: 'The card a matching shopper sees in the Willow app. Nothing is launched here.', hold: 2400 },
        { action: 'escape', caption: 'Or let Proof promote for you…', hold: 900 },
        { target: 'text:New rule', action: 'click', caption: 'AutoCampaign: rules that promote a product the moment its proof allows.', hold: 1200 },
        { target: 'css:dialog[open] textarea', action: 'type', text: RULE_WORDS, caption: 'A rule in plain words.', hold: 400 },
        { target: 'text:Read it', action: 'click', until: ruleRead, wait: 60_000, caption: 'Gemini reads the words into the rule, and the form checks it against the guardrails.', hold: 1200 },
        { target: 'text:Reads as', action: 'point', caption: 'The rule it read: which proof triggers it, who sees the card, for how long. Nothing is saved here.', hold: 3400 },
        { action: 'escape', caption: 'Measured, proven, claimed, promoted: with AI at each step, and every number checked.', hold: 1400 },
      ],
    },
  }
}
