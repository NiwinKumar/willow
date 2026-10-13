import { useEffect, useState } from 'react'

import { api, type RetailerInsights } from './api'

type Outcomes = { byProduct: NonNullable<RetailerInsights['product_outcomes']>; synthetic: boolean }

let pending: Promise<Outcomes | null> | null = null

/** Cohort outcome per product from the public retailer aggregates, fetched once per page load. */
export function useOutcomes(): Outcomes | null {
  const [out, setOut] = useState<Outcomes | null>(null)
  useEffect(() => {
    let alive = true
    pending ??= api
      .retailerInsights()
      .then((d) => ({ byProduct: d.product_outcomes ?? {}, synthetic: d.cohort.real === 0 }))
      .catch(() => null)
    void pending.then((o) => alive && setOut(o))
    return () => {
      alive = false
    }
  }, [])
  return out
}
