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

/**
 * The separate choices behind the consent (same CONSENT_VERSION, so nobody who agreed before is asked again):
 * photos and measurements, AI processing with Gemini, and the 18+ confirmation, each with the time it was
 * given. The aggregate opt-in stays where it was (prefs.consent().aggregate_opt_in, synced to the account).
 * Kept on this device; `adult` also goes to the account inside the safety profile when the person saves one
 * (lib/safety). Consent given before these existed has no record here: `adult` is then unknown (null).
 */
export type ConsentChoices = { photos: boolean; ai: boolean; adult: boolean; at: string }

const KEY = 'willow.consentChoices'
let memory: ConsentChoices | null = null

export function consentChoices(): ConsentChoices | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as ConsentChoices
  } catch {
    /* blocked storage: the in-memory copy below */
  }
  return memory
}

export function setConsentChoices(c: Omit<ConsentChoices, 'at'>): void {
  memory = { ...c, at: new Date().toISOString() }
  try {
    localStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    /* private mode: kept for this page load */
  }
}

/** Confirmed 18 or older on this device; null when never asked. */
export const adultConfirmed = (): boolean | null => consentChoices()?.adult ?? null
