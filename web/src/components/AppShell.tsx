import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useData } from '../data/useData'
import { DemoBar } from './DemoBar'
import { Nav } from './NavSheet'

export function AppShell({ children }: { children: ReactNode }) {
  const data = useData()
  return (
    <div className="flex min-h-dvh flex-col">
      {data.mode === 'demo' ? <DemoBar /> : null}
      <header className="mx-auto flex h-14 w-full max-w-[1120px] items-center justify-between px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-signal-500" />
          Willow
        </Link>
        <Nav />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
