import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { DEV_UID } from './devAuth'
import { firebaseAuth } from './firebase'

export type AuthState = {
  user: User | null
  loading: boolean
  continueAsGuest: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOutUser: () => Promise<void>
  getIdToken: () => Promise<string>
}

const AuthContext = createContext<AuthState | null>(null)

export { AuthContext }

/** Local end-to-end runs: a fixed test person, no Firebase sign-in (see lib/devAuth.ts). */
const devUser = DEV_UID ? ({ uid: DEV_UID, isAnonymous: true, email: null } as unknown as User) : null

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(devUser)
  const [loading, setLoading] = useState(!devUser)

  useEffect(() => {
    if (devUser) return
    return onAuthStateChanged(firebaseAuth, (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      continueAsGuest: async () => {
        await signInAnonymously(firebaseAuth)
      },
      signInWithGoogle: async () => {
        await signInWithPopup(firebaseAuth, new GoogleAuthProvider())
      },
      signOutUser: () => signOut(firebaseAuth),
      getIdToken: async () => {
        if (devUser) return 'dev'
        const u = firebaseAuth.currentUser
        if (!u) throw new Error('Not signed in')
        return u.getIdToken()
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

