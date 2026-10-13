import { useContext } from 'react'

import { DataContext, type DataState } from './context'

export function useData(): DataState {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData outside DataProvider')
  return ctx
}

/** The DataProvider listens for this, so switching mode re-renders without a navigation. */
export const DEMO_EVENT = 'willow-demo'

export function enterDemo() {
  try {
    sessionStorage.setItem('willow.demo', '1')
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(DEMO_EVENT))
}
export function leaveDemo() {
  try {
    sessionStorage.removeItem('willow.demo')
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(DEMO_EVENT))
}
