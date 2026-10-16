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

/** The sections in nav order: id, label, URL segment and the question each one answers (nav tooltips, titles). */
export const SECTIONS: { id: SectionId; label: string; path: string; question: string }[] = [
  { id: 'overview', label: 'Overview', path: '', question: 'What changed, and what needs attention?' },
  { id: 'products', label: 'Products', path: 'products', question: 'Which products produce measured change?' },
  { id: 'categories', label: 'Categories', path: 'categories', question: 'How does each category perform by goal?' },
  { id: 'segments', label: 'Skin profiles', path: 'segments', question: 'Which skin profiles are under-served?' },
  { id: 'competitors', label: 'Competitors', path: 'competitors', question: 'How does a brand compare with the market?' },
  { id: 'demand', label: 'Demand', path: 'demand', question: 'What are customers trying to change?' },
  { id: 'promote', label: 'Promote', path: 'promote', question: 'Which products can be promoted, and to whom?' },
]

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

/** The path of a section ("/retail/products"), with an optional sub-path ("/retail/categories/serum"). */
export function sectionPath(id: SectionId, sub?: string): string {
  const s = SECTIONS.find((x) => x.id === id)!
  return `/retail${s.path ? `/${s.path}` : ''}${sub ? `/${encodeURIComponent(sub)}` : ''}`
}
