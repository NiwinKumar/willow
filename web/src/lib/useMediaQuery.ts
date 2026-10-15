import { useCallback, useSyncExternalStore } from 'react'

/** Live match of a CSS media query, so a layout mounts one tree per breakpoint (unique ids, one chart). */
export function useMediaQuery(query: string): boolean {
  // stable per query, so React does not re-subscribe on every render
  const subscribe = useCallback(
    (on: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', on)
      return () => mq.removeEventListener('change', on)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
