import { useEffect, useMemo, useState } from 'react'

import { ApiError, retailerSegments } from '../../lib/api'
import { useRetailData } from './context'
import { useCompetitorNames } from './orgData'
import type { Segments } from './types'

/**
 * One Willow Proof view (GET /v1/retailer/segments, /brands, /brands/{brand}…) per key, fetched once per
 * session and shared by every section that reads it (Skin profiles and Demand both read /segments). A failed
 * load is dropped from the cache, so Retry asks again. `key` null = nothing to load yet.
 */
export type ViewState<T> = { status: 'loading'; data: null; code: null } | { status: 'ready'; data: T; code: null } | { status: 'failed'; data: null; code: number | null }

const cache = new Map<string, Promise<unknown>>()

export function useView<T>(key: string | null, load: () => Promise<T>): ViewState<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const k = key === null ? null : `${key}#${attempt}`
  const [res, setRes] = useState<{ key: string | null; state: ViewState<T> }>({ key: null, state: { status: 'loading', data: null, code: null } })
  useEffect(() => {
    if (k === null) return
    let alive = true
    let p = cache.get(k) as Promise<T> | undefined
    if (!p) {
      p = load()
      p.catch(() => cache.delete(k))
      cache.set(k, p)
    }
    p.then(
      (data) => alive && setRes({ key: k, state: { status: 'ready', data, code: null } }),
      (e: unknown) => alive && setRes({ key: k, state: { status: 'failed', data: null, code: e instanceof ApiError ? e.status : null } }),
    )
    return () => {
      alive = false
    }
    // The key names the request; `load` is a fresh closure every render.
  }, [k]) // eslint-disable-line react-hooks/exhaustive-deps
  const state: ViewState<T> = res.key === k && k !== null ? res.state : { status: 'loading', data: null, code: null }
  return { ...state, retry: () => setAttempt((a) => a + 1) } as ViewState<T> & { retry: () => void }
}

/** GET /v1/retailer/segments for the current filter (Skin profiles and Demand share one request). */
export function useSegments() {
  const { filters } = useRetailData()
  const v = useView<Segments>(`segments|${filters.cohort}|${filters.range}`, () => retailerSegments(filters))
  const names = useCompetitorNames()
  const masked = useMemo(() => (v.status === 'ready' && names.anonymise ? maskSegments(v.data, names.name, names.own) : null), [v, names])
  return masked ? { ...v, data: masked } : v
}

/** Other brands' products as "A Brand C product" (the retailer's competitor-naming policy, for brand orgs). */
function maskSegments(s: Segments, name: (b: string) => string, own: string | null): Segments {
  const pick = <T extends { product: string; brand: string } | null>(p: T): T => (p && p.brand !== own ? { ...p, product: `A ${name(p.brand)} product`, brand: name(p.brand) } : p)
  return { ...s, cells: s.cells.map((c) => ({ ...c, best: pick(c.best), runner_up: pick(c.runner_up) })), by_skin: s.by_skin.map((b) => ({ ...b, top_products: b.top_products.map((p) => pick(p)) })) }
}
