import { useSyncExternalStore } from 'react'

/** Live match of a CSS media query, so a layout mounts one tree per breakpoint (unique ids, one chart). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (on) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', on)
      return () => mq.removeEventListener('change', on)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
