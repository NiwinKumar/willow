/** Market page model: shared types, the comparison note fallback, and row ordering (no React). */

export type MarketView = 'brands' | 'categories'

/** The fallback for the api's comparison note (RetailerBrandDetail.note), shown once per view. */
export const NOTE = 'Observational comparison under the same method; differences inside the confidence intervals are not meaningful.'

export type VsRow = {
  id: string
  label: string
  /** Quiet second line under the label ("1 of 9 brands"). */
  sub?: string | null
  you: { rate: number; n: number | null; lo?: number | null; hi?: number | null } | null
  market: { rate: number; n?: number | null } | null
  rival?: { brand: string; rate: number; n: number } | null
}

/** Rows sorted by the gap to the market (largest first); rows without a comparison go last. */
export function byGap(rows: VsRow[]): VsRow[] {
  const gap = (r: VsRow) => (r.you && r.market ? r.you.rate - r.market.rate : null)
  return [...rows].sort((a, b) => {
    const ga = gap(a)
    const gb = gap(b)
    if (ga === null && gb === null) return a.label.localeCompare(b.label)
    if (ga === null) return 1
    if (gb === null) return -1
    return gb - ga || a.label.localeCompare(b.label)
  })
}
