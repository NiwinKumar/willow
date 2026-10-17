import type { RetailerAction, RetailerClaimChannel } from '../../lib/api'
import { goalLabel, skinLabel } from './promote.ts'

/**
 * Willow Proof · AI on the product page (api proof_ai.py): the pure parts of "Next steps" and "Claim drafts", so
 * `npm test` can read them without the app. Where each next step goes, the channel words, and the short label
 * of each evidence statement a draft cites. Rules: docs/RETAILER_INSIGHTS.md "AI in Willow Proof".
 */

/** The claim channels in picker order; Product page is the default (the api's too). */
export const CHANNELS: { value: RetailerClaimChannel; label: string }[] = [
  { value: 'pack', label: 'Pack' },
  { value: 'pdp', label: 'Product page' },
  { value: 'listing', label: 'Retailer listing' },
  { value: 'social', label: 'Social' },
]
export const DEFAULT_CHANNEL: RetailerClaimChannel = 'pdp'
export const channelOf = (v: string | null | undefined): RetailerClaimChannel => CHANNELS.find((c) => c.value === v)?.value ?? DEFAULT_CHANNEL
export const channelLabel = (v: RetailerClaimChannel) => CHANNELS.find((c) => c.value === v)?.label ?? v

/**
 * A short label for an evidence statement a draft cites: efficacy → "Overall result", efficacy_<goal> → the goal,
 * speed → "Timing", segment_<skin> → the skin type, retention → "Still using", perception → "Self-reported".
 */
export function sourceLabel(id: string): string {
  if (id === 'efficacy') return 'Overall result'
  if (id === 'speed') return 'Timing'
  if (id === 'retention') return 'Still using'
  if (id === 'perception') return 'Self-reported'
  if (id.startsWith('efficacy_')) return goalLabel(id.slice('efficacy_'.length))
  if (id.startsWith('segment_')) return `${skinLabel(id.slice('segment_'.length))} skin`
  return id.replace(/_/g, ' ')
}

/** Element ids on the product page a next step scrolls to (panel headings, and the pipeline's section). */
export const ANCHOR = { next: 'next-h', pipeline: 'pipeline', segments: 'seg-h', claims: 'claims-h', feel: 'feel-h', context: 'ctx-h' } as const

/**
 * Where a next step goes: a route (the campaign sheet, prefilled with the product and its skin types) or a panel
 * on this page, with the URL keys that pick its tab (`seg`, `ctx`) or the claim channel (`claim`).
 */
export type ActionTarget = { kind: 'route'; to: string; label: string } | { kind: 'scroll'; anchor: string; params: Record<string, string | null>; label: string }

/**
 * `campaigns` is the Campaigns path with the global keys already on it ("/retail/campaigns?cohort=real").
 * `claimable` false (not Proven or Promising: the claim drafts are blocked): a claims step goes to "How it feels"
 * instead, where its numbers (felt vs measured) are, rather than to an empty claim panel.
 */
export function actionTarget(link: RetailerAction['link'], campaigns: string, claimable = true): ActionTarget {
  switch (link.section) {
    case 'campaigns': {
      const q = new URLSearchParams({ new: link.id })
      if (link.skin_types?.length) q.set('skins', link.skin_types.join(','))
      return { kind: 'route', to: `${campaigns}${campaigns.includes('?') ? '&' : '?'}${q.toString().replace(/%2C/g, ',')}`, label: 'Set up campaign' }
    }
    case 'claims': {
      if (!claimable) return { kind: 'scroll', anchor: ANCHOR.feel, params: {}, label: 'See felt vs measured' }
      const channel = channelOf(link.channel)
      return { kind: 'scroll', anchor: ANCHOR.claims, params: { claim: channel === DEFAULT_CHANNEL ? null : channel }, label: channel === 'pack' ? 'Draft pack copy' : 'Draft claims' }
    }
    case 'feel':
      return { kind: 'scroll', anchor: ANCHOR.feel, params: {}, label: 'See what people said' }
    case 'segments':
      return { kind: 'scroll', anchor: ANCHOR.segments, params: { seg: null }, label: 'See skin types' }
    case 'conflicts':
      return { kind: 'scroll', anchor: ANCHOR.context, params: { ctx: 'conflicts' }, label: 'See conflicts' }
    case 'co_used':
      return { kind: 'scroll', anchor: ANCHOR.context, params: { ctx: null }, label: 'See pairings' }
    case 'switching':
      return { kind: 'scroll', anchor: ANCHOR.context, params: { ctx: 'switch' }, label: 'See where users go' }
    case 'pipeline':
    default:
      return { kind: 'scroll', anchor: ANCHOR.pipeline, params: {}, label: 'See the pipeline' }
  }
}

/** The tiers the api drafts claims for (proof_ai.CLAIMS_TIERS); others get `blocked` without a Gemini call. */
export const CLAIM_TIERS: readonly string[] = ['proven', 'promising']

/** The provenance line under the next steps: Gemini picked them, or they are the fixed priority. */
export function actionsProvenance(source: 'gemini' | 'rules', considered: number): string {
  return source === 'gemini' ? `Picked by Gemini from ${considered} ${considered === 1 ? 'thing' : 'things'} the data supports` : 'From the data'
}

/** Skin types to tick when the campaign sheet opens: the requested ones the evidence covers, else all of them. */
export function prefillSkins(covered: string[], wanted: string[]): string[] {
  const keep = covered.filter((s) => wanted.includes(s))
  return keep.length ? keep : [...covered]
}
