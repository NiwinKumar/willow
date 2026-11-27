import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { setQueryData, useQuery } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import { useOrgMaybe } from './org'
import { proofApi, type RangeRowApi, type RangeView } from './proofApi'
import type { MatchedRow } from './range'

/*
 * The connected range of the organisation you are in, kept on the api per organisation
 * (GET/PUT/DELETE /v1/proof/orgs/{org}/range): a colleague on another laptop sees the same range. A brand
 * organisation reads the retailer's item file filtered to its own products (`from` names the retailer); it
 * cannot upload one. This browser keeps a copy only as a fallback: when the range endpoint fails (or in the
 * legacy mode with no organisations), the last range saved here is used and labelled as such.
 */

export type StoredRange = {
  filename: string
  at: string
  source: 'file' | 'catalog'
  rows: MatchedRow[]
  /** Whose item file it is, when it is another organisation's (a brand reading the retailer's). */
  from?: string | null
  /** Where this copy lives: on the organisation (server) or only in this browser. */
  where?: 'server' | 'browser'
}

const listeners = new Set<() => void>()
const cache = new Map<string, StoredRange | null>()

function read(key: string): StoredRange | null {
  if (cache.has(key)) return cache.get(key) ?? null
  let v: StoredRange | null = null
  try {
    const raw = window.localStorage.getItem(key)
    v = raw ? (JSON.parse(raw) as StoredRange) : null
  } catch {
    v = null
  }
  cache.set(key, v)
  return v
}

function write(key: string, v: StoredRange | null) {
  cache.set(key, v)
  try {
    if (v) window.localStorage.setItem(key, JSON.stringify(v))
    else window.localStorage.removeItem(key)
  } catch {
    /* storage blocked: it lasts for this visit */
  }
  listeners.forEach((l) => l())
}

export const toApiRows = (rows: MatchedRow[]): RangeRowApi[] =>
  rows.map((r) => ({ line: r.line, gtin: r.gtin, product_id: r.productId, brand: r.brand, name: r.name, category: r.category, price: r.price, facings: r.facings, match: r.match, status: r.status }))

/** The api's range as the screens read it (null when the organisation has none). */
export function fromApi(v: RangeView | undefined): StoredRange | null {
  if (!v?.range) return null
  const r = v.range
  return {
    filename: r.filename,
    at: r.uploaded_at ?? '',
    source: r.source,
    from: v.from?.name ?? null,
    where: 'server',
    rows: r.rows.map((x) => ({ line: x.line, gtin: x.gtin, productId: x.product_id, brand: x.brand, name: x.name, category: x.category, price: x.price, facings: x.facings, match: x.match, status: x.status })),
  }
}

export type RangeHandle = {
  range: StoredRange | null
  /** The organisation's range is still loading (screens wait rather than flash "no range"). */
  loading: boolean
  /** Save to the organisation; 'browser' when the api refused or failed and only this browser has it. */
  save: (r: StoredRange) => Promise<'server' | 'browser'>
  clear: () => Promise<void>
  key: string
}

export function useRange(): RangeHandle {
  const org = useOrgMaybe()
  const orgId = org?.org?.id ?? null
  const { getIdToken } = useAuth()
  const key = `willow.proof.range.${org?.instance?.id ?? 'local'}.${orgId ?? 'retailer'}`
  const subscribe = useCallback((l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, [])
  const local = useSyncExternalStore(subscribe, () => read(key))
  const q = useQuery<RangeView>(['proof-range', orgId], (t) => proofApi.range(t, orgId!), { enabled: Boolean(orgId), staleMs: 60_000 })
  const failed = q.status === 'error' && q.data === undefined
  const server = useMemo(() => fromApi(q.data), [q.data])
  const browser = useMemo(() => (local ? { ...local, where: 'browser' as const } : null), [local])
  const range = !orgId || failed ? browser : server
  const loading = Boolean(orgId) && !failed && q.data === undefined
  return useMemo(
    () => ({
      range,
      loading,
      key,
      save: async (r: StoredRange) => {
        if (!orgId) {
          write(key, r)
          return 'browser' as const
        }
        try {
          const v = await proofApi.putRange(await getIdToken(), orgId, { filename: r.filename, source: r.source, rows: toApiRows(r.rows) })
          setQueryData<RangeView>(['proof-range', orgId], v)
          write(key, null)
          return 'server' as const
        } catch {
          write(key, r)
          return 'browser' as const
        }
      },
      clear: async () => {
        write(key, null)
        if (!orgId) return
        await proofApi.deleteRange(await getIdToken(), orgId)
        setQueryData<RangeView>(['proof-range', orgId], { range: null, from: null })
      },
    }),
    [range, loading, key, orgId, getIdToken],
  )
}

/** The product ids in the connected range (matched rows only); null when no range is connected. */
export function rangeIds(r: StoredRange | null): Set<string> | null {
  if (!r) return null
  return new Set(r.rows.flatMap((x) => (x.match ? [x.match] : [])))
}

/* ── small per-organisation "done once" flags for the getting-started checklist ── */

export function useOnceFlag(name: string): [boolean, () => void] {
  const org = useOrgMaybe()
  const key = `willow.proof.flag.${org?.instance?.id ?? 'local'}.${org?.org?.id ?? 'retailer'}.${name}`
  const subscribe = useCallback((l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, [])
  const on = useSyncExternalStore(subscribe, () => {
    try {
      return window.localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const set = useCallback(() => {
    try {
      window.localStorage.setItem(key, '1')
    } catch {
      /* blocked */
    }
    listeners.forEach((l) => l())
  }, [key])
  return [on, set]
}
