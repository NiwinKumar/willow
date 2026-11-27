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
 * The sections in nav order: id, label, URL segment, the question each answers, and the decision it supports with
 * what the viewer gains (the one line under the tabs). Built around a buyer's week: what needs a decision, which
 * products work (and which are in the range), who the customers are, how brands compare, what to promote, the
 * method behind every number, and the organisation's settings.
 */
export const SECTIONS: { id: SectionId; label: string; path: string; question: string; decision: string }[] = [
  { id: 'home', label: 'Home', path: '', question: 'What needs a decision, what is in progress, what came back.', decision: 'Decide what to stock, question and promote; every card carries its evidence and one action.' },
  { id: 'products', label: 'Products', path: 'products', question: 'Which products produce visible change?', decision: 'Decide which products earn shelf space and a campaign, from measured outcomes in your range.' },
  { id: 'customers', label: 'Customers', path: 'customers', question: 'Who uses what, what they want, and who is under-served?', decision: 'Decide which skin types and goals to source for; see where no product in the range works yet.' },
  { id: 'market', label: 'Market', path: 'market', question: 'How do brands and categories compare on outcomes?', decision: 'Decide where to compete: outcomes by brand and category under one method.' },
  { id: 'campaigns', label: 'Campaigns', path: 'campaigns', question: 'Promote proven products, and measure the lift.', decision: 'Decide what to promote and to whom; the randomised holdout shows the lift the campaign caused.' },
  { id: 'research', label: 'Research', path: 'research', question: 'How every number is made, and what may be claimed from it.', decision: 'For R&D, regulatory and marketing: the method, cohort facts, metric dictionary and claim rules.' },
  { id: 'settings', label: 'Settings', path: 'settings', question: 'Your organisation, team, data sharing and plan.', decision: 'Set who can see and do what, and the data-sharing rules every view follows.' },
]

/** Reachable from the "Advanced" menu (and from the pages that link to them); not in the main nav. */
export const ADVANCED: { id: SectionId; label: string; path: string; question: string; decision: string }[] = [
  { id: 'explore', label: 'Explore', path: 'explore', question: 'Ask your own question of the outcomes.', decision: 'Build your own cut of the product outcomes: measure, group and filter, then export.' },
  { id: 'compare', label: 'Compare', path: 'compare', question: 'How do two or three products differ?', decision: 'Put two or three products side by side on the same measures.' },
  { id: 'board', label: 'Overview board', path: 'board', question: 'The whole range on one screen.', decision: 'The range on one screen: the strongest proof, the market curve, goals and brands.' },
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
const GLOBAL_KEYS = ['as', 'cohort', 'range', 'instance'] as const

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
export function sectionPath(id: SectionId | keyof typeof LEGACY_PATHS | 'overview', sub?: string): string {
  if (id === 'overview') id = 'home'
  if (id === 'range') return `/retail/range${sub ? `/${encodeURIComponent(sub)}` : ''}`
  if (id === 'digest') return '/retail/digest'
  const s = [...SECTIONS, ...ADVANCED].find((x) => x.id === id)
  const path = s ? s.path : id
  return `/retail${path ? `/${path}` : ''}${sub ? `/${encodeURIComponent(sub)}` : ''}`
}

/** The one line a section's header carries: the decision the page supports and what the viewer gains. */
export function purposeOf(id: SectionId): string {
  if (id === 'range') return 'Connect your range once: your item file is matched to the measured catalog, so every view knows what you sell and what is measured.'
  if (id === 'digest') return 'Reach the team outside Proof: one email a week with what needs a decision and what came back.'
  return [...SECTIONS, ...ADVANCED].find((s) => s.id === id)?.decision ?? ''
}
