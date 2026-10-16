/**
 * Willow Proof types, re-exported from lib/api.ts (where every api shape lives, as for RetailerInsights) under
 * the names the retail screens use. Shapes: docs/CONTRACT.md section 3.
 */
export type {
  RetailerBrandDetail as BrandDetail,
  RetailerBrandSummary as BrandSummary,
  RetailerBrief as Brief,
  RetailerBriefCard as BriefCard,
  RetailerBriefSection as BriefSection,
  RetailerCohort as Cohort,
  RetailerFilters as Filters,
  RetailerInsights as Insights,
  RetailerProductDetail as ProductDetail,
  RetailerProductRow as ProductRow,
  RetailerProducts as Products,
  RetailerProofTier as ProofTier,
  RetailerRange as Range,
  RetailerSeg as Seg,
  RetailerSegments as Segments,
} from '../../lib/api'

/** Who the views are for: the whole retailer, or one brand ("Viewing as", ?as=brand:<slug>). */
export type Workspace = { kind: 'retailer' } | { kind: 'brand'; slug: string; brand: string | null }

/** The sections of the app, in nav order (the id is the URL segment under /retail). */
export type SectionId = 'overview' | 'products' | 'categories' | 'segments' | 'competitors' | 'demand' | 'promote'
