import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import type { CaptureMode, Site } from '../../data/types'
import { useData } from '../../data/useData'
import { identity } from '../../lib/identity'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { prefs } from '../../lib/prefs'
import { useAuth } from '../../lib/useAuth'
import { WillowLoader } from '../willow/WillowLoader'
import { CanvasBlobs } from './CanvasBlobs'
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
  const [collapsed, setCollapsed] = useState(prefs.sidebarCollapsed)
  const [checkIn, setCheckIn] = useState<{ open: boolean; preset?: { site?: Site; mode?: CaptureMode } }>({ open: false })
  const [advisor, setAdvisor] = useState<{ open: boolean; ever: boolean; seed: AdvisorSeed | null }>({ open: false, ever: false, seed: null })
  const current = destinationOf(location.pathname)
  const me = identity(user)

  const openAdvisor = useCallback((text?: string, context?: string) => {
    setAdvisor((a) => ({ open: true, ever: true, seed: text ? { id: (a.seed?.id ?? 0) + 1, text, context } : a.seed }))
  }, [])
  const closeAdvisor = useCallback(() => setAdvisor((a) => ({ ...a, open: false })), [])
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
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      if ((e.key === 'n' || e.key === 'N') && data.mode === 'live' && !checkIn.open && !window.location.pathname.startsWith('/check-in')) {
        e.preventDefault()
        setCheckIn({ open: true })
      }
      if (e.key === 'Escape' && advisor.open && !document.querySelector('dialog[open]')) closeAdvisor()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advisor.open, checkIn.open, closeAdvisor, data.mode])

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
    if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }

  const panelOpen = advisor.open && wide && roomy
  return (
    <ShellContext.Provider value={api}>
      <div className="relative min-h-dvh overflow-x-clip pb-[140px] lg:pb-10">
        <CanvasBlobs />
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
            advisorOpen={advisor.open}
            onAdvisor={() => (advisor.open ? closeAdvisor() : openAdvisor())}
            name={me.short}
            initials={me.initials}
          />
        ) : (
          <Header current={current} name={me.short} initials={me.initials} />
        )}
        <div className="relative z-[1] transition-[padding] duration-[450ms] ease-spring" style={{ paddingLeft: wide ? (collapsed ? 89 : 236) : 0, paddingRight: panelOpen ? 464 : 0 }}>
          <Outlet />
        </div>
        {wide ? null : <Dock current={current} onCheckIn={() => setCheckIn({ open: true })} onAdvisor={() => (advisor.open ? closeAdvisor() : openAdvisor())} advisorOpen={advisor.open} />}
        <AdvisorHost open={advisor.open} mounted={advisor.ever} wide={wide} onClose={closeAdvisor} seed={advisor.seed} />
        {checkIn.open ? (
          <Suspense fallback={null}>
            <CheckInPicker open onClose={() => setCheckIn({ open: false })} preset={checkIn.preset} onStart={startCheckIn} />
          </Suspense>
        ) : null}
      </div>
    </ShellContext.Provider>
  )
}

/** The advisor's glass panel: right side on wide screens, full screen on phones. Mounted on first open, then kept. */
function AdvisorHost({ open, mounted, wide, onClose, seed }: { open: boolean; mounted: boolean; wide: boolean; onClose: () => void; seed: AdvisorSeed | null }) {
  const inset = wide ? 12 : 0
  return (
    <div
      role="dialog"
      aria-label="Advisor"
      aria-hidden={!open}
      inert={!open}
      className="fixed z-[45] flex flex-col overflow-hidden squircle backdrop-blur-[28px] backdrop-saturate-[1.5] transition-[translate,opacity] duration-[450ms] ease-spring"
      style={{
        top: inset,
        right: inset,
        bottom: inset,
        width: wide ? 'min(440px, calc(100vw - 24px))' : '100vw',
        borderRadius: wide ? 32 : 0,
        background: 'radial-gradient(120% 30% at 100% 0%, rgba(156,211,255,.4), transparent 70%), radial-gradient(140% 30% at 0% 100%, rgba(216,184,255,.35), transparent 70%), rgba(250,250,248,.92)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.75), 0 40px 80px -30px rgba(0,0,0,.4)',
        translate: open ? '0 0' : wide ? '24px 0' : '0 40px',
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {mounted ? (
        <Suspense fallback={<WillowLoader inline label="Opening the advisor" />}>
          <AdvisorPanel seed={seed} onClose={onClose} />
        </Suspense>
      ) : null}
    </div>
  )
}
