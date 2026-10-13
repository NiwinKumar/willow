import type { User } from 'firebase/auth'
import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { DEV_UID } from './devAuth'

// The Firebase SDK is the largest piece of the first page; it loads right after first paint
// instead of blocking it. Every auth call awaits the same promise.
let sdk: Promise<typeof import('./firebase')> | null = null
const loadSdk = () => (sdk ??= import('./firebase'))

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
    let unsubscribe: (() => void) | undefined
    let alive = true
    void loadSdk().then(({ firebaseAuth, onAuthStateChanged }) => {
      if (!alive) return
      unsubscribe = onAuthStateChanged(firebaseAuth, (u) => {
        setUser(u)
        setLoading(false)
      })
    })
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      continueAsGuest: async () => {
        const f = await loadSdk()
        await f.signInAnonymously(f.firebaseAuth)
      },
      signInWithGoogle: async () => {
        const f = await loadSdk()
        await f.signInWithPopup(f.firebaseAuth, new f.GoogleAuthProvider())
      },
      signOutUser: async () => {
        const f = await loadSdk()
        await f.signOut(f.firebaseAuth)
      },
      getIdToken: async () => {
        if (devUser) return 'dev'
        const u = (await loadSdk()).firebaseAuth.currentUser
        if (!u) throw new Error('Not signed in')
        return u.getIdToken()
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

