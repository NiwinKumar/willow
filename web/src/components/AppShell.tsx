import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../lib/useAuth'

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOutUser } = useAuth()
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-14 w-full max-w-[1120px] items-center justify-between px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-signal-500" />
          Willow
        </Link>
        <nav className="flex items-center gap-4 text-[13px] text-text-2">
          <Link to="/science" className="hover:text-text">
            How it works
          </Link>
          {user ? (
            <button type="button" onClick={signOutUser} className="hover:text-text">
              Sign out{user.isAnonymous ? ' (guest)' : ''}
            </button>
          ) : null}
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
