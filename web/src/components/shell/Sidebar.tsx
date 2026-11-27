import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { LogoMark } from '../willow/Logo'
import { Avatar } from '../willow/Avatar'
import { Tooltip } from '../ui/Tooltip'
import type { CheckInState } from './checkInState'
import { NavIcon, type NavIconName } from './navIcons'

export type Destination = 'home' | 'progress' | 'routine' | 'you' | null

const NAV: { id: Exclude<Destination, 'you' | null>; label: string; to: string; icon: NavIconName }[] = [
  { id: 'home', label: 'Home', to: '/home', icon: 'home' },
  { id: 'progress', label: 'Progress', to: '/progress', icon: 'progress' },
  { id: 'routine', label: 'Routine', to: '/routine', icon: 'routine' },
]

/**
 * Wide screens (≥900px): the glass sidebar from the design, 212px open / 65px collapsed. A black pill
 * slides to the current destination; You sits at the foot. (The advisor has its own floating button: AdvisorFab.)
 * Collapsed, every icon gets a styled tooltip (components/ui/Tooltip) instead of the browser's slow title.
 * Check in shows its state as motion, not a dot: a slow halo while one is due, a tick once checked in today.
 */
export function Sidebar({ current, collapsed, onToggle, onCheckIn, checkIn, name, initials }: { current: Destination; collapsed: boolean; onToggle: () => void; onCheckIn: () => void; checkIn: CheckInState; name: string; initials: string }) {
  const nav = useRef<HTMLElement>(null)
  const [pill, setPill] = useState<{ top: number; on: boolean }>({ top: 0, on: false })
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    const a = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
    setPill(a ? { top: a.offsetTop, on: true } : (p) => ({ ...p, on: false }))
  }, [current, pathname, collapsed])
  const label = `overflow-hidden whitespace-nowrap transition-[opacity,translate] ${collapsed ? 'opacity-0 -translate-x-1.5 duration-150' : 'opacity-100 translate-x-0 duration-300 delay-100'}`
  const row = 'group relative flex h-10 w-full shrink-0 items-center gap-[11px] rounded-[25px] squircle pr-3.5 pl-[13.5px] text-[14px] whitespace-nowrap no-underline transition-[background,color] duration-300'
  return (
    <aside
      aria-label="Willow"
      className="glass fixed top-3 bottom-3 left-3 z-40 flex flex-col gap-3 overflow-hidden rounded-lg squircle px-2.5 pt-3.5 pb-3 transition-[width] duration-[450ms] ease-spring"
      style={{ width: collapsed ? 65 : 212, background: 'radial-gradient(140% 34% at 0% 100%, rgba(216,184,255,.38), transparent 70%), radial-gradient(120% 26% at 100% 0%, rgba(255,178,122,.28), transparent 70%), rgba(250,250,248,.8)' }}
    >
      <Link to="/home" aria-label="Willow, Home" className="flex h-10 shrink-0 items-center gap-[11px] pl-[7.5px] no-underline">
        <LogoMark size={30} />
        <span className={`text-[21px] font-light tracking-[-0.03em] ${label}`}>willow</span>
      </Link>
      <Tooltip content={checkIn.label} shortcut="N" disabled={!collapsed}>
        <button
          type="button"
          onClick={onCheckIn}
          aria-label={checkIn.kind === 'idle' ? 'Check in' : checkIn.label}
          data-state={checkIn.kind}
          className={`cta-yellow group relative flex h-10 w-full shrink-0 items-center gap-[11px] rounded-[25px] squircle pr-2.5 pl-[13.5px] text-[14px] whitespace-nowrap transition-[filter,scale] duration-200 hover:brightness-[1.04] active:scale-[.98] ${checkIn.kind === 'due' ? 'w-due' : 'overflow-hidden'}`}
        >
          <CheckInIcon state={checkIn.kind} size={18} />
          <span className={label}>{checkIn.kind === 'done' ? 'Checked in' : 'Check in'}</span>
          <kbd aria-hidden className={`ml-auto grid size-[22px] shrink-0 place-items-center rounded-[7px] bg-ink/8 font-mono text-[11px] ${label}`}>N</kbd>
        </button>
      </Tooltip>
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-0.5">
        <nav ref={nav} aria-label="App" className="relative flex flex-col gap-1">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-0 h-10 rounded-[25px] squircle bg-selected shadow-[0_10px_22px_-10px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.12)] transition-[translate,opacity] duration-500 ease-[cubic-bezier(.34,1.22,.5,1)]" style={{ translate: `0 ${pill.top}px`, opacity: pill.on ? 1 : 0 }} />
          {NAV.map((n) => {
            const on = current === n.id
            return (
              <Tooltip key={n.id} content={n.label} disabled={!collapsed}>
                <Link to={n.to} aria-current={on ? 'page' : undefined} aria-label={n.label} className={`${row} ${on ? 'text-inverse' : 'text-ink hover:bg-ink/6'}`}>
                  <NavIcon name={n.icon} active={on} />
                  <span className={`relative ${label}`}>{n.label}</span>
                </Link>
              </Tooltip>
            )
          })}
        </nav>
        <div className="min-h-2.5 flex-1" />
      </div>
      <Tooltip content="Expand sidebar" disabled={!collapsed}>
      <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} className={`${row} pl-[12.5px] text-[#3E3C38] hover:bg-ink/6 hover:text-ink`}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden className="shrink-0">
          <rect x="3" y="4.5" width="18" height="15" rx="4.5" />
          <rect x="6.2" y="7.6" height="8.8" rx="1.5" fill="currentColor" stroke="none" width={collapsed ? 2.4 : 5} className="transition-[width] duration-[450ms] ease-spring" />
        </svg>
        <span className={label}>{collapsed ? 'Expand' : 'Collapse'}</span>
      </button>
      </Tooltip>
      <Tooltip content={`${name} · goals, privacy`} disabled={!collapsed}>
      <Link to="/you" aria-current={current === 'you' ? 'page' : undefined} aria-label="You" className={`flex shrink-0 items-center gap-[11px] rounded-[25px] squircle py-0.5 pr-3 pl-[4.5px] no-underline transition-colors ${current === 'you' ? 'bg-white' : ''}`}>
        <span className="rounded-full shadow-[0_0_0_2px_rgba(255,255,255,.8)]">
          <Avatar initials={initials} size={36} />
        </span>
        <span className={`flex flex-col ${label}`}>
          <span className="text-[14px]">{name}</span>
          <span className="text-[12px] text-ink-2">You · goals, privacy</span>
        </span>
      </Link>
      </Tooltip>
    </aside>
  )
}

/**
 * The Check in button's glyph: a plus (with a slow quarter-turn nudge while a check-in is due, in step with
 * the button's halo), or a tick drawn once when today's check-in is in. Shared by the sidebar and the dock.
 */
export function CheckInIcon({ state, size }: { state: CheckInState['kind']; size: number }) {
  const icon = 'shrink-0 transition-[scale,translate] duration-300 ease-bounce group-hover:-translate-y-px group-hover:scale-[1.16] group-active:scale-[.85]'
  if (state === 'done') {
    return (
      <svg key="tick" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`w-tick ${icon}`}>
        <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
      </svg>
    )
  }
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center ${icon}`}>
      <svg key="plus" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={state === 'due' ? 'w-due-icon' : ''}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    </span>
  )
}
