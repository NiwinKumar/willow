import { api, type AutopilotView } from '../../../../lib/api'
import { useQuery } from '../../../../lib/query'

/** This viewer's AutoCampaign rules and activity (shared by the Campaigns page and the Overview brief). */
export const autopilotKey = (uid: string) => ['autopilot', uid] as const

export function useAutopilot(uid: string | null) {
  return useQuery<AutopilotView>(autopilotKey(uid ?? ''), (t) => api.autopilot(t), { enabled: Boolean(uid), staleMs: 15_000 })
}
