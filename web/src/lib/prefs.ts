/** Per-device preferences and consent record. Browser storage only, wrapped so private mode never throws. */
export type Consent = { version: string; accepted_at: string; aggregate_opt_in: boolean }
export const CONSENT_VERSION = '2026-10-13'

// When the browser blocks storage, choices still hold for this page load (consent included),
// so nobody is sent back to the consent screen in a loop.
const memory = new Map<string, string>()

function read<T>(key: string): T | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    /* blocked storage */
  }
  raw ??= memory.get(key) ?? null
  try {
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function write(key: string, value: unknown) {
  const raw = JSON.stringify(value)
  memory.set(key, raw)
  try {
    localStorage.setItem(key, raw)
  } catch {
    /* private mode or blocked storage: the in-memory copy keeps the app working */
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
    memory.clear()
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('willow.')) localStorage.removeItem(k)
      // Demo flag, goals draft and judge tour live in sessionStorage.
      for (const k of Object.keys(sessionStorage)) if (k.startsWith('willow.')) sessionStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}

/** Where to go after onboarding: only a path on this site (no "//host", "/\\host" or control tricks). */
export function nextPath(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith('/') || [...raw].some((c) => c.charCodeAt(0) < 32 || c === '\\')) return fallback
  try {
    const url = new URL(raw, window.location.origin)
    return url.origin === window.location.origin ? `${url.pathname}${url.search}` : fallback
  } catch {
    return fallback
  }
}
