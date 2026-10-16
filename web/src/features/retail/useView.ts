import { useEffect, useState } from 'react'

import { ApiError, retailerSegments } from '../../lib/api'
import { useRetailData } from './context'
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
  return useView<Segments>(`segments|${filters.cohort}|${filters.range}`, () => retailerSegments(filters))
}
