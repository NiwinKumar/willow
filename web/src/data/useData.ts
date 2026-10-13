import { useContext } from 'react'

import { DataContext, type DataState } from './context'

export function useData(): DataState {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData outside DataProvider')
  return ctx
}

export function enterDemo() {
  try {
    sessionStorage.setItem('willow.demo', '1')
  } catch {
    /* private mode */
  }
}
export function leaveDemo() {
  try {
    sessionStorage.removeItem('willow.demo')
  } catch {
    /* private mode */
  }
}
