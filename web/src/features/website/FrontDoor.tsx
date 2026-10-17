import { useEffect, useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'

import { WillowLoader } from '../../components/willow/WillowLoader'
import { nextPath } from '../../lib/prefs'
import { useAuth } from '../../lib/useAuth'
import { hasConsent, isReturning } from './entry'

/**
 * The front door (/): no sign-in page first. Someone who has been here before (an account, or a guest who
 * already agreed on this device) goes straight into the app; a guest whose sign-in was lost but who agreed
 * here gets a new guest account and goes in too; anyone new starts onboarding (consent, goals), which makes
 * their guest account at its last step. Signing in with Google stays optional (You, /signin) for keeping
 * results across devices. The marketing page is at /about.
 */
export default function FrontDoor() {
  const { user, loading, continueAsGuest } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next')
  const [failed, setFailed] = useState(false)
  const agreedNoAccount = !loading && !user && hasConsent()
  // One guest account per visit (StrictMode runs effects twice in dev).
  const started = useRef(false)

  useEffect(() => {
    if (!agreedNoAccount || started.current) return
    started.current = true
    continueAsGuest().catch(() => setFailed(true))
  }, [agreedNoAccount, continueAsGuest])

  if (loading) return <WillowLoader label="Opening Willow" />
  if (isReturning(user)) return <Navigate to={nextPath(next, '/home')} replace />
  if (agreedNoAccount && !failed) return <WillowLoader label="Opening Willow" />
  // New here (or a guest who never agreed): consent and goals first, carrying where they were going.
  return <Navigate to={next ? `/welcome?next=${encodeURIComponent(nextPath(next, '/home'))}` : '/welcome'} replace />
}
