import type { Feel, FeelTag, FeelVerdict, ProductRow } from './types'
import { int, MIN_GROUP, pct } from './ui/format.ts'

/*
 * "How it feels": what people using a product say about it (self-reported, GET /v1/retailer/products/{id}
 * `feel`, rows' `felt` / `felt_n`). Shown next to the measurements, never inside the Proof tier, the evidence
 * pack or a claim. Pure helpers (no React) so `npm test` covers them (tests/feel.test.ts); every number is the
 * api's, re-expressed as whole percents.
 */

/** The three answers, in the order the shopper sees them (and the stacked bar draws them). */
export const VERDICTS: readonly { id: FeelVerdict; label: string }[] = [
  { id: 'working', label: 'It’s working for me' },
  { id: 'unsure', label: 'Too soon to tell' },
  { id: 'not_for_me', label: 'Not for me' },
]

export type VerdictPart = { id: FeelVerdict; label: string; share: number; text: string; width: number }

/**
 * The stacked bar's parts: each verdict's share as a whole percent, and its width in % of the bar (the shares
 * are rounded to 2 dp by the api, so they are scaled to fill exactly 100).
 */
export function verdictParts(f: Pick<Feel, FeelVerdict>): VerdictPart[] {
  const total = VERDICTS.reduce((s, v) => s + Math.max(0, f[v.id] ?? 0), 0)
  return VERDICTS.map((v) => {
    const share = Math.max(0, f[v.id] ?? 0)
    return { id: v.id, label: v.label, share, text: pct(share), width: total > 0 ? (share / total) * 100 : 0 }
  })
}

/** The bar in words, for its accessible name: "Of 142 people: 51% It’s working for me, 25% …". */
export function verdictSummary(f: Pick<Feel, FeelVerdict | 'n'>): string {
  return `Of ${int(f.n)} people who said how it feels: ${verdictParts(f)
    .map((p) => `${p.text} ${p.label}`)
    .join(', ')}.`
}

/** Tags split into "Liked" (good) and "Not liked", most-said first (the api's order), at most `max` each. */
export function splitTags(tags: FeelTag[], max = 4): { liked: FeelTag[]; notLiked: FeelTag[] } {
  return { liked: tags.filter((t) => t.good).slice(0, max), notLiked: tags.filter((t) => !t.good).slice(0, max) }
}

export type AgreeKey = 'both' | 'measured_only' | 'felt_only' | 'neither'

/**
 * The "Felt vs measured" cells in reading order of the 2×2 (rows: visible change yes / no; columns: said it's
 * working yes / no), each with its one plain sentence.
 */
export const AGREE_CELLS: readonly { key: AgreeKey; felt: boolean; measured: boolean; sentence: string }[] = [
  { key: 'both', felt: true, measured: true, sentence: 'Felt it and it showed.' },
  { key: 'measured_only', felt: false, measured: true, sentence: 'Changed but didn’t feel it yet: the people most likely to stop early. Set expectations on timing.' },
  { key: 'felt_only', felt: true, measured: false, sentence: 'Felt it before photos showed it.' },
  { key: 'neither', felt: false, measured: false, sentence: 'Neither felt nor measured a change yet.' },
]

/** Why there is no "Felt vs measured" for a product: it isn't measured, or too few people at week 8 answered. */
export function agreeMissing(p: Pick<ProductRow, 'tier' | 'reason'>): string {
  if (p.reason === 'not_measured') return 'Felt vs measured needs a measured outcome, and what this product targets has no Willow measure.'
  if (p.reason === 'unused') return 'Felt vs measured appears once people using it reach week 8.'
  return `Felt vs measured appears once ${MIN_GROUP} or more people at week 8 have said how it feels.`
}

/** The products table's "Feels it works" cell: "51%" with "n=142", or null when suppressed. */
export function feltText(r: Pick<ProductRow, 'felt' | 'felt_n'>): { value: string; n: string; tip: string } | null {
  if (r.felt === null || r.felt === undefined || !r.felt_n) return null
  return { value: pct(r.felt), n: `n=${int(r.felt_n)}`, tip: `${pct(r.felt)} of ${int(r.felt_n)} people said “It’s working for me” (self-reported)` }
}
