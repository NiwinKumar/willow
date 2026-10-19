import { useEffect, useState } from 'react'

import { retailerBrands, retailerProduct, retailerProducts } from '../../lib/api'
import type { Filters, ProductDetail, Products } from './types'

/**
 * Fetching for the product screens: GET /v1/retailer/products (scoreboard, categories) and
 * /v1/retailer/products/{id} (product page, quick look, compare), one request per filter and id for the
 * session (switching screens or back to a filter never refetches; a failure is retried next time). Also
 * /v1/retailer/brands, shared the same way by the workspace picker (context.tsx), Brands and Categories.
 */

export type Load<T> = { status: 'loading' } | { status: 'ready'; d: T } | { status: 'missing' } | { status: 'failed' }

const listCache = new Map<string, Promise<Products>>()
const detailCache = new Map<string, Promise<ProductDetail>>()
const brandsCache = new Map<string, Promise<Awaited<ReturnType<typeof retailerBrands>>>>()

function cached<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key)
  if (!p) {
    p = make()
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

const fkey = (f: Filters) => `${f.cohort}|${f.range}`
export const fetchProducts = (f: Filters) => cached(listCache, fkey(f), () => retailerProducts(f))
export const fetchProduct = (id: string, f: Filters) => cached(detailCache, `${id}|${fkey(f)}`, () => retailerProduct(id, f))
export const fetchBrandList = (f: Filters) => cached(brandsCache, fkey(f), () => retailerBrands(f))

const fail = (e: unknown): Load<never> => ((e as { status?: number })?.status === 404 ? { status: 'missing' } : { status: 'failed' })

/** The scoreboard rows for the current filter. `retry` refetches after a failure. */
export function useProducts(f: Filters): { state: Load<Products>; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const key = `${fkey(f)}|${attempt}`
  const [res, setRes] = useState<{ key: string; state: Load<Products> }>({ key: '', state: { status: 'loading' } })
  useEffect(() => {
    let alive = true
    fetchProducts(f).then(
      (d) => alive && setRes({ key, state: { status: 'ready', d } }),
      (e) => alive && setRes({ key, state: fail(e) }),
    )
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return { state: res.key === key ? res.state : { status: 'loading' }, retry: () => setAttempt((a) => a + 1) }
}

/** Several products' detail at once (one per id, in order); `null` id → nothing fetched. */
export function useProductDetails(ids: string[], f: Filters): Load<ProductDetail>[] {
  const key = `${ids.join(',')}|${fkey(f)}`
  const [res, setRes] = useState<{ key: string; states: Load<ProductDetail>[] }>({ key: '', states: [] })
  useEffect(() => {
    let alive = true
    const states: Load<ProductDetail>[] = ids.map(() => ({ status: 'loading' }))
    ids.forEach((id, i) =>
      fetchProduct(id, f).then(
        (d) => {
          states[i] = { status: 'ready', d }
          if (alive) setRes({ key, states: [...states] })
        },
        (e) => {
          states[i] = fail(e)
          if (alive) setRes({ key, states: [...states] })
        },
      ),
    )
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return res.key === key ? res.states : ids.map(() => ({ status: 'loading' }))
}

/** One product's detail; `id` null → stays loading without a request (a closed quick look). */
export function useProductDetail(id: string | null, f: Filters): Load<ProductDetail> {
  const states = useProductDetails(id ? [id] : [], f)
  return id ? (states[0] ?? { status: 'loading' }) : { status: 'loading' }
}
