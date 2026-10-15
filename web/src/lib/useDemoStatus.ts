import { useEffect, useState } from 'react'

import { api, type DemoStatus } from './api'

const WAKE_RETRY_MS = 12_000
const WAKE_RETRIES = 4

/**
 * /v1/demo/status, asked again while the engine is waking (it sleeps when idle): every 12 s, at
 * most 4 more times, then the latest answer stays. `failed`: the api never answered at all;
 * `gaveUp`: the engine was still waking after the last try.
 */
export function useDemoStatus(): { status: DemoStatus | null; failed: boolean; waking: boolean; gaveUp: boolean } {
  const [status, setStatus] = useState<DemoStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState(false)
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    let retries = 0
    const ask = async () => {
      try {
        const s = await api.demoStatus()
        if (!alive) return
        setStatus(s)
        if (s.engine.status === 'waking' && retries < WAKE_RETRIES) {
          retries++
          timer = window.setTimeout(() => void ask(), WAKE_RETRY_MS)
        } else setDone(true)
      } catch {
        if (!alive) return
        // A retry that fails keeps the last answer; only a first failure means "unknown".
        if (retries === 0) setFailed(true)
        setDone(true)
      }
    }
    void ask()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])
  const waking = status?.engine.status === 'waking'
  return { status, failed, waking, gaveUp: waking && done }
}
