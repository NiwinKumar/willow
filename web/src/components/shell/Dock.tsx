import { Link } from 'react-router-dom'

import type { Destination } from './Sidebar'

const LEFT = [
  { id: 'home', label: 'Home', to: '/home' },
  { id: 'progress', label: 'Progress', to: '/progress' },
] as const
const RIGHT = [
  { id: 'routine', label: 'Routine', to: '/routine' },
  { id: 'you', label: 'You', to: '/you' },
] as const

/** Phone and narrow screens: glass bottom dock, Home · Progress · [Check in] · Routine · You, plus the advisor orb. */
export function Dock({ current, onCheckIn, onAdvisor, advisorOpen }: { current: Destination; onCheckIn: () => void; onAdvisor: () => void; advisorOpen: boolean }) {
  const item = (d: { id: string; label: string; to: string }) => (
    <Link key={d.id} to={d.to} aria-current={current === d.id ? 'page' : undefined} className={`flex min-h-12 items-center rounded-pill px-[15px] text-[14px] no-underline transition-colors duration-300 ${current === d.id ? 'bg-selected text-inverse' : 'text-ink'}`}>
      {d.label}
    </Link>
  )
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 z-[34] h-[150px]" style={{ background: 'linear-gradient(180deg, rgba(236,235,231,0), rgba(236,235,231,.94) 72%)' }} />
      <nav aria-label="App" className="fixed left-1/2 z-[35] flex -translate-x-1/2 items-center gap-0.5 rounded-pill border border-white/70 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_24px_48px_-20px_rgba(0,0,0,.35)] backdrop-blur-[30px] backdrop-saturate-[1.6]" style={{ bottom: 'max(14px, env(safe-area-inset-bottom))', background: 'rgba(250,250,248,.88)' }}>
        {LEFT.map(item)}
        <button type="button" onClick={onCheckIn} aria-label="Check in" title="Check in" className="cta-yellow mx-0.5 grid h-12 w-[52px] shrink-0 place-items-center rounded-[20px] squircle transition-[scale] duration-300 ease-bounce active:scale-[.92]">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        {RIGHT.map(item)}
      </nav>
      <button
        type="button"
        onClick={onAdvisor}
        aria-label="Advisor"
        aria-pressed={advisorOpen}
        title="Advisor"
        className="fixed right-4 z-[35] grid size-[54px] place-items-center rounded-full text-ink transition-[opacity,scale] duration-300 ease-bounce active:scale-[.92]"
        style={{ bottom: 'calc(max(14px, env(safe-area-inset-bottom)) + 76px)', opacity: advisorOpen ? 0 : 1, background: 'radial-gradient(circle at 35% 30%, #E6F3FF, var(--aura-ice) 45%, var(--aura-violet) 100%)', boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,.7), 0 14px 30px -10px rgba(61,123,255,.6)' }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
          <path d="M7 5h10a3 3 0 0 1 3 3v5.5a3 3 0 0 1-3 3h-4.5L8 20v-3.5H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z" />
        </svg>
      </button>
    </>
  )
}
