import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import type { CaptureMode, Site } from '../../data/types'
import type { TrackPlace } from '../../lib/track'
import { useActivateData, useData } from '../../data/useData'
import { identity } from '../../lib/identity'
import { useKeyboardInset } from '../../lib/useKeyboardInset'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { prefs } from '../../lib/prefs'
import { useAuth } from '../../lib/useAuth'
import { useResultReady } from '../../features/progress/useResultReady'
import { WillowLoader } from '../willow/WillowLoader'
import { CanvasBlobs } from './CanvasBlobs'
import { CelebrationHost } from './CelebrationHost'
import { useCheckInState } from './checkInState'
import { AdvisorFab } from './AdvisorFab'
import { Dock } from './Dock'
import { Header } from './Header'
import { ModeBanner } from './ModeBanner'
import { MORPH_CLOSE_MS, MORPH_OPEN_MS, morph } from './morph'
import { ShellContext, type AdvisorSeed, type ShellApi } from './ShellContext'
import { Sidebar, type Destination } from './Sidebar'

const loadAdvisor = () => import('../../features/advisor/AdvisorPanel')
const AdvisorPanel = lazy(loadAdvisor)
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
  useActivateData()
  // "Your result is ready" on whichever page the person is on (never twice for one result).
  useResultReady()
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const wide = useMediaQuery('(min-width: 900px)')
  const roomy = useMediaQuery('(min-width: 1280px)')
  const phone = useMediaQuery('(max-width: 639px)')
  const [collapsed, setCollapsed] = useState(prefs.sidebarCollapsed)
  const [checkIn, setCheckIn] = useState<{ open: boolean }>({ open: false })
  const [advisor, setAdvisor] = useState<{ open: boolean; ever: boolean; seed: AdvisorSeed | null }>({ open: false, ever: false, seed: null })
  // The page makes room for the panel (wide screens): follows `advisor.open`, a beat later when a toggle
  // arrives while the page is still moving (morph.ts).
  const [room, setRoom] = useState(false)
  // The advisor as a full-screen chat (Expand, or ?advisor=full); the same chat, Esc or Collapse returns to the panel.
  const [advisorFull, setAdvisorFull] = useState(false)
  const current = destinationOf(location.pathname)
  // The Check in button's state: due (schedule in You), done today, or idle.
  const checkInState = useCheckInState()

  // A new page starts at the top (a #anchor scrolls itself); query changes keep the scroll.
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0 })
  }, [location.pathname])
  const me = identity(user)

  const openAdvisor = useCallback((text?: string, context?: string) => {
    morph(
      () => setAdvisor((a) => ({ open: true, ever: true, seed: text ? { id: (a.seed?.id ?? 0) + 1, text, context } : a.seed })),
      () => setRoom(true),
      'open',
    )
  }, [])
  const closeAdvisor = useCallback(() => {
    morph(
      () => setAdvisor((a) => ({ ...a, open: false })),
      () => setRoom(false),
      'close',
    )
    setAdvisorFull(false)
  }, [])
  const startCheckIn = useCallback(
    (site: Site, mode: CaptureMode, opts?: { sample?: string; places?: TrackPlace[]; upload?: boolean }) => {
      setCheckIn({ open: false })
      const qs = new URLSearchParams({ site, mode })
      if (opts?.sample) qs.set('sample', opts.sample)
      // A whole check-in: every tracked place in turn (CheckInFlow ?places=).
      if (opts?.places?.length) qs.set('places', opts.places.join(','))
      if (opts?.upload) qs.set('upload', '1') // each place opens the file picker instead of the camera
      // The flow draws over the page it was opened from (background location); Back walks its steps.
      const background = (location.state as { background?: unknown } | null)?.background ?? location
      navigate(`/check-in?${qs}`, { state: { background } })
    },
    [location, navigate],
  )

  // ?checkin=1 (the end of onboarding) opens the check-in sheet once.
  useEffect(() => {
    if (params.get('checkin') === null) return
    if (data.mode !== 'demo') setCheckIn({ open: true })
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.delete('checkin')
        return n
      },
      { replace: true },
    )
  }, [params, setParams, data.mode])

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
      openCheckIn: () => setCheckIn({ open: true }),
      closeCheckIn: () => setCheckIn({ open: false }),
      checkInOpen: checkIn.open,
      startCheckIn,
      openAdvisor,
      closeAdvisor,
      advisorOpen: advisor.open,
      advisorSeed: advisor.seed,
    }),
    [checkIn.open, startCheckIn, openAdvisor, closeAdvisor, advisor.open, advisor.seed, data],
  )

  // Wisp loads and renders (hidden) while the app is idle, so its first open is the panel itself, not a
  // loader that pops in step by step.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    idle(() => void loadAdvisor().then(() => setAdvisor((a) => (a.ever ? a : { ...a, ever: true }))))
  }, [])

  if (data.mode === 'live') {
    if (loading) return <WillowLoader label="Opening Willow" />
    if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }

  const panelOpen = room && wide && roomy
  // On phones the advisor covers the whole screen: the app behind it takes no focus or clicks.
  const covered = advisor.open && (phone || advisorFull)
  // The design pads the page around the sidebar (12px gutter + sidebar + 24px) and, when the advisor panel
  // fits beside the content (≥1280px), around the panel too.
  // Home fills the screen on a tall enough desktop window (features/home/Home.tsx sets html[data-home-fit]):
  // the bottom padding goes, so the page ends where the window does.
  const pad = wide ? { paddingLeft: collapsed ? 101 : 248, paddingRight: panelOpen ? 468 : 16, paddingTop: 16 } : undefined
  return (
    <ShellContext.Provider value={api}>
      <div className="relative min-h-dvh overflow-x-clip pb-[calc(140px+env(safe-area-inset-bottom))] min-[900px]:pb-28 [html[data-home-fit]_&]:pb-0" style={pad}>
        <CanvasBlobs />
        <div inert={covered || undefined}>
        <ModeBanner />
        {wide ? (
          <Sidebar
            current={current}
            collapsed={collapsed}
            onToggle={() => {
              const next = !collapsed
              prefs.setSidebarCollapsed(next)
              morph(() => undefined, () => setCollapsed(next), 'side')
            }}
            onCheckIn={() => setCheckIn({ open: true })}
            checkIn={checkInState}
            name={me.short}
            initials={me.initials}
          />
        ) : (
          <Header />
        )}
        <div data-willow-page className="relative z-[1] [view-transition-name:willow-page]">
          <Outlet />
        </div>
        {wide ? null : <Dock current={current} checkIn={checkInState} onCheckIn={() => setCheckIn({ open: true })} />}
        <CelebrationHost />
        </div>
        <AdvisorFab open={advisor.open} onToggle={() => (advisor.open ? closeAdvisor() : openAdvisor())} wide={wide} covered={advisor.open} />
        <AdvisorHost open={advisor.open} mounted={advisor.ever} phone={phone} onClose={closeAdvisor} seed={advisor.seed} full={advisorFull && !phone} onToggleFull={() => setAdvisorFull((f) => !f)} />
        {checkIn.open ? (
          <Suspense fallback={null}>
            <CheckInPicker open onClose={() => setCheckIn({ open: false })} onStart={(places, upload) => startCheckIn(places[0], 'uncalibrated', { places, upload })} />
          </Suspense>
        ) : null}
      </div>
    </ShellContext.Provider>
  )
}

