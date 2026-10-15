import { Link } from 'react-router-dom'

import { Avatar } from '../willow/Avatar'
import { Logo } from '../willow/Logo'
import type { Destination } from './Sidebar'

const EYEBROW: Record<string, string> = { home: 'HOME', progress: 'PROGRESS', routine: 'ROUTINE', you: 'YOU' }

/** Narrow screens (<900px): logo, page eyebrow, profile pill. */
export function Header({ current, eyebrow, name, initials }: { current: Destination; eyebrow?: string; name: string; initials: string }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 py-3.5 backdrop-blur-[6px]" style={{ paddingInline: 'clamp(16px,4vw,40px)', background: 'linear-gradient(180deg, rgba(236,235,231,.94), rgba(236,235,231,0))' }}>
      <Logo to="/home" label="Willow, Home" />
      <span className="eyebrow hidden truncate sm:block">■ {eyebrow ?? (current ? EYEBROW[current] : '')}</span>
      <Link to="/you" aria-label="You: profile and privacy" aria-current={current === 'you' ? 'page' : undefined} className={`glass-pill flex min-h-12 items-center gap-2 rounded-pill py-0 pr-1.5 pl-4 text-[14px] no-underline ${current === 'you' ? 'shadow-[inset_0_0_0_1.5px_var(--text-primary)]' : ''}`}>
        <span>{name}</span>
        <Avatar initials={initials} size={36} />
      </Link>
    </header>
  )
}
