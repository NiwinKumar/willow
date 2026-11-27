/**
 * Store clicks (POST /v1/clicks → 204): every outbound store link records which product, which store and
 * where in the app it was tapped. Fire-and-forget: `keepalive` lets the request finish while the store's
 * page opens, a failure is never shown, and nothing waits on it. The api stores no uid with a click.
 */
import { useCallback } from 'react'

import { request } from './api'
import { useAuth } from './useAuth'

export type ClickSurface = 'product_sheet' | 'wisp' | 'plan' | 'sponsored'
export type StoreClick = { product_id: string; store: string; surface: ClickSurface }

/** The disclosure that sits near every group of store links (the Terms say the same). */
export const COMMISSION_NOTE = 'We may earn a commission if you buy through these links.'

/** Send one click. Never throws. */
export function recordClick(getToken: () => Promise<string>, click: StoreClick): void {
  void getToken()
    .then((t) => request<void>(t, '/v1/clicks', { method: 'POST', body: JSON.stringify(click), keepalive: true }, 5_000))
    .catch(() => undefined) // measurement only: never in the person's way
}

/** `onStoreClick(product_id, store)` for one surface; put it on the link's onClick (the link still opens normally). */
export function useStoreClick(surface: ClickSurface) {
  const { getIdToken } = useAuth()
  return useCallback((product_id: string, store: string) => recordClick(getIdToken, { product_id, store, surface }), [getIdToken, surface])
}