/**
 * The advisor's glass panel: a floating right panel from 640px, full screen on phones (as drawn). Mounted
 * while the app is idle, then kept.
 *
 * Motion (shared element, transform/opacity/clip only, no layout per frame): the panel grows out of the Wisp
 * button. Its glass starts as the button's own circle, at the button's place, and opens to the panel's shape
 * (clip-path, the soft spring curve); the cat fades into it as it starts; the contents rise in a beat after
 * the glass, scaling from the button's corner. Closing runs the same path back into the button, quicker,
 * and the cat settles back as the glass lands. Every step is a CSS transition, so a toggle mid-flight
 * reverses from wherever it is. Expanding to full screen grows the glass from the panel's old shape.
 * Reduced motion: a short fade.
 * Focus moves into it on open and back to where it was on close.
 */
function AdvisorHost({ open, mounted, phone, onClose, seed, full, onToggleFull }: { open: boolean; mounted: boolean; phone: boolean; onClose: () => void; seed: AdvisorSeed | null; full: boolean; onToggleFull: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const glass = useRef<HTMLDivElement>(null)
  const shade = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLElement | null>(null)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
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
      const trigger = [...document.querySelectorAll<HTMLElement>('button[aria-label="Wisp"]')].find((b) => b.getClientRects().length > 0)
      ;(back.current?.isConnected ? back.current : trigger)?.focus({ preventScroll: true })
    }
  }, [open])
  const edge = phone || full
  const inset = edge ? 0 : 12
  const radius = edge ? 0 : 32
  // the glass's last open shape, so Expand can grow from it
  const shape = useRef<DOMRect | null>(null)
  const lastOpen = useRef(false)
  useLayoutEffect(() => {
    const host = panel.current
    const g = glass.current
    const sh = shade.current
    const c = inner.current
    if (!host || !g || !sh || !c) return
    const box = g.getBoundingClientRect()
    const fab = fabRect()
    // the button's circle in the glass's own coordinates (the panel's centre if the button isn't drawn)
    const at = fab ?? new DOMRect(box.left + box.width / 2 - 32, box.top + box.height / 2 - 32, 64, 64)
    const round = (r: DOMRect, rad: number) =>
      `inset(${r.top - box.top}px ${box.right - r.right}px ${box.bottom - r.bottom}px ${r.left - box.left}px round ${rad}px)`
    const whole = `inset(0px 0px 0px 0px round ${radius}px)`
    const button = round(at, at.width / 2)
    c.style.transformOrigin = `${at.left + at.width / 2 - box.left}px ${at.top + at.height / 2 - box.top}px`
    const resting = getComputedStyle(host).visibility === 'hidden'
    // open → open: the size changed (Expand, Collapse, a rotation); closed → open mid-fold: just reverse
    const resized = open && lastOpen.current
    lastOpen.current = open
    const instant = (el: HTMLElement, styles: Partial<CSSStyleDeclaration>) => {
      el.style.transition = 'none'
      Object.assign(el.style, styles)
    }
    if (reduced) {
      instant(g, { clipPath: 'none', opacity: '1' })
      instant(c, { transform: 'none', opacity: '1' })
      sh.style.opacity = edge ? '0' : '1'
      // (no transition on becoming visible: focus moves in at once)
      host.style.transition = open ? 'opacity .2s ease' : 'opacity .16s ease, visibility 0s linear .16s'
      host.style.opacity = open ? '1' : '0'
      host.style.visibility = open ? 'visible' : 'hidden'
      return
    }
    host.style.opacity = '1'
    if (open) {
      if (resting) {
        // begin exactly on the button: its circle, the cat still showing through
        instant(g, { clipPath: button, opacity: '0' })
        instant(c, { opacity: '0', transform: 'scale(.94)' })
        instant(sh, { opacity: '0' })
      } else if (resized && edge && shape.current) {
        // Expand: the glass grows from the side panel's shape to the whole screen
        instant(g, { clipPath: round(shape.current, 32) })
      } else if (resized) {
        // Collapse back to the side panel (or the screen size changed): the contents settle in again
        instant(c, { opacity: '0', transform: 'scale(.98)' })
      }
      void g.offsetWidth // the start above is the transition's first frame
      instant(host, { visibility: 'visible' })
      g.style.transition = `clip-path ${MORPH_OPEN_MS}ms var(--ease-spring), opacity 140ms ease-out`
      // (already whole and unclipped at rest: stays so)
      if (g.style.clipPath && g.style.clipPath !== 'none') g.style.clipPath = whole
      g.style.opacity = '1'
      c.style.transition = `opacity 260ms ease-out ${resting ? 110 : 0}ms, transform ${MORPH_OPEN_MS}ms var(--ease-spring)`
      c.style.opacity = '1'
      c.style.transform = 'none'
      sh.style.transition = `opacity 280ms ease-out ${resting ? MORPH_OPEN_MS - 240 : 0}ms`
      sh.style.opacity = edge ? '0' : '1'
      shape.current = edge ? null : box
      return
    }
    if (resting) return
    if (g.style.clipPath === 'none' || !g.style.clipPath) {
      instant(g, { clipPath: whole })
      void g.offsetWidth
    }
    g.style.transition = `clip-path ${MORPH_CLOSE_MS}ms var(--ease-spring), opacity 200ms ease-out ${MORPH_CLOSE_MS - 220}ms`
    g.style.clipPath = button
    g.style.opacity = '0'
    c.style.transition = `opacity 110ms ease-out, transform ${MORPH_CLOSE_MS}ms var(--ease-spring)`
    c.style.opacity = '0'
    c.style.transform = 'scale(.94)'
    sh.style.transition = 'opacity 120ms ease-out'
    sh.style.opacity = '0'
    host.style.transition = `visibility 0s linear ${MORPH_CLOSE_MS}ms`
    host.style.visibility = 'hidden'
    shape.current = null
  }, [open, edge, radius, reduced])
  // At rest the glass is unclipped (its squircle corners whole); the clip is only there while it moves.
  const settle = (e: React.TransitionEvent<HTMLDivElement>) => {
    const g = glass.current
    // (still open: the dialog's aria-hidden follows `open`)
    if (!g || e.target !== g || e.propertyName !== 'clip-path' || panel.current?.getAttribute('aria-hidden') === 'true') return
    g.style.transition = 'none'
    g.style.clipPath = 'none'
  }
  // Full screen: while typing, the panel spans only the visible area, so the composer sits on the keyboard.
  useKeyboardInset(open && edge)
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Wisp"
      aria-modal={edge || undefined}
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
      className="fixed z-[45] outline-none [view-transition-name:wisp-panel]"
      style={{
        top: inset || 'var(--kb-top, 0px)',
        right: inset,
        bottom: inset || 'var(--kb, 0px)',
        width: edge ? '100vw' : 'min(440px, calc(100vw - 24px))',
        visibility: 'hidden',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {/* the panel's shadow, apart from the glass so the clip never cuts it; it comes in as the glass lands */}
      <div ref={shade} aria-hidden className="pointer-events-none absolute inset-0 squircle" style={{ borderRadius: radius, boxShadow: '0 40px 80px -30px rgba(0,0,0,.4)', opacity: 0 }} />
      <div
        ref={glass}
        onTransitionEnd={settle}
        className="absolute inset-0 flex flex-col overflow-hidden squircle"
        style={{
          borderRadius: radius,
          // opaque on phones: nothing of the page (the mode strip) may show through the full-screen chat
          background: `radial-gradient(120% 30% at 100% 0%, rgba(156,211,255,.4), transparent 70%), radial-gradient(140% 30% at 0% 100%, rgba(216,184,255,.35), transparent 70%), ${edge ? '#FAFAF8' : 'rgba(250,250,248,.97)'}`,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.75)',
        }}
      >
        <div ref={inner} className="flex min-h-0 flex-1 flex-col">
          {mounted ? (
            <Suspense fallback={<WillowLoader inline label="Opening Wisp" />}>
              <AdvisorPanel seed={seed} onClose={onClose} full={full} onToggleFull={onToggleFull} />
            </Suspense>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** The Wisp button's resting circle on screen (its own scale while it hides is left out), or null. */
function fabRect(): DOMRect | null {
  const el = document.querySelector<HTMLElement>('[data-wisp-fab]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width) return null
  const size = el.offsetWidth
  return new DOMRect(r.left + r.width / 2 - size / 2, r.top + r.height / 2 - size / 2, size, size)
}
