import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { DueDot, type Destination } from './Sidebar'

const LEFT = [
  { id: 'home', label: 'Home', to: '/home' },
  { id: 'progress', label: 'Progress', to: '/progress' },
] as const
const RIGHT = [
  { id: 'routine', label: 'Routine', to: '/routine' },
  { id: 'you', label: 'You', to: '/you' },
] as const

/**
 * Phone and narrow screens: glass bottom dock, Home · Progress · [Check in] · Routine · You. The black pill
 * glides to the current destination (as the sidebar's does) instead of jumping. (The advisor has its own
 * floating button: AdvisorFab.)
 */
export function Dock({ current, onCheckIn, due }: { current: Destination; onCheckIn: () => void; due?: string | null }) {
  const nav = useRef<HTMLElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number; on: boolean; glide: boolean }>({ x: 0, w: 0, on: false, glide: false })
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    const a = nav.current?.querySelector<HTMLElement>('a[aria-current="page"]')
    // The first placement is instant; every later one glides.
    setPill((p) => (a ? { x: a.offsetLeft, w: a.offsetWidth, on: true, glide: p.on } : { ...p, on: false }))
  }, [current, pathname])
  const item = (d: { id: string; label: string; to: string }) => (
    <Link key={d.id} to={d.to} viewTransition aria-current={current === d.id ? 'page' : undefined} className={`relative z-[1] flex min-h-12 items-center rounded-pill px-[15px] text-[14px] no-underline transition-[color,scale] duration-300 active:scale-95 ${current === d.id ? 'text-inverse' : 'text-ink'}`}>
      {d.label}
    </Link>
  )
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 z-[34] h-[150px]" style={{ background: 'linear-gradient(180deg, rgba(236,235,231,0), rgba(236,235,231,.94) 72%)' }} />
      <nav ref={nav} aria-label="App" className="fixed left-1/2 z-[35] flex -translate-x-1/2 items-center gap-0.5 rounded-pill border border-white/70 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_24px_48px_-20px_rgba(0,0,0,.35)] backdrop-blur-[30px] backdrop-saturate-[1.6]" style={{ bottom: 'max(14px, env(safe-area-inset-bottom))', background: 'rgba(250,250,248,.88)' }}>
        <span aria-hidden className={`pointer-events-none absolute top-1.5 bottom-1.5 left-0 z-0 rounded-pill bg-selected shadow-[0_10px_22px_-10px_rgba(0,0,0,.55)] ${pill.glide ? 'transition-[translate,width,opacity] duration-[420ms] ease-[cubic-bezier(.34,1.2,.5,1)] motion-reduce:transition-none' : ''}`} style={{ translate: `${pill.x}px 0`, width: pill.w, opacity: pill.on ? 1 : 0 }} />
        {LEFT.map(item)}
        <button type="button" onClick={onCheckIn} aria-label={due ? `Check in, ${due}` : 'Check in'} title={due ? `Check in · ${due}` : 'Check in'} className="cta-yellow group relative z-[1] mx-0.5 grid h-12 w-[52px] shrink-0 place-items-center rounded-[20px] squircle transition-[scale] duration-300 ease-bounce active:scale-[.92]">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="transition-[rotate] duration-300 ease-bounce group-active:rotate-90">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {due ? <DueDot className="top-2 right-2" /> : null}
        </button>
        {RIGHT.map(item)}
      </nav>
    </>
  )
}
