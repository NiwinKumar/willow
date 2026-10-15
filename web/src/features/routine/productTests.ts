/**
 * Product tests (GET/POST /v1/product-tests, PATCH/DELETE /v1/product-tests/{id}): what is tried on the
 * treated forearm square, since when and for how long. The photos stay ordinary forearm check-ins and the
 * treated-vs-control verdict is worked out from them as before; it is given only after day 14.
 */
import { useCallback } from 'react'

import { useOwner } from '../../data/hooks'
import type { ProductTest, Session } from '../../data/types'
import { api, localDay } from '../../lib/api'
import { parseDate } from '../../lib/format'
import { invalidate, setQueryData, useQuery } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'

export const DEFAULT_TEST_DAYS = 28
export const MIN_TEST_DAYS = 7
export const MAX_TEST_DAYS = 56
/** No treated-vs-control verdict before this many days of the test. */
export const VERDICT_AFTER_DAYS = 14
export const TEST_LENGTHS = [7, 14, 21, 28, 42, 56] as const

const between = (a: string, b: string) => Math.round((parseDate(b.slice(0, 10)).getTime() - parseDate(a.slice(0, 10)).getTime()) / 86_400_000)

export function useProductTests() {
  const uid = useOwner()
  const query = useQuery(testsKey(uid), (t) => api.productTests(t).then((r) => r.tests), { enabled: Boolean(uid), staleMs: 5 * 60_000 })
  const running = query.data?.find((t) => !t.ended_at) ?? null
  return { ...query, running }
}

const testsKey = (uid: string | null) => ['product-tests', uid]
const byRunningThenNewest = (a: ProductTest, b: ProductTest) => Number(Boolean(a.ended_at)) - Number(Boolean(b.ended_at)) || b.started_at.localeCompare(a.started_at)
function putTest(uid: string | null, t: ProductTest) {
  setQueryData<ProductTest[]>(testsKey(uid), (prev) => [t, ...(prev ?? []).filter((x) => x.id !== t.id)].sort(byRunningThenNewest))
}

/** Start, change, end and remove; each answer goes straight into the shared cache. */
export function useProductTestWrites() {
  const uid = useOwner()
  const { getIdToken } = useAuth()
  const start = useCallback(
    async (body: { entry_id?: string; product_id?: string; name?: string; length_days?: number }) => {
      const t = await api.startProductTest(await getIdToken(), { ...body, started_at: localDay() })
      putTest(uid, t)
      return t
    },
    [getIdToken, uid],
  )
  const patch = useCallback(
    async (id: string, body: { name?: string; length_days?: number; ended_at?: string | null }) => {
      const t = await api.patchProductTest(await getIdToken(), id, body)
      putTest(uid, t)
      return t
    },
    [getIdToken, uid],
  )
  const remove = useCallback(
    async (id: string) => {
      await api.deleteProductTest(await getIdToken(), id)
      setQueryData<ProductTest[]>(testsKey(uid), (prev) => (prev ?? []).filter((x) => x.id !== id))
      invalidate(testsKey(uid))
    },
    [getIdToken, uid],
  )
  const end = useCallback((id: string) => patch(id, { ended_at: localDay() }), [patch])
  return { start, patch, remove, end }
}

export type TestDay = {
  /** Days since the start (0 on the start day). */
  elapsed: number
  /** "Day N of M": the start day is day 1; never past the plan's length. */
  day: number
  of: number
  /** The plan's days are all behind (it can keep going until ended). */
  complete: boolean
  /** Day 14 is behind: the verdict can be read. */
  ready: boolean
}

export function testDay(t: Pick<ProductTest, 'started_at' | 'ended_at' | 'length_days'>, today: string = localDay()): TestDay {
  const end = t.ended_at && t.ended_at.slice(0, 10) < today ? t.ended_at.slice(0, 10) : today
  const elapsed = Math.max(0, between(t.started_at, end))
  return { elapsed, day: Math.min(elapsed + 1, t.length_days), of: t.length_days, complete: elapsed + 1 >= t.length_days, ready: elapsed >= VERDICT_AFTER_DAYS }
}

/** One dot per day of the plan: a treated photo that day, a day gone by without one, today, or still to come. */
export type PlanDot = 'photo' | 'past' | 'today' | 'future'

export function planDots(t: Pick<ProductTest, 'started_at' | 'ended_at' | 'length_days'>, treated: Session[], today: string = localDay()): PlanDot[] {
  const photoDays = new Set(treated.filter((s) => s.status === 'done').map((s) => localDay(new Date(s.created_at))))
  const start = parseDate(t.started_at.slice(0, 10))
  const last = t.ended_at && t.ended_at.slice(0, 10) < today ? t.ended_at.slice(0, 10) : today
  return Array.from({ length: t.length_days }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const day = localDay(d)
    if (photoDays.has(day) && day <= last) return 'photo'
    if (day === today && !t.ended_at) return 'today'
    return day <= last ? 'past' : 'future'
  })
}
