import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import type { CheckInState } from './checkInState'
import { NavIcon, type NavIconName } from './navIcons'
import { CheckInIcon, type Destination } from './Sidebar'

const TABS: { id: Exclude<Destination, null>; label: string; to: string; icon: NavIconName }[] = [
  { id: 'home', label: 'Home', to: '/home', icon: 'home' },
  { id: 'progress', label: 'Progress', to: '/progress', icon: 'progress' },
  { id: 'routine', label: 'Routine', to: '/routine', icon: 'routine' },
  { id: 'you', label: 'You', to: '/you', icon: 'you' },
]

/**
 * Phones and narrow screens: a glass tab bar holding the four destinations (icon over a short label, a black pill
 * sliding to the current one), and Check in as its own round yellow button beside it, the way iOS sets an action
 * apart from the tabs. The bar sits above the home indicator and Safari's toolbar (safe-area inset). Content
 * scrolls under it through a long, eased fade that never shows an edge. (The advisor lives in the header on
 * phones: AdvisorFab.)
 */
// The fade eases back out over EDGE at the screen's bottom: 28px in Safari (no bottom inset), 0 over a home
// indicator (Home Screen app), where it stays solid to the edge.
const EDGE = 'max(0px, calc(28px - env(safe-area-inset-bottom) * 100))'

export function Dock({ current, onCheckIn, checkIn }: { current: Destination; onCheckIn: () => void; checkIn: CheckInState }) {
  const bar = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  const [pill, setPill] = useState<{ x: number; w: number; on: boolean }>({ x: 0, w: 0, on: false })
  useLayoutEffect(() => {
    const measure = () => {
      const a = bar.current?.querySelector<HTMLElement>('[aria-current="page"]')
      setPill((p) => (a ? { x: a.offsetLeft, w: a.offsetWidth, on: true } : { ...p, on: false }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (bar.current) ro.observe(bar.current)
    return () => ro.disconnect()
  }, [current, pathname])
  return (
    <>
      {/* Eased fade (many stops, so no band is visible): the canvas comes up softly behind the bar, then eases out
          again at the screen's edge. Safari draws the page on under its own toolbar, so a fade that stayed solid to
          the edge showed as a hard line with content below it (EDGE). */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[34] h-[calc(120px+env(safe-area-inset-bottom))]"
        style={{
          background: [
            `linear-gradient(180deg, rgba(236,235,231,.82), rgba(236,235,231,.32) 55%, rgba(236,235,231,0)) bottom / 100% ${EDGE} no-repeat`,
            `linear-gradient(180deg, rgba(236,235,231,0) 0%, rgba(236,235,231,.04) 18%, rgba(236,235,231,.14) 36%, rgba(236,235,231,.32) 54%, rgba(236,235,231,.55) 72%, rgba(236,235,231,.75) 88%, rgba(236,235,231,.82) 100%) top / 100% calc(100% - ${EDGE}) no-repeat`,
          ].join(', '),
        }}
      />
      <div className="pointer-events-none fixed inset-x-0 z-[35] flex items-center justify-center gap-2.5 px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
        <nav
          ref={bar}
          aria-label="App"
          className="pointer-events-auto relative flex h-[60px] max-w-[360px] min-w-0 flex-1 items-stretch rounded-pill border border-white/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_20px_40px_-18px_rgba(0,0,0,.38)] backdrop-blur-[30px] backdrop-saturate-[1.6]"
          style={{ background: 'rgba(250,250,248,.8)' }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-pill bg-selected shadow-[0_8px_18px_-8px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.14)] transition-[translate,width,opacity] duration-[450ms] ease-[cubic-bezier(.34,1.22,.5,1)]"
            style={{ translate: `${pill.x}px 0`, width: pill.w, opacity: pill.on ? 1 : 0 }}
          />
          {TABS.map((t) => {
            const on = current === t.id
            return (
              <Link
                key={t.id}
                to={t.to}
                aria-current={on ? 'page' : undefined}
                className={`group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-pill text-[11px] leading-none no-underline transition-[color] duration-300 active:scale-[.96] ${on ? 'text-inverse' : 'text-ink'}`}
              >
                <NavIcon name={t.icon} active={on} size={21} />
                <span className="font-medium tracking-[.005em]">{t.label}</span>
              </Link>
            )
          })}
        </nav>
        <button
          type="button"
          onClick={onCheckIn}
          aria-label={checkIn.kind === 'idle' ? 'Check in' : checkIn.label}
          data-state={checkIn.kind}
          className={`cta-yellow group pointer-events-auto relative grid size-[60px] shrink-0 place-items-center rounded-full border border-white/60 transition-[scale] duration-300 ease-bounce active:scale-[.92] ${checkIn.kind === 'due' ? 'w-due' : ''}`}
        >
          <CheckInIcon state={checkIn.kind} size={22} />
        </button>
      </div>
    </>
  )
}
