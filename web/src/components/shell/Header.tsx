import { Link, useLocation } from 'react-router-dom'

import { Avatar } from '../willow/Avatar'
import { Logo } from '../willow/Logo'
import type { Destination } from './Sidebar'

/** The page eyebrow, per screen as drawn (a result and the product test name themselves, not their tab). */
const EYEBROW: [string, string][] = [
  ['/home', 'HOME'],
  ['/progress', 'PROGRESS'],
  ['/result', 'RESULT'],
  ['/test', 'PRODUCT TEST'],
  ['/routine', 'ROUTINE'],
  ['/you', 'YOU'],
]

/** Narrow screens (<900px): logo, page eyebrow, profile pill. */
export function Header({ current, name, initials }: { current: Destination; name: string; initials: string }) {
  const { pathname } = useLocation()
  const eyebrow = EYEBROW.find(([p]) => pathname.startsWith(p))?.[1]
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 py-3.5 backdrop-blur-[6px]" style={{ paddingInline: 'clamp(16px,4vw,40px)', background: 'linear-gradient(180deg, rgba(236,235,231,.94), rgba(236,235,231,0))' }}>
      <Logo to="/home" label="Willow, Home" />
      {eyebrow ? <span className="eyebrow min-w-0 truncate">■ {eyebrow}</span> : null}
      <Link to="/you" aria-label="You: profile and privacy" aria-current={current === 'you' ? 'page' : undefined} className={`glass-pill flex min-h-12 shrink-0 items-center gap-2 rounded-pill py-0 pr-1.5 pl-4 text-[14px] no-underline ${current === 'you' ? 'shadow-[inset_0_0_0_1.5px_var(--text-primary)]' : ''}`}>
        <span className="max-w-[9ch] truncate">{name}</span>
        <Avatar initials={initials} size={36} />
      </Link>
    </header>
  )
}
