import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, retailerBrands } from '../../lib/api'
import { totalUsers } from './data'
import { useRetailState } from './state'
import type { BrandSummary, Filters, Insights, Workspace } from './types'
import { MIN_GROUP, slugOf } from './ui/format'

/**
 * The data every Willow Proof section shares, fetched once per filter by the shell: the insights aggregates
 * (GET /v1/retailer/insights) and the brand list for "Viewing as". The brand list comes from
 * GET /v1/retailer/brands when this api build has it, otherwise from the brands named in the insights.
 */

export type InsightsState = { status: 'loading' } | { status: 'failed' } | { status: 'empty'; d: Insights } | { status: 'ready'; d: Insights }
export type BrandOption = { brand: string; slug: string; products: number | null; summary: BrandSummary | null }

type Ctx = {
  insights: InsightsState
  retry: () => void
  brands: BrandOption[]
  workspace: Workspace
  filters: Filters
}
const RetailCtx = createContext<Ctx | null>(null)

// One answer per filter for the session: switching sections or back to a filter never refetches.
const insightsCache = new Map<string, Promise<Insights>>()
const brandsCache = new Map<string, Promise<BrandSummary[] | null>>()

function fetchInsights(f: Filters, attempt: number): Promise<Insights> {
  const key = `${f.cohort}|${f.range}|${attempt}`
  let p = insightsCache.get(key)
  if (!p) {
    p = api.retailerInsights(f)
    p.catch(() => insightsCache.delete(key))
    insightsCache.set(key, p)
  }
  return p
}
function fetchBrands(f: Filters): Promise<BrandSummary[] | null> {
  const key = `${f.cohort}|${f.range}`
  let p = brandsCache.get(key)
  if (!p) {
    // Not on every api build yet (slice A): a failure means "use the insights' brands".
    p = retailerBrands(f).then(
      (r) => r.brands,
      () => null,
    )
    brandsCache.set(key, p)
  }
  return p
}

/** Brand names in the insights (product outcomes, the most-used products, categories), with product counts. */
export function brandsFromInsights(d: Insights): Map<string, number> {
  const ids = new Map<string, Set<string>>()
  const add = (brand: string, id: string) => {
    if (!ids.has(brand)) ids.set(brand, new Set())
    ids.get(brand)!.add(id)
  }
  for (const [id, o] of Object.entries(d.product_outcomes ?? {})) add(o.brand, id)
  for (const p of d.products) add(p.brand, p.product_id)
  for (const c of d.categories ?? []) for (const b of c.brands) if (!ids.has(b.brand)) ids.set(b.brand, new Set())
  return new Map([...ids].map(([b, s]) => [b, s.size]))
}

export function RetailDataProvider({ children }: { children: ReactNode }) {
  const { filters, workspace: ws } = useRetailState()
  const [attempt, setAttempt] = useState(0)
  const key = `${filters.cohort}|${filters.range}|${attempt}`
  const [res, setRes] = useState<{ key: string; state: InsightsState }>({ key: '', state: { status: 'loading' } })
  const [summaries, setSummaries] = useState<{ key: string; list: BrandSummary[] | null }>({ key: '', list: null })

  useEffect(() => {
    let alive = true
    fetchInsights(filters, attempt).then(
      (d) => alive && setRes({ key, state: { status: d.empty || totalUsers(d.cohort) < MIN_GROUP ? 'empty' : 'ready', d } }),
      () => alive && setRes({ key, state: { status: 'failed' } }),
    )
    const bkey = `${filters.cohort}|${filters.range}`
    fetchBrands(filters).then((list) => alive && setSummaries({ key: bkey, list }))
    return () => {
      alive = false
    }
    // The key covers the filter and the attempt.
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const insights = useMemo<InsightsState>(() => (res.key === key ? res.state : { status: 'loading' }), [res, key])
  const d = insights.status === 'ready' || insights.status === 'empty' ? insights.d : null
  const list = summaries.key === `${filters.cohort}|${filters.range}` ? summaries.list : null

  const brands = useMemo<BrandOption[]>(() => {
    const fromApi = list?.map((b) => ({ brand: b.brand, slug: slugOf(b.brand), products: b.products, summary: b })) ?? []
    if (fromApi.length) return fromApi.sort((a, b) => a.brand.localeCompare(b.brand))
    if (!d) return []
    return [...brandsFromInsights(d)].map(([brand, products]) => ({ brand, slug: slugOf(brand), products: products || null, summary: null })).sort((a, b) => a.brand.localeCompare(b.brand))
  }, [list, d])

  const slug = ws.kind === 'brand' ? ws.slug : null
  const workspace = useMemo<Workspace>(() => (slug ? { kind: 'brand', slug, brand: brands.find((b) => b.slug === slug)?.brand ?? null } : { kind: 'retailer' }), [slug, brands])

  const value = useMemo<Ctx>(() => ({ insights, retry: () => setAttempt((a) => a + 1), brands, workspace, filters }), [insights, brands, workspace, filters])
  return <RetailCtx.Provider value={value}>{children}</RetailCtx.Provider>
}

export function useRetailData(): Ctx {
  const c = useContext(RetailCtx)
  if (!c) throw new Error('useRetailData outside RetailDataProvider')
  return c
}
