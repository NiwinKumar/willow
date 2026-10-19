import { useContext, useEffect } from 'react'

import { DataActivateContext, DataContext, type DataState } from './context'

export function useData(): DataState {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData outside DataProvider')
  return ctx
}

/**
 * The account's sessions, profile and consent are read only once a screen that shows them mounts (the skincare
 * app's shell, the check-in, the welcome and judge pages), never on the website or Willow Proof. Stays on after.
 */
export function useActivateData() {
  const activate = useContext(DataActivateContext)
  useEffect(() => activate?.(), [activate])
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
