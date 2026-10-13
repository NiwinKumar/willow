/** Per-device preferences and consent record. Browser storage only, wrapped so private mode never throws. */
export type Consent = { version: string; accepted_at: string; aggregate_opt_in: boolean }
export const CONSENT_VERSION = '2026-10-13'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode or blocked storage: the app still works */
  }
}

export const prefs = {
  consent: () => read<Consent>('willow.consent'),
  setConsent: (c: Consent) => write('willow.consent', c),
  /** Which consent (uid:version:opt-in) was last saved to the server, so it syncs once. */
  consentSynced: () => read<string>('willow.consentSynced'),
  setConsentSynced: (k: string) => write('willow.consentSynced', k),
  goals: () => read<string[]>('willow.goals') ?? [],
  setGoals: (g: string[]) => write('willow.goals', g),
  photoTime: () => read<string>('willow.photoTime'),
  setPhotoTime: (t: string) => write('willow.photoTime', t),
  lightroomDone: () => read<boolean>('willow.lightroom') ?? false,
  setLightroomDone: (v: boolean) => write('willow.lightroom', v),
  coachSeen: (id: string) => read<boolean>(`willow.coach.${id}`) ?? false,
  setCoachSeen: (id: string) => write(`willow.coach.${id}`, true),
  clearAll: () => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('willow.')) localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}

/** Where to go after onboarding: only an in-app path. */
export function nextPath(raw: string | null, fallback: string): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : fallback
}
