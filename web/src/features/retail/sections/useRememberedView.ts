import { useEffect, useRef } from 'react'

import { useRetailState } from '../state'

/**
 * Filters that remember (P2B): a section's view keys (tab, filters, sort) are saved per workspace in this browser
 * and put back when the section opens with none of them in the URL (from the top nav, say). A link that carries
 * any of the keys wins, so shared views open as sent. Storage can be blocked (private windows): then nothing is
 * remembered and nothing breaks.
 */
export function useRememberedView(section: string, keys: readonly string[]) {
  const { params, setParam } = useRetailState()
  const storeKey = `willow.proof.view.${section}.${params.get('as') ?? 'retailer'}`
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (keys.some((k) => params.get(k))) return
    let saved: Record<string, string> | null = null
    try {
      saved = JSON.parse(window.localStorage.getItem(storeKey) ?? 'null') as Record<string, string> | null
    } catch {
      saved = null
    }
    if (saved && keys.some((k) => saved[k])) setParam(Object.fromEntries(keys.map((k) => [k, saved[k] ?? null])))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const sig = keys.map((k) => params.get(k) ?? '').join('|')
  useEffect(() => {
    if (!restored.current) return
    try {
      window.localStorage.setItem(storeKey, JSON.stringify(Object.fromEntries(keys.flatMap((k) => (params.get(k) ? [[k, params.get(k)]] : [])))))
    } catch {
      /* storage blocked: the view just isn't remembered */
    }
  }, [sig, storeKey]) // eslint-disable-line react-hooks/exhaustive-deps
}
