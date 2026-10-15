import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { pickDemo } from '../../data/demoSource'
import type { SessionView } from '../../lib/api'
import { authErrorText } from '../../lib/authErrors'
import { daysBetween, plural } from '../../lib/format'
import { SITE_LABEL } from '../../lib/metrics'
import { useAuth } from '../../lib/useAuth'
import { destinationAfterSignIn } from './entry'

const GOOGLE_FAILED = 'Google sign-in didn’t finish. Try again, or continue as a guest. Guest sessions stay on this browser.'

/** Google and guest buttons: pending state, one error slot, then on to consent or straight in (see entry.ts). */
export function useEntryActions(next: string | null = null) {
  const { signInWithGoogle, continueAsGuest, getIdToken } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState<null | 'google' | 'guest'>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (kind: 'google' | 'guest') => {
    if (pending) return
    setPending(kind)
    setError(null)
    try {
      await (kind === 'google' ? signInWithGoogle() : continueAsGuest())
    } catch (e) {
      setPending(null)
      if (kind === 'guest') return setError('Could not start a guest session. Check your connection and try again.')
      const code = (e as { code?: string })?.code
      const text = authErrorText(e)
      // A closed popup is not an error.
      if (text !== null) setError(code === 'auth/popup-blocked' || code === 'auth/network-request-failed' ? text : GOOGLE_FAILED)
      return
    }
    navigate(await destinationAfterSignIn(getIdToken, next))
  }
  return { pending, error, google: () => void run('google'), guest: () => void run('guest') }
}

export type Journey = { state: 'loading' } | { state: 'unavailable' } | { state: 'ready'; views: SessionView[]; checkIns: number; days: number; places: string }

/** The team's measured demo journey (GET /v1/demo/journey, shared with demo mode): is there one, and how long is it? */
export function useJourney(): Journey {
  const [journey, setJourney] = useState<Journey>({ state: 'loading' })
  useEffect(() => {
    let alive = true
    void pickDemo().then((p) => {
      if (!alive) return
      if (p.source !== 'real' || !p.views.length) return setJourney({ state: 'unavailable' })
      const dates = p.views.map((v) => v.session.created_at).sort()
      const sites = [...new Set(p.views.map((v) => v.session.site))]
      setJourney({
        state: 'ready',
        views: p.views,
        checkIns: p.views.length,
        days: Math.max(1, daysBetween(dates[0], dates[dates.length - 1])),
        places: sites.map((s) => SITE_LABEL[s]).join(' · '),
      })
    })
    return () => {
      alive = false
    }
  }, [])
  return journey
}

/** "6 check-ins over 4 days · Face · Forearm, treated" */
export function journeyLine(j: Extract<Journey, { state: 'ready' }>): string {
  return `${plural(j.checkIns, 'check-in', 'check-ins')} over ${plural(j.days, 'day', 'days')} · ${j.places}`
}
