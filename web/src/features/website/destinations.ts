import { useNavigate } from 'react-router-dom'

import { leaveDemo } from '../../data/useData'
import { useAuth } from '../../lib/useAuth'

/** The things a visitor can open from the website and the judge tour. */
export const JOURNEY_PATH = '/journey'
export const BRAND_JOURNEY_PATH = '/journey/brand'
export const PROOF_PATH = '/retail'

/**
 * "Open the Willow app": someone signed in (with an account, or as a guest already) goes to their own Home;
 * anyone else goes to sign-in, where they choose Google, email or a guest account. Mei's simulated account
 * opens from her journey, not from here.
 */
export function useOpenApp() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const signedIn = Boolean(user && !user.isAnonymous)
  const guest = Boolean(user?.isAnonymous)
  const open = () => {
    leaveDemo()
    navigate(user ? '/home' : '/signin?next=%2Fhome')
  }
  return { signedIn, guest, open }
}
