import { Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'

import { AppShell } from './components/AppShell'
import { BandBarDefs } from './components/BandBar'
import { DataProvider } from './data/store'
import { Landing } from './routes/Landing'
import { Advisor, Capture, Goals, Judge, Processing, QuickCapture, Report, Retailer, Routine, Science, Settings, Start, UploadTest } from './routes/lazy'

export default function App() {
  return (
    <DataProvider>
      <PageTitle />
      <BandBarDefs />
      <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/s/:site" element={<Report />} />
        <Route path="/processing/:sessionId" element={<Processing />} />
        <Route path="/capture/camera" element={<QuickCapture />} />
        <Route
          path="*"
          element={
            <AppShell>
              <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/judge" element={<Judge />} />
                <Route path="/start" element={<Start />} />
                <Route path="/goals" element={<Goals />} />
                <Route path="/capture" element={<Capture />} />
                <Route path="/routine" element={<Routine />} />
                <Route path="/advisor" element={<Advisor />} />
                <Route path="/retailer" element={<Retailer />} />
                <Route path="/science" element={<Science />} />
                <Route path="/settings" element={<Settings />} />
                {import.meta.env.DEV ? <Route path="/upload-test" element={<UploadTest />} /> : null}
                <Route path="*" element={<div className="px-5 py-12 text-text-2">Not found.</div>} />
              </Routes>
              </Suspense>
            </AppShell>
          }
        />
      </Routes>
      </Suspense>
      <Toaster position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--font-sans)' } }} />
    </DataProvider>
  )
}

/** Shown for the moment a page's code is loading; quiet, so a fast load just looks instant. */
function RouteLoading() {
  return <div role="status" aria-label="Loading" className="min-h-[40dvh]" />
}

const TITLES: [RegExp, string][] = [
  [/^\/judge/, 'Judge tour'],
  [/^\/s\//, 'Results'],
  [/^\/processing/, 'Measuring'],
  [/^\/capture\/camera/, 'Camera'],
  [/^\/capture/, 'New session'],
  [/^\/routine/, 'Routine'],
  [/^\/advisor/, 'Advisor'],
  [/^\/retailer/, 'Retailer insights'],
  [/^\/science/, 'How it works'],
  [/^\/settings/, 'Settings'],
  [/^\/(start|goals)/, 'Getting started'],
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
