import { lazy, Suspense, useEffect } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useParams, type Location } from 'react-router-dom'
import { Toaster } from 'sonner'

import { CheckInOverlay } from './components/shell/CheckInOverlay'
import { ErrorBoundary } from './components/ErrorBoundary'
import { buttonClass } from './components/ui/Button'
import { WillowLoader } from './components/willow/WillowLoader'
import { journeyViews, warmFirstPhoto } from './data/demoSource'
import { DataProvider } from './data/store'
import { TourOverlay } from './features/tour/TourOverlay'
import { useAuth } from './lib/useAuth'
import Landing from './features/website/Landing'

// The landing page is the only eager screen: the app shell and every destination load on first visit.
const AppShell = lazy(() => import('./components/shell/AppShell').then((m) => ({ default: m.AppShell })))
const SignIn = lazy(() => import('./features/website/SignIn'))
const Welcome = lazy(() => import('./features/website/Welcome'))
const Judge = lazy(() => import('./features/website/Judge'))
const Journey = lazy(() => import('./features/journey/Journey'))
const BrandJourney = lazy(() => import('./features/journey/BrandJourney'))
const CheckInReplay = lazy(() => import('./features/journey/CheckInReplay'))
const AvatarLab = lazy(() => import('./features/lab/AvatarLab'))
const Terms = lazy(() => import('./features/website/Terms'))
const Retail = lazy(() => import('./features/retail/Retail'))
const Home = lazy(() => import('./features/home/Home'))
const Progress = lazy(() => import('./features/progress/Progress'))
const Result = lazy(() => import('./features/progress/Result'))
const ProductTest = lazy(() => import('./features/progress/ProductTest'))
const Routine = lazy(() => import('./features/routine/Routine'))
const You = lazy(() => import('./features/you/You'))

// Opened straight at Mei's story: her journey and first photo load while the page's code does.
if (window.location.pathname === '/journey') journeyViews().then(warmFirstPhoto, () => undefined)

/**
 * Routes. The website (landing, sign in, welcome, judge tour) and Retail stand alone; the app lives in one
 * shell (AppShell) with a real URL per destination. The check-in flow (/check-in) draws over the page it was
 * opened from (background location); opened directly, it draws over Home.
 */
