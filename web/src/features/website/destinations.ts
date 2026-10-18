import { useNavigate } from 'react-router-dom'

import { enterDemo, leaveDemo } from '../../data/useData'
import { useAuth } from '../../lib/useAuth'

/** The things a visitor can open from the website and the judge tour. */
export const JOURNEY_PATH = '/journey'
export const BRAND_JOURNEY_PATH = '/journey/brand'
export const PROOF_PATH = '/retail'

/**
 * "Open the Willow app": someone signed in with an account goes to their own Home; anyone else (no account,
 * or a guest) opens Mei's simulated account read-only, the same way the journey's "Open Mei's app" does.
 */
export function useOpenApp() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const signedIn = Boolean(user && !user.isAnonymous)
  const open = () => {
    if (signedIn) {
      leaveDemo()
      navigate('/home')
    } else {
      enterDemo()
      navigate('/home?demo=1')
    }
  }
  return { signedIn, open }
}
