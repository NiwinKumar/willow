import { api, type CheckinSchedule, type PhotoTime, type Profile, type ProfilePatch, type SkinType } from './api'
import { cleanGoals, type GoalId } from './metrics'
import { prefs } from './prefs'

/**
 * The person's profile (users/{uid}.profile): goals, usual photo time, skin type and check-in schedule.
 * This device keeps a copy (lib/prefs) so screens order at once; once someone is signed in the account is the
 * source of truth: sign-in adopts the account's profile, and every change is written to it (data/store).
 * The display name is not kept here: it comes from the sign-in (lib/identity) and is only sent up.
 */
export type LocalProfile = { goals: GoalId[]; photo_time: PhotoTime | null; skin_type: SkinType | null; checkin: CheckinSchedule | null }

export const SKIN_TYPES: { id: SkinType; label: string }[] = [
  { id: 'oily', label: 'Oily' },
  { id: 'combination', label: 'Combination' },
  { id: 'dry', label: 'Dry' },
  { id: 'normal', label: 'Normal' },
  { id: 'sensitive', label: 'Sensitive' },
]

export const PHOTO_TIMES: { id: PhotoTime; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'midday', label: 'Midday' },
  { id: 'evening', label: 'Evening' },
]

/** Weekdays as the profile stores them: 0 = Monday … 6 = Sunday. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The check-in time a usual photo time suggests (24-hour HH:MM). */
export const PHOTO_TIME_CLOCK: Record<PhotoTime, string> = { morning: '08:00', midday: '13:00', evening: '20:00' }

/** This browser's IANA time zone ("Asia/Kolkata"); UTC when the browser does not say. */
export function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function localProfile(): LocalProfile {
  return { goals: prefs.goals(), photo_time: prefs.photoTime(), skin_type: prefs.skinType(), checkin: prefs.checkin() }
}

/** Write the fields of a patch to this device's copy. */
export function writeLocal(patch: ProfilePatch): void {
  if ('goals' in patch) prefs.setGoals(cleanGoals(patch.goals ?? []))
  if ('photo_time' in patch) prefs.setPhotoTime(patch.photo_time ?? null)
  if ('skin_type' in patch) prefs.setSkinType(patch.skin_type ?? null)
  if ('checkin' in patch) prefs.setCheckin(patch.checkin ?? null)
}

const isEmpty = (p: LocalProfile) => !p.goals.length && !p.photo_time && !p.skin_type && !p.checkin

/**
 * On sign-in: the account's profile wins and is copied here. An account with none yet (a new guest, or someone
 * from before profiles) gets this device's copy, as does a change made here that never reached the account.
 * `displayName` (from Google or email sign-up) fills an empty display_name.
 */
export async function syncProfile(getIdToken: () => Promise<string>, displayName: string | null): Promise<LocalProfile> {
  const token = await getIdToken()
  const { profile } = await api.me(token)
  const name = displayName && !profile?.display_name ? { display_name: displayName.slice(0, 60) } : {}
  if (profile && !prefs.profileDirty()) {
    adopt(profile)
    if (name.display_name) await api.putProfile(token, name)
  } else {
    const mine = localProfile()
    if (!isEmpty(mine) || name.display_name) await api.putProfile(token, { ...(isEmpty(mine) ? {} : mine), ...name })
    prefs.setProfileDirty(false)
  }
  return localProfile()
}

function adopt(p: Profile) {
  writeLocal({ goals: p.goals, photo_time: p.photo_time, skin_type: p.skin_type, checkin: p.checkin })
}

/** Send this device's whole copy (after a change); marked dirty until the account confirms it. */
export async function pushProfile(getIdToken: () => Promise<string>): Promise<void> {
  prefs.setProfileDirty(true)
  await api.putProfile(await getIdToken(), localProfile())
  prefs.setProfileDirty(false)
}
