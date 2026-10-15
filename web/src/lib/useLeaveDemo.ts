import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import { leaveDemo, useData } from '../data/useData'

/**
 * Capturing is always the person's own: opening a capture screen leaves demo mode (and drops
 * ?demo from the URL), so consent and "baseline needed" come from their real account.
 * Returns true until the switch has happened, so callers can wait one render.
 */
export function useLeaveDemo(active = true): boolean {
  const data = useData()
  const [params, setParams] = useSearchParams()
  const inDemo = data.mode === 'demo'
  const flag = params.get('demo')
  useEffect(() => {
    if (!active) return
    if (flag !== null) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('demo')
          return next
        },
        { replace: true },
      )
    }
    if (inDemo) leaveDemo()
  }, [active, inDemo, flag, setParams])
  return active && inDemo
}
