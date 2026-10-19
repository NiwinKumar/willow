import { useEffect, useRef } from 'react'

import type { Campaign } from '../../../../lib/api'

/** The campaign list's stats are read again this often (the pages say "refreshes every 30 s"). */
export const CAMPAIGN_REFRESH_MS = 30_000

/**
 * Live campaign stats (Campaigns page, a campaign's dashboard): only while some campaign is running (paused and
 * ended ones don't move), only while the tab is visible, and never sooner than the interval after the last answer
 * (another page's read, or coming back to the tab, counts).
 */
export function useCampaignPoll(data: { list: Campaign[]; at: number | null } | undefined, refetch: () => Promise<void>) {
  const live = Boolean(data?.list.some((c) => c.status === 'active'))
  const at = useRef<number | null>(null)
  useEffect(() => {
    at.current = data?.at ?? null
  })
  useEffect(() => {
    if (!live) return
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      // A little slack, so a tick that lands just before the answer turns 30 s old still reads.
      if (at.current !== null && Date.now() - at.current < CAMPAIGN_REFRESH_MS - 2_000) return
      void refetch()
    }
    const t = window.setInterval(tick, CAMPAIGN_REFRESH_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [live, refetch])
}
