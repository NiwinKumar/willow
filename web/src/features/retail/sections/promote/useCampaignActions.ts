import { useState } from 'react'

import { api, type Campaign } from '../../../../lib/api'
import { useAuth } from '../../../../lib/useAuth'
import { promoError, type PromoError } from '../../promote'

/** Pause, resume and delete with the api's refusals in words. A refusal can mean the list is stale: `onStale` reloads it. */
export function useCampaignActions(c: Campaign, { onChanged, onDeleted, onStale }: { onChanged: (c: Campaign) => void; onDeleted: (id: string) => void; onStale: () => void }) {
  const { getIdToken } = useAuth()
  const [busy, setBusy] = useState<null | 'status' | 'delete'>(null)
  const [error, setError] = useState<PromoError | null>(null)
  const fail = (e: unknown) => {
    const err = promoError(e)
    setError(err)
    if (err.kind === 'too_many' || err.kind === 'ended' || (e as { status?: number }).status === 404) onStale()
    return err
  }
  const setStatus = async (status: 'active' | 'paused'): Promise<PromoError | null> => {
    setBusy('status')
    setError(null)
    try {
      onChanged(await api.updateCampaign(await getIdToken(), c.id, { status }))
      return null
    } catch (e) {
      return fail(e)
    } finally {
      setBusy(null)
    }
  }
  const remove = async (): Promise<PromoError | null> => {
    setBusy('delete')
    setError(null)
    try {
      await api.deleteCampaign(await getIdToken(), c.id)
      onDeleted(c.id)
      return null
    } catch (e) {
      setBusy(null)
      return fail(e)
    }
  }
  return { busy, error, setStatus, remove }
}
