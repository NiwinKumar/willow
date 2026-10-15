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
  // Linking Google to a guest keeps the same User object (only isAnonymous flips): re-render.
  const [linked, setLinked] = useState(0)

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
        // Local test mode is already "signed in" as the fixed test person; never make a real Firebase guest.
        if (devUser) return
        const f = await loadSdk()
        // A page that asks before the saved sign-in is restored must not replace it with a new guest.
        await f.firebaseAuth.authStateReady()
        if (f.firebaseAuth.currentUser) return
        await f.signInAnonymously(f.firebaseAuth)
      },
      signInWithGoogle: async () => {
        const f = await loadSdk()
        await f.firebaseAuth.authStateReady()
        const current = f.firebaseAuth.currentUser
        const provider = new f.GoogleAuthProvider()
        if (current?.isAnonymous) {
          // Keep the guest's sessions: attach Google to the same account. If that Google account
          // already has its own Willow data, switch to it instead.
          try {
            await f.linkWithPopup(current, provider)
            setLinked((n) => n + 1)
            return
          } catch (e) {
            if ((e as { code?: string }).code !== 'auth/credential-already-in-use') throw e
          }
        }
        await f.signInWithPopup(f.firebaseAuth, provider)
      },
      signOutUser: async () => {
        const f = await loadSdk()
        await f.signOut(f.firebaseAuth)
      },
      getIdToken: async () => {
        if (devUser) return 'dev'
        const auth = (await loadSdk()).firebaseAuth
        await auth.authStateReady()
        const u = auth.currentUser
        if (!u) throw new Error('Not signed in')
        return u.getIdToken()
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- linked forces a new value after linking
    [user, loading, linked],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
