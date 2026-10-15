import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useParams, type Location } from 'react-router-dom'
import { Toaster } from 'sonner'

import { AppShell } from './components/shell/AppShell'
import { CheckInOverlay } from './components/shell/CheckInOverlay'
import { ErrorBoundary } from './components/ErrorBoundary'
import { buttonClass } from './components/ui/Button'
import { WillowLoader } from './components/willow/WillowLoader'
import { DataProvider } from './data/store'
import Landing from './features/website/Landing'

const SignIn = lazy(() => import('./features/website/SignIn'))
const Welcome = lazy(() => import('./features/website/Welcome'))
const Judge = lazy(() => import('./features/website/Judge'))
const Retail = lazy(() => import('./features/retail/Retail'))
const Home = lazy(() => import('./features/home/Home'))
const Progress = lazy(() => import('./features/progress/Progress'))
const Result = lazy(() => import('./features/progress/Result'))
const ProductTest = lazy(() => import('./features/progress/ProductTest'))
const Routine = lazy(() => import('./features/routine/Routine'))
const You = lazy(() => import('./features/you/You'))

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
            <Route path="/retail" element={<Retail />} />
            <Route element={<AppShell />}>
              <Route path="/home" element={<Page><Home /></Page>} />
              <Route path="/progress" element={<Page><Progress /></Page>} />
              <Route path="/progress/:day" element={<Page><Progress /></Page>} />
              <Route path="/result" element={<Page><Result /></Page>} />
              <Route path="/result/:sessionId" element={<Page><Result /></Page>} />
              <Route path="/test" element={<Page><ProductTest /></Page>} />
              <Route path="/routine" element={<Page><Routine /></Page>} />
              <Route path="/you" element={<Page><You /></Page>} />
            </Route>
            {/* Old addresses (shared links, the judge notes) keep working. */}
            <Route path="/s/:site" element={<OldReport />} />
            <Route path="/capture/*" element={<Navigate to="/check-in" replace />} />
            <Route path="/processing/:sessionId" element={<OldProcessing />} />
            <Route path="/settings" element={<Navigate to="/you" replace />} />
            <Route path="/advisor" element={<Navigate to="/home?advisor=1" replace />} />
            <Route path="/retailer" element={<Navigate to="/retail" replace />} />
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
      <Toaster
        position="bottom-center"
        offset={104}
        toastOptions={{ unstyled: true, classNames: { toast: 'flex items-center gap-3 rounded-pill bg-selected px-[22px] py-3.5 text-[14px] text-inverse shadow-[0_20px_40px_-16px_rgba(0,0,0,.5)] max-w-[calc(100vw-32px)]', actionButton: 'rounded-pill bg-cta px-3 py-1 text-ink text-[13px]' } }}
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
  useEffect(() => {
    document.title = 'Page not found · Willow'
  }, [])
  return (
    <main className="mx-auto flex min-h-dvh max-w-[36rem] flex-col justify-center gap-4 px-5">
      <h1 className="font-serif text-greeting">This page does not exist</h1>
      <p className="text-[15px] text-ink-2">The link may be old or mistyped.</p>
      <a href="/home" className={`${buttonClass({ variant: 'ink' })} self-start no-underline`}>
        Go to Home
      </a>
    </main>
  )
}

const TITLES: [RegExp, string][] = [
  [/^\/judge/, 'Judge tour'],
  [/^\/signin/, 'Sign in'],
  [/^\/welcome/, 'Getting started'],
  [/^\/retail/, 'Retailer insights'],
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
    const t = TITLES.find(([re]) => re.test(pathname))?.[1]
    document.title = t ? `${t} · Willow` : 'Willow: did your serum actually work?'
  }, [pathname])
  return null
}
