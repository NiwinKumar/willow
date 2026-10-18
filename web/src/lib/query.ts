/**
 * A tiny shared cache for api reads, so two screens asking for the same thing (Home's routine card and the
 * Routine page, say) share one request and one answer, and a write can refresh every reader at once.
 *
 *   const routine = useQuery(['routine', uid], (token) => api.routine(token), { enabled: Boolean(uid) })
 *   routine.data / routine.status ('idle' | 'loading' | 'ready' | 'error') / routine.refetch()
 *   setQueryData(['routine', uid], next)   // after a write that answered the new state
 *   invalidate(['routine'])                // refetch every key that starts with these parts
 *
 * Keys are arrays; the signed-in uid belongs in the key so one person's answers never show for another.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { useAuth } from './useAuth'

export type QueryStatus = 'idle' | 'loading' | 'ready' | 'error'
type Entry<T> = { v: number; gen: number; data: T | undefined; error: unknown; status: QueryStatus; at: number; inflight: Promise<void> | null; fetcher: ((token: string) => Promise<T>) | null; token: (() => Promise<string>) | null }

const cache = new Map<string, Entry<unknown>>()
const listeners = new Map<string, Set<() => void>>()

const noToken = () => Promise.resolve('')

const keyOf = (parts: readonly unknown[]) => JSON.stringify(parts)

function entry<T>(k: string): Entry<T> {
  let e = cache.get(k) as Entry<T> | undefined
  if (!e) {
    e = { v: 0, gen: 0, data: undefined, error: null, status: 'idle', at: 0, inflight: null, fetcher: null, token: null }
    cache.set(k, e as Entry<unknown>)
  }
  return e
}

/** Entries change in place, so readers subscribe to a version number that every change bumps. */
function emit(k: string) {
  const e = cache.get(k)
  if (e) e.v++
  listeners.get(k)?.forEach((l) => l())
}

function run<T>(k: string): Promise<void> {
  const e = entry<T>(k)
  if (!e.fetcher || !e.token) return Promise.resolve()
  if (e.inflight) return e.inflight
  const { fetcher, token } = e
  // A write (setQueryData) or invalidate during this read bumps gen: the answer may predate that write,
  // so it is dropped and read again (two quick routine ticks would otherwise undo the second one).
  const gen = e.gen
  // A failed refetch keeps the last good answer on screen (status stays ready, error is set).
  if (e.data === undefined) e.status = 'loading'
  emit(k)
  let again = false
  e.inflight = token()
    .then((t) => fetcher(t))
    .then((data) => {
      if (e.gen !== gen) return void (again = true)
      e.data = data
      e.error = null
      e.status = 'ready'
      e.at = Date.now()
    })
    .catch((err) => {
      if (e.gen !== gen) return void (again = true)
      e.error = err
      if (e.data === undefined) e.status = 'error'
    })
    .finally(() => {
      e.inflight = null
      emit(k)
    })
    .then(() => (again && cache.get(k) === e ? run<T>(k) : undefined))
  return e.inflight
}

export type QueryResult<T> = { data: T | undefined; status: QueryStatus; error: unknown; refetch: () => Promise<void> }

/** Read `fetcher` once per key (and again after `staleMs`, default 60 s, when a screen mounts). */
/** `public`: a read that needs no sign-in (the demo journey), so it never waits for a token. */
export function useQuery<T>(parts: readonly unknown[], fetcher: (token: string) => Promise<T>, opts: { enabled?: boolean; staleMs?: number; public?: boolean } = {}): QueryResult<T> {
  const { getIdToken } = useAuth()
  const enabled = opts.enabled ?? true
  const staleMs = opts.staleMs ?? 60_000
  const k = keyOf(parts)
  const subscribe = useCallback(
    (l: () => void) => {
      let set = listeners.get(k)
      if (!set) listeners.set(k, (set = new Set()))
      set.add(l)
      return () => set.delete(l)
    },
    [k],
  )
  useSyncExternalStore(subscribe, () => cache.get(k)?.v ?? -1)
  useEffect(() => {
    if (!enabled) return
    const e = entry<T>(k)
    e.fetcher = fetcher
    e.token = opts.public ? noToken : getIdToken
    if (e.status === 'idle' || e.status === 'error' || Date.now() - e.at > staleMs) void run<T>(k)
    // fetcher identity changes every render; the key decides when to fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, enabled, staleMs, getIdToken, opts.public])
  const refetch = useCallback(() => run<T>(k), [k])
  const e = (cache.get(k) as Entry<T> | undefined) ?? null
  return { data: enabled ? e?.data : undefined, status: enabled ? (e?.status ?? 'loading') : 'idle', error: e?.error ?? null, refetch }
}

/** Put a known answer in the cache (a write that returned the new state) and redraw its readers. */
export function setQueryData<T>(parts: readonly unknown[], update: T | ((prev: T | undefined) => T)) {
  const k = keyOf(parts)
  const e = entry<T>(k)
  e.data = typeof update === 'function' ? (update as (p: T | undefined) => T)(e.data) : update
  e.gen++
  e.status = 'ready'
  e.at = Date.now()
  emit(k)
}

/** Read a cached answer without subscribing (for optimistic writes). */
export function getQueryData<T>(parts: readonly unknown[]): T | undefined {
  return cache.get(keyOf(parts))?.data as T | undefined
}

/** Refetch every cached key whose parts start with `prefix` (readers keep the old answer until it lands). */
export function invalidate(prefix: readonly unknown[]) {
  const head = keyOf(prefix).slice(0, -1)
  for (const k of cache.keys()) {
    if (k.startsWith(head)) {
      const e = cache.get(k)!
      e.at = 0
      if (e.inflight) e.gen++ // the read already on its way may predate the change: read again after it
      if (listeners.get(k)?.size) void run(k)
    }
  }
}

/** Forget everything (sign-out, delete): the next person starts from nothing. */
export function clearQueries() {
  const keys = [...listeners.keys()]
  cache.clear()
  for (const k of keys) listeners.get(k)?.forEach((l) => l())
}
