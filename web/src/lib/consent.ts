import { api } from './api'
import { prefs } from './prefs'

/** Save this device's consent to the person's account (users/{uid}.consent) once per change. */
export async function syncConsent(uid: string, getIdToken: () => Promise<string>): Promise<void> {
  const c = prefs.consent()
  if (!c) return
  const key = `${uid}:${c.version}:${c.aggregate_opt_in}`
  if (prefs.consentSynced() === key) return
  await api.putConsent(await getIdToken(), { version: c.version, aggregate_insights_opt_in: c.aggregate_opt_in })
  prefs.setConsentSynced(key)
}
