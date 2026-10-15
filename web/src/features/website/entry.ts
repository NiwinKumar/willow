import type { User } from 'firebase/auth'

import { api } from '../../lib/api'
import { CONSENT_VERSION, nextPath, prefs } from '../../lib/prefs'

/** A new person's first step after onboarding: their face baseline, quick photos (no RAW needed). */
export const FIRST_CHECKIN = '/check-in?site=face_full&mode=uncalibrated'

/** Consent to the current wording recorded on this device. */
export function hasConsent(): boolean {
  return prefs.consent()?.version === CONSENT_VERSION
}

/**
 * Someone who has been here before: signed in with an account, or a guest who already agreed on this
 * device. They get "Open Willow" and skip consent and goals.
 */
export function isReturning(user: User | null): boolean {
  return Boolean(user && (!user.isAnonymous || hasConsent()))
}

/**
 * Where to go right after signing in or continuing as a guest: straight on (to `next`, else Home) when
 * consent to this version exists, here or on the account (GET /v1/me, then kept on this device too);
 * otherwise through consent and goals first, carrying `next` along.
 */
export async function destinationAfterSignIn(getIdToken: () => Promise<string>, next: string | null): Promise<string> {
  const target = nextPath(next, '/home')
  if (hasConsent()) return target
  try {
    const me = await api.me(await getIdToken())
    const c = me.consent
    if (c?.version === CONSENT_VERSION) {
      prefs.setConsent({ version: c.version, accepted_at: c.accepted_at, aggregate_opt_in: c.aggregate_insights_opt_in })
      // Already on the account: nothing to sync back.
      prefs.setConsentSynced(`${me.uid}:${c.version}:${c.aggregate_insights_opt_in}`)
      return target
    }
  } catch {
    /* the api is unreachable: asking for consent again is the safe side */
  }
  if (next && nextPath(next, '').startsWith('/welcome')) return nextPath(next, '/welcome')
  return next ? `/welcome?next=${encodeURIComponent(target)}` : '/welcome'
}
