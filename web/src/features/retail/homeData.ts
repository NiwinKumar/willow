import { useMemo } from 'react'

import { retailerBrand, retailerShelf } from '../../lib/api'
import { useQuery } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import { openProposals } from './autopilot'
import { useRetailData } from './context'
import { composeCards, type ProductSignals } from './decisions'
import { useOrg } from './org'
import { useCompetitorNames, useDecisions, useRequests, useSavedClaims } from './orgData'
import { useCampaigns } from './pipeline'
import { useProductDetails, useProducts } from './productData'
import { useRange } from './rangeStore'
import { useAutopilot } from './sections/promote/useAutopilot'
import { useRetailState } from './state'
import type { BrandDetail, Insights } from './types'
import { useSegments, useView } from './useView'

/*
 * Everything the Decisions home composes its cards from, read once (Home and the Weekly digest preview show the
 * same cards): product rows, this viewer's campaigns, the shelf check (retailer), segments, saved claims,
 * AutoCampaign proposals, a brand's own product pages and switching, and the organisation's decisions and
 * evidence requests. The cards themselves are decisions.ts composeCards (pure).
 */
export function useHomeCards(d: Insights) {
  const { filters, workspace } = useRetailData()
  const { carry } = useRetailState()
  const { org, orgs } = useOrg()
  const { user } = useAuth()
  const uid = user?.uid ?? null
  const brand = workspace.kind === 'brand' ? workspace.brand : null
  const mix: 'retailer' | 'brand' = org ? org.kind : workspace.kind
  const { state: prodState } = useProducts(filters)
  const rows = useMemo(() => (prodState.status === 'ready' ? prodState.d.products : []), [prodState])
  const campaigns = useCampaigns()
  const shelf = useQuery(['shelf-home', uid, filters.cohort, filters.range], (t) => retailerShelf(t, filters), { enabled: Boolean(uid) && mix === 'retailer', staleMs: 5 * 60_000 })
  const segments = useSegments()
  const claims = useSavedClaims()
  const auto = useAutopilot(uid)
  const decisions = useDecisions()
  const requests = useRequests()
  const { range } = useRange()
  const names = useCompetitorNames()
  // A brand's extra signals: its own measured products' pages (felt vs measured, routine conflicts; the four
  // with the most people) and its switching. Only fetched for a brand mix; the cards wait for nothing.
  const signalIds = useMemo(() => (mix === 'brand' && brand ? rows.filter((r) => r.brand === brand && r.n !== null).sort((a, b) => (b.n ?? 0) - (a.n ?? 0)).slice(0, 4).map((r) => r.product_id) : []), [mix, brand, rows])
  const details = useProductDetails(signalIds, filters)
  const signals = useMemo<ProductSignals[]>(() => details.flatMap((x) => (x.status === 'ready' ? [{ product_id: x.d.product.product_id, agree: x.d.feel?.agree ?? null, conflicts: x.d.conflicts ?? [] }] : [])), [details])
  const brandDetail = useView<BrandDetail>(mix === 'brand' && brand ? `brand|${brand}|${filters.cohort}|${filters.range}` : null, () => retailerBrand(brand!, filters))
  const brandOrgs = useMemo(() => new Set(orgs.filter((o) => o.kind === 'brand').flatMap((o) => o.brands)), [orgs])
  const cards = useMemo(() => {
    if (!rows.length) return []
    const shelfProducts = shelf.data ? shelf.data.categories.flatMap((c) => c.products.map((p) => ({ ...p, category_label: c.label }))) : null
    return composeCards({
      mix,
      brand,
      rows,
      campaigns,
      shelf: shelfProducts ? { products: shelfProducts, flags: shelf.data?.flags ?? [] } : null,
      segments: segments.status === 'ready' ? segments.data : null,
      demand: d.needs_by_month ?? null,
      claimed: new Set((claims.data ?? []).map((c) => c.product_id)),
      proposals: openProposals(auto.data?.activity ?? []),
      brandOrgs,
      weeks: d.cohort.weeks,
      carry,
      signals,
      switching: brandDetail.status === 'ready' ? brandDetail.data.switching : null,
      conflicts: { routines: d.routines_checked ?? null, rows: d.conflicts ?? [] },
      nameOf: names.name,
    })
  }, [rows, mix, brand, campaigns, shelf.data, segments, d, claims.data, auto.data, brandOrgs, carry, signals, brandDetail, names])
  return { mix, brand, rows, prodState, campaigns, shelf, decisions, requests, range, cards, segments }
}
