/** Per-device preferences and consent record. Browser storage only, wrapped so private mode never throws.
 * Goals, photo time, skin type and the check-in schedule are a local copy of the account's profile (lib/profile). */
import type { CheckinSchedule, PhotoTime, SkinType } from './api'
import { cleanGoals, migrateGoals, type GoalId } from './metrics'

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
  /** The 8 goal ids (lib/metrics GOALS). A list saved under the old ids ('willow.goals') moves over once. */
  goals: (): GoalId[] => {
    const now = read<unknown>('willow.goals2')
    if (now !== null) return cleanGoals(now)
    const old = read<unknown>('willow.goals')
    if (old === null) return []
    const moved = migrateGoals(old)
    write('willow.goals2', moved)
    return moved
  },
  setGoals: (g: string[]) => write('willow.goals2', cleanGoals(g)),
  photoTime: (): PhotoTime | null => {
    const t = read<string>('willow.photoTime')
    return t === 'morning' || t === 'midday' || t === 'evening' ? t : null
  },
  setPhotoTime: (t: PhotoTime | null) => write('willow.photoTime', t),
  skinType: () => read<SkinType>('willow.skinType'),
  setSkinType: (t: SkinType | null) => write('willow.skinType', t),
  checkin: () => read<CheckinSchedule>('willow.checkin'),
  setCheckin: (c: CheckinSchedule | null) => write('willow.checkin', c),
  /** A profile change made here that the account has not confirmed yet (offline): sent on the next sync. */
  profileDirty: () => read<boolean>('willow.profileDirty') ?? false,
  setProfileDirty: (v: boolean) => write('willow.profileDirty', v),
  lightroomDone: () => read<boolean>('willow.lightroom') ?? false,
  setLightroomDone: (v: boolean) => write('willow.lightroom', v),
  sidebarCollapsed: () => read<boolean>('willow.sbCol') ?? false,
  setSidebarCollapsed: (v: boolean) => write('willow.sbCol', v),
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
