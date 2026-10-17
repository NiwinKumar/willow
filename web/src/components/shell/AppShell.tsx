import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import type { CaptureMode, Site } from '../../data/types'
import { useData } from '../../data/useData'
import { useCheckinDue } from '../../data/useCheckin'
import { identity } from '../../lib/identity'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { prefs } from '../../lib/prefs'
import { useAuth } from '../../lib/useAuth'
import { WillowLoader } from '../willow/WillowLoader'
import { CanvasBlobs } from './CanvasBlobs'
import { AdvisorFab } from './AdvisorFab'
import { Dock } from './Dock'
import { Header } from './Header'
import { ModeBanner } from './ModeBanner'
import { ShellContext, type AdvisorSeed, type ShellApi } from './ShellContext'
import { Sidebar, type Destination } from './Sidebar'

const AdvisorPanel = lazy(() => import('../../features/advisor/AdvisorPanel'))
const CheckInPicker = lazy(() => import('../../features/checkin/CheckInPicker'))

function destinationOf(path: string): Destination {
  if (path.startsWith('/home')) return 'home'
  if (path.startsWith('/progress') || path.startsWith('/result')) return 'progress'
  if (path.startsWith('/routine') || path.startsWith('/test')) return 'routine'
  if (path.startsWith('/you')) return 'you'
  return null
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/**
 * The app shell from "Willow App": sidebar (≥900px) or header + glass dock, the canvas blobs, one mode
 * banner, the right-side advisor panel (one chat for the whole app) and the check-in picker. Pages render
 * in the <Outlet/>. Everyone in here is signed in (guest is enough) or looking at the demo journey.
 */
export function AppShell() {
  const { user, loading } = useAuth()
  const data = useData()
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const wide = useMediaQuery('(min-width: 900px)')
  const roomy = useMediaQuery('(min-width: 1280px)')
  const phone = useMediaQuery('(max-width: 639px)')
  const [collapsed, setCollapsed] = useState(prefs.sidebarCollapsed)
  const [checkIn, setCheckIn] = useState<{ open: boolean; preset?: { site?: Site; mode?: CaptureMode } }>({ open: false })
  const [advisor, setAdvisor] = useState<{ open: boolean; ever: boolean; seed: AdvisorSeed | null }>({ open: false, ever: false, seed: null })
  // The advisor as a full-screen chat (Expand, or ?advisor=full); the same chat, Esc or Collapse returns to the panel.
  const [advisorFull, setAdvisorFull] = useState(false)
  const current = destinationOf(location.pathname)
  // The check-in schedule: the Check in button says when one is due today or late (null otherwise).
  const due = useCheckinDue()?.short ?? null

  // A new page starts at the top (a #anchor such as #spot-diary scrolls itself); query changes keep the scroll.
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0 })
  }, [location.pathname])
  const me = identity(user)

  const openAdvisor = useCallback((text?: string, context?: string) => {
    setAdvisor((a) => ({ open: true, ever: true, seed: text ? { id: (a.seed?.id ?? 0) + 1, text, context } : a.seed }))
  }, [])
  const closeAdvisor = useCallback(() => {
    setAdvisor((a) => ({ ...a, open: false }))
    setAdvisorFull(false)
  }, [])
  const startCheckIn = useCallback(
    (site: Site, mode: CaptureMode, opts?: { sample?: string }) => {
      setCheckIn({ open: false })
      const qs = new URLSearchParams({ site, mode })
      if (opts?.sample) qs.set('sample', opts.sample)
      // The flow draws over the page it was opened from (background location); Back walks its steps.
      const background = (location.state as { background?: unknown } | null)?.background ?? location
      navigate(`/check-in?${qs}`, { state: { background } })
    },
    [location, navigate],
  )

  // ?advisor=1 (old /advisor links, the judge tour) opens the panel once.
  useEffect(() => {
    if (params.get('advisor') === null) return
    const q = params.get('ask') ?? undefined
    openAdvisor(q)
    if (params.get('advisor') === 'full') setAdvisorFull(true)
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.delete('advisor')
        n.delete('ask')
        return n
      },
      { replace: true },
    )
  }, [params, setParams, openAdvisor])

  // N opens Check in (as drawn on the sidebar); Esc closes the advisor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Esc closes the advisor even from its own question field; N never fires while typing.
      if ((e.key === 'n' || e.key === 'N') && !typing(e.target) && data.mode === 'live' && !checkIn.open && !window.location.pathname.startsWith('/check-in')) {
        e.preventDefault()
        setCheckIn({ open: true })
      }
      if (e.key === 'Escape' && advisor.open && !document.querySelector('dialog[open]')) {
        if (advisorFull) setAdvisorFull(false)
        else closeAdvisor()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advisor.open, advisorFull, checkIn.open, closeAdvisor, data.mode])

  const api = useMemo<ShellApi>(
    () => ({
      openCheckIn: (preset) => setCheckIn({ open: true, preset }),
      closeCheckIn: () => setCheckIn({ open: false }),
      checkInOpen: checkIn.open,
      startCheckIn,
      openAdvisor,
      closeAdvisor,
      advisorOpen: advisor.open,
      advisorSeed: advisor.seed,
    }),
    [checkIn.open, startCheckIn, openAdvisor, closeAdvisor, advisor.open, advisor.seed],
  )

  if (data.mode === 'live') {
    if (loading) return <WillowLoader label="Opening Willow" />
    // No account yet: the first page (customers on to the front door: a new guest if this device already agreed, else onboarding).
    if (!user) return <Navigate to={`/?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }

  const panelOpen = advisor.open && wide && roomy
  // On phones the advisor covers the whole screen: the app behind it takes no focus or clicks.
  const covered = advisor.open && (phone || advisorFull)
  // The design pads the page around the sidebar (12px gutter + sidebar + 24px) and, when the advisor panel
  // fits beside the content (≥1280px), around the panel too.
  const pad = wide ? { paddingLeft: collapsed ? 101 : 248, paddingRight: panelOpen ? 468 : 16, paddingTop: 16 } : undefined
  return (
    <ShellContext.Provider value={api}>
      <div className="relative min-h-dvh overflow-x-clip pb-[140px] transition-[padding] duration-[450ms] ease-spring min-[900px]:pb-28" style={pad}>
        <CanvasBlobs />
        <div inert={covered || undefined}>
        <ModeBanner />
        {wide ? (
          <Sidebar
            current={current}
            collapsed={collapsed}
            onToggle={() => {
              prefs.setSidebarCollapsed(!collapsed)
              setCollapsed(!collapsed)
            }}
            onCheckIn={() => setCheckIn({ open: true })}
            due={due}
            name={me.short}
            initials={me.initials}
          />
        ) : (
          <Header current={current} name={me.short} initials={me.initials} />
        )}
        <div className="relative z-[1]">
          <Outlet />
        </div>
        {wide ? null : <Dock current={current} due={due} onCheckIn={() => setCheckIn({ open: true })} />}
        </div>
        <AdvisorFab open={advisor.open} onToggle={() => (advisor.open ? closeAdvisor() : openAdvisor())} wide={wide} covered={advisor.open} />
        <AdvisorHost open={advisor.open} mounted={advisor.ever} phone={phone} onClose={closeAdvisor} seed={advisor.seed} full={advisorFull && !phone} onToggleFull={() => setAdvisorFull((f) => !f)} />
        {checkIn.open ? (
          <Suspense fallback={null}>
            <CheckInPicker open onClose={() => setCheckIn({ open: false })} preset={checkIn.preset} onStart={startCheckIn} />
          </Suspense>
        ) : null}
      </div>
    </ShellContext.Provider>
  )
}

/**
 * The advisor's glass panel: a floating right panel from 640px, full screen on phones (as drawn). Mounted on
 * first open, then kept. It grows out of the advisor's cat button (scaled from the cat's centre, rounding
 * out to a soft pill as it shrinks) and folds back into it on close, staying visible until the fold has
 * finished. Reduced motion: a fade.
 * Focus moves into it on open and back to where it was on close.
 */
function AdvisorHost({ open, mounted, phone, onClose, seed, full, onToggleFull }: { open: boolean; mounted: boolean; phone: boolean; onClose: () => void; seed: AdvisorSeed | null; full: boolean; onToggleFull: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLElement | null>(null)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  // Scale about the cat button's centre (the panel's layout box, offsetLeft/Top, ignores the scale itself).
  useLayoutEffect(() => {
    const el = panel.current
    const cat = document.querySelector<HTMLElement>('button[aria-label="Advisor"]')?.parentElement
    if (!el || !cat) return
    const r = cat.getBoundingClientRect()
    el.style.transformOrigin = `${r.left + r.width / 2 - el.offsetLeft}px ${r.top + r.height / 2 - el.offsetTop}px`
  }, [open, phone, full])
  const wasOpen = useRef(false)
  useEffect(() => {
    const el = panel.current
    if (!el) return
    if (open) {
      wasOpen.current = true
      // <body> is no opener (Safari never focuses a clicked button; ?advisor=1 has none): the Advisor button then.
      back.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
      // The panel content may still be loading (first open): focus the panel now and its composer once it is there.
      el.focus({ preventScroll: true })
      let tries = 0
      const t = window.setInterval(() => {
        const input = el.querySelector<HTMLElement>('#ask-input') ?? el.querySelector<HTMLElement>('textarea, input')
        if (input && el.contains(document.activeElement)) input.focus({ preventScroll: true })
        if (input || ++tries > 20) window.clearInterval(t)
      }, 80)
      return () => window.clearInterval(t)
    }
    // Only a real close hands focus back (on first render the panel was never open: leave focus alone).
    if (!wasOpen.current) return
    wasOpen.current = false
    // Closing makes the panel inert, which may already have dropped focus to <body>.
    const a = document.activeElement
    if (!a || a === document.body || el.contains(a)) {
      // The opener may be gone (an "Ask" inside a sheet that closed): fall back to the Advisor button.
      const trigger = [...document.querySelectorAll<HTMLElement>('button[aria-label="Advisor"]')].find((b) => b.getClientRects().length > 0)
      ;(back.current?.isConnected ? back.current : trigger)?.focus({ preventScroll: true })
    }
  }, [open])
  const inset = phone || full ? 0 : 12
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Advisor"
      aria-modal={phone || full || undefined}
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
      className="fixed z-[45] flex flex-col overflow-hidden squircle outline-none backdrop-blur-[28px] backdrop-saturate-[1.5]"
      style={{
        top: inset,
        right: inset,
        bottom: inset,
        width: phone || full ? '100vw' : 'min(440px, calc(100vw - 24px))',
        borderRadius: !open && !reduced ? 160 : phone || full ? 0 : 32,
        background: 'radial-gradient(120% 30% at 100% 0%, rgba(156,211,255,.4), transparent 70%), radial-gradient(140% 30% at 0% 100%, rgba(216,184,255,.35), transparent 70%), rgba(250,250,248,.92)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.75), 0 40px 80px -30px rgba(0,0,0,.4)',
        scale: open || reduced ? '1' : '0.3',
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        pointerEvents: open ? 'auto' : 'none',
        // Opening springs out of the cat; closing is quicker and accelerates into it. Hidden only after the
        // fold, so closing animates too.
        transition: open
          ? 'scale .55s var(--ease-spring), opacity .22s ease, border-radius .45s var(--ease-spring), visibility 0s, width .45s var(--ease-spring), top .45s var(--ease-spring), right .45s var(--ease-spring), bottom .45s var(--ease-spring)'
          : 'scale .34s cubic-bezier(.55,0,.8,.3), opacity .2s ease .14s, border-radius .34s ease-in, visibility 0s linear .34s',
      }}
    >
      {mounted ? (
        <Suspense fallback={<WillowLoader inline label="Opening the advisor" />}>
          <AdvisorPanel seed={seed} onClose={onClose} full={full} onToggleFull={onToggleFull} />
        </Suspense>
      ) : null}
    </div>
  )
}
