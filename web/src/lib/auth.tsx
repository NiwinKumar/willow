import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
        const u = firebaseAuth.currentUser
        if (!u) throw new Error('Not signed in')
        return u.getIdToken()
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

