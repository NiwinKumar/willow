import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

import { useAuth } from '../lib/useAuth'

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOutUser } = useAuth()
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1120px] flex-col px-5 sm:px-8">
      <header className="flex h-14 items-center justify-between border-b border-border">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-signal-500" />
          Willow
        </Link>
        <nav className="flex items-center gap-4 text-[13px] text-text-2">
          <Link to="/upload-test" className="hover:text-text">
            Upload test
          </Link>
          {user ? (
            <button type="button" onClick={signOutUser} className="hover:text-text">
              Sign out{user.isAnonymous ? ' (guest)' : ''}
            </button>
          ) : null}
        </nav>
      </header>
      <main className="flex-1 py-8">{children}</main>
      <footer className="border-t border-border py-4 text-[12px] text-text-3">
        Cosmetic appearance tracking, not a medical device or diagnosis. Built on Firebase, Firestore, Cloud Run and Gemini on Vertex AI.
      </footer>
    </div>
  )
}
