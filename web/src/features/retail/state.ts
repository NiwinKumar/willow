import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { Cohort, Filters, Range, SectionId } from './types'

/**
 * Willow Proof URL state. Everything a view depends on lives in the query string, so any view can be shared or
 * reloaded as it was: `?as=brand:<slug>&cohort=&range=` for the whole app, plus per-section keys (`sort`,
 * `q`, `goal`, `product`…) that sections read with `param()` and write with `setParam()`. Defaults are left
 * out of the URL. Old links (`/retail?cohort=&range=`) keep working: they are the same keys.
 */

export const RANGES: { value: Range; label: string; caps: string }[] = [
  { value: '30d', label: '30 days', caps: 'LAST 30 DAYS' },
  { value: '90d', label: '90 days', caps: 'LAST 90 DAYS' },
  { value: 'all', label: 'All time', caps: 'ALL TIME' },
]
export const COHORTS: { value: Cohort; label: string }[] = [
  { value: 'simulated', label: 'Simulated' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'real', label: 'Real only' },
]
/** The api's defaults: every row, all time. */
export const DEFAULT_FILTERS: Filters = { cohort: 'mixed', range: 'all' }

/**
 * The sections in nav order: id, label, URL segment and the question each one answers (page subtitles). Built
 * around what a skin brand asks, in order: how am I doing, which products work, who are my customers, how do I
 * compare, how do I grow it; Explore answers anything else.
 */
export const SECTIONS: { id: SectionId; label: string; path: string; question: string }[] = [
  { id: 'overview', label: 'Overview', path: '', question: 'What is working, and what needs attention?' },
  { id: 'products', label: 'Products', path: 'products', question: 'Which products produce visible change?' },
  { id: 'customers', label: 'Customers', path: 'customers', question: 'Who is buying, what do they want, and who is under-served?' },
  { id: 'market', label: 'Market', path: 'market', question: 'How do brands and categories compare on outcomes?' },
  { id: 'campaigns', label: 'Campaigns', path: 'campaigns', question: 'Promote proven products, and measure the lift.' },
  { id: 'explore', label: 'Explore', path: 'explore', question: 'Ask your own question of the outcomes.' },
]

/** Round-1 paths and where they live now (old links and brief cards keep working). */
export const LEGACY_PATHS: Record<'categories' | 'segments' | 'demand' | 'competitors' | 'promote', { section: SectionId; params?: Record<string, string> }> = {
  categories: { section: 'market', params: { view: 'categories' } },
  segments: { section: 'customers' },
  demand: { section: 'customers', params: { view: 'demand' } },
  competitors: { section: 'market' },
  promote: { section: 'campaigns' },
}

/** The keys shared by every section (kept when moving between sections); section keys are dropped. */
const GLOBAL_KEYS = ['as', 'cohort', 'range'] as const

export type WorkspaceParam = { kind: 'retailer' } | { kind: 'brand'; slug: string }

export function parseWorkspace(v: string | null): WorkspaceParam {
  if (v && v.startsWith('brand:') && v.length > 6) return { kind: 'brand', slug: v.slice(6) }
  return { kind: 'retailer' }
}

export function useRetailState() {
  const [params, setParams] = useSearchParams()
  const filters: Filters = useMemo(
    () => ({
      cohort: COHORTS.find((c) => c.value === params.get('cohort'))?.value ?? DEFAULT_FILTERS.cohort,
      range: RANGES.find((r) => r.value === params.get('range'))?.value ?? DEFAULT_FILTERS.range,
    }),
    [params],
  )
  const workspace = useMemo(() => parseWorkspace(params.get('as')), [params])

  /** Set or clear (null / '') any keys at once; replaces history so filters don't flood Back. */
  const setParam = useCallback(
    (patch: Record<string, string | null | undefined>, opts: { push?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            const isDefault = (k === 'cohort' && v === DEFAULT_FILTERS.cohort) || (k === 'range' && v === DEFAULT_FILTERS.range) || (k === 'as' && v === 'retailer')
            if (v === null || v === undefined || v === '' || isDefault) next.delete(k)
            else next.set(k, v)
          }
          return next
        },
        { replace: !opts.push },
      )
    },
    [setParams],
  )
  const setFilters = useCallback((f: Partial<Filters>) => setParam(f), [setParam])
  const setWorkspace = useCallback((w: WorkspaceParam) => setParam({ as: w.kind === 'brand' ? `brand:${w.slug}` : null }), [setParam])
  const param = useCallback((k: string) => params.get(k), [params])

  /** "?as=…&cohort=…" for links to another section (the global keys only). */
  const carry = useMemo(() => {
    const p = new URLSearchParams()
    for (const k of GLOBAL_KEYS) {
      const v = params.get(k)
      if (v) p.set(k, v)
    }
    const s = p.toString()
    return s ? `?${s}` : ''
  }, [params])

  return { filters, workspace, setFilters, setWorkspace, param, setParam, carry, params }
}

/**
 * The path of a section ("/retail/products"), with an optional sub-path ("/retail/products/x"). A round-1 id
 * ("categories", "promote"...) gives its old path, which the shell redirects to the new home.
 */
export function sectionPath(id: SectionId | keyof typeof LEGACY_PATHS, sub?: string): string {
  const s = SECTIONS.find((x) => x.id === id)
  const path = s ? s.path : id
  return `/retail${path ? `/${path}` : ''}${sub ? `/${encodeURIComponent(sub)}` : ''}`
}