export default function App() {
  const location = useLocation()
  const state = location.state as { background?: Location } | null
  const overlay = location.pathname.startsWith('/check-in')
  const background: Location | undefined = state?.background ?? (overlay ? { ...location, pathname: '/home', search: '', hash: '' } : undefined)
  return (
    <DataProvider>
      <PageTitle />
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<WillowLoader />}>
          {/* While the check-in draws over a page, that page is inert (no focus, no clicks behind the sheet). */}
          <div inert={overlay || undefined}>
          <Routes location={background ?? location}>
            <Route path="/" element={<Landing />} />
            <Route path="/science" element={<Landing />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/welcome/:step" element={<Welcome />} />
            <Route path="/judge" element={<Judge />} />
            <Route path="/journey" element={<Journey />} />
            <Route path="/journey/brand" element={<BrandJourney />} />
            <Route path="/terms" element={<Terms />} />
            {/* The assistant avatar in every state (not linked; for checking the motion). */}
            <Route path="/lab/avatar" element={<AvatarLab />} />
            <Route path="/retail/*" element={<Retail />} />
            <Route element={<AppShell />}>
              <Route path="/home" element={<Page><Home /></Page>} />
              <Route path="/progress" element={<Page><Progress /></Page>} />
              <Route path="/progress/:day" element={<Page><Progress /></Page>} />
              <Route path="/result" element={<Page><Result /></Page>} />
              <Route path="/result/:sessionId" element={<Page><Result /></Page>} />
              <Route path="/test" element={<Page><ProductTest /></Page>} />
              <Route path="/routine" element={<Page><Routine /></Page>} />
              <Route path="/you" element={<Page><You /></Page>} />
              <Route path="/replay/:day" element={<Page><CheckInReplay /></Page>} />
            </Route>
            {/* Old addresses (shared links, the judge notes) keep working. */}
            <Route path="/s/:site" element={<OldReport />} />
            <Route path="/capture/*" element={<Navigate to="/check-in" replace />} />
            <Route path="/processing/:sessionId" element={<OldProcessing />} />
            <Route path="/settings" element={<Navigate to="/you" replace />} />
            <Route path="/advisor" element={<Navigate to="/home?advisor=1" replace />} />
            <Route path="/retailer" element={<Navigate to="/retail" replace />} />
            <Route path="/privacy" element={<Navigate to="/terms" replace />} />
            <Route path="/start" element={<Navigate to="/welcome" replace />} />
            <Route path="/goals" element={<Navigate to="/welcome/goals" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </div>
          {background ? (
            <Routes>
              <Route path="/check-in" element={<CheckInOverlay />} />
            </Routes>
          ) : null}
        </Suspense>
      </ErrorBoundary>
      <TourOverlay />
      <Toaster
        position="bottom-center"
        offset={104}
        toastOptions={{ unstyled: true, classNames: { toast: 'flex items-center gap-3 rounded-[24px] bg-selected px-[22px] py-3.5 text-[14px] text-inverse shadow-[0_20px_40px_-16px_rgba(0,0,0,.5)] max-w-[calc(100vw-32px)]', actionButton: 'shrink-0 whitespace-nowrap min-h-9 rounded-pill bg-cta px-3.5 text-ink text-[13px]' } }}
      />
    </DataProvider>
  )
}

/** Each page gets the design's enter motion (rise + blur clear) and its own error boundary. */
function Page({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<WillowLoader inline />}>
        <div key={pathname.split('/')[1]} className="animate-[wPageIn_.36s_var(--ease-standard)_both]">
          {children}
        </div>
      </Suspense>
    </ErrorBoundary>
  )
}

function OldReport() {
  const { site } = useParams()
  return <Navigate to={`/result?site=${site ?? 'face_full'}`} replace />
}
function OldProcessing() {
  const { sessionId } = useParams()
  return <Navigate to={`/check-in?session=${sessionId ?? ''}`} replace />
}

function NotFound() {
  const { user, loading } = useAuth()
  useEffect(() => {
    document.title = 'Page not found · Willow'
  }, [])
  // Someone signed in goes back into the app; anyone else to the start (Home would only ask them to sign in).
  const inApp = loading || Boolean(user)
  return (
    <main className="mx-auto flex min-h-dvh max-w-[36rem] flex-col justify-center gap-4 px-5">
      <h1 className="font-serif text-greeting">This page does not exist</h1>
      <p className="text-[15px] text-ink-2">The link may be old or mistyped.</p>
      <Link to={inApp ? '/home' : '/'} className={`${buttonClass({ variant: 'ink' })} self-start no-underline`}>
        {inApp ? 'Go to Home' : 'Go to the start'}
      </Link>
    </main>
  )
}

const TITLES: [RegExp, string][] = [
  [/^\/science/, 'Science and limits'],
  [/^\/judge/, 'Judge tour'],
  [/^\/terms/, 'Terms and privacy'],
  [/^\/signin/, 'Sign in'],
  [/^\/welcome/, 'Getting started'],
  [/^\/home/, 'Home'],
  [/^\/progress/, 'Progress'],
  [/^\/result/, 'Result'],
  [/^\/test/, 'Product test'],
  [/^\/routine/, 'Routine'],
  [/^\/you/, 'You'],
  [/^\/check-in/, 'Check in'],
]

/** Each page names itself in the browser tab (and for screen readers announcing navigation). */
function PageTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    // Proof by Willow names its own tabs ("<Section> · Proof by Willow", features/retail/Retail.tsx).
    if (pathname.startsWith('/retail')) return
    const t = TITLES.find(([re]) => re.test(pathname))?.[1]
    document.title = t ? `${t} · Willow` : 'Willow: did your serum actually work?'
  }, [pathname])
  return null
}
