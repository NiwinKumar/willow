import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { useOrgMaybe } from './org'
import type { MatchedRow } from './range'

/*
 * The connected range of the organisation you are in. The Proof contracts have no range endpoint yet, so the
 * matched item file is kept in this browser per instance and organisation (research/finals/build-notes/D.md
 * "Gaps"). A brand organisation's range is its own catalog products (it arrives from the retailer's item file,
 * filtered to the brand), so it needs no upload.
 */

export type StoredRange = { filename: string; at: string; source: 'file' | 'catalog'; rows: MatchedRow[] }

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

export function useRange(): { range: StoredRange | null; save: (r: StoredRange) => void; clear: () => void; key: string } {
  const org = useOrgMaybe()
  const key = `willow.proof.range.${org?.instance?.id ?? 'local'}.${org?.org?.id ?? 'retailer'}`
  const subscribe = useCallback((l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, [])
  const range = useSyncExternalStore(subscribe, () => read(key))
  return useMemo(() => ({ range, save: (r: StoredRange) => write(key, r), clear: () => write(key, null), key }), [range, key])
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
