import { Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'

import { AppShell } from './components/AppShell'
import { BandBarDefs } from './components/BandBar'
import { DataProvider } from './data/store'
import { Advisor } from './routes/Advisor'
import { Capture } from './routes/Capture'
import { Goals } from './routes/Goals'
import { Judge } from './routes/Judge'
import { Landing } from './routes/Landing'
import { Processing } from './routes/Processing'
import { QuickCapture } from './routes/QuickCapture'
import { Retailer } from './routes/Retailer'
import { Routine } from './routes/Routine'
import { Science } from './routes/Science'
import { Settings } from './routes/Settings'
import { Report } from './routes/Report'
import { Start } from './routes/Start'
import { UploadTest } from './routes/UploadTest'

export default function App() {
  return (
    <DataProvider>
      <BandBarDefs />
      <Routes>
        <Route path="/s/:site" element={<Report />} />
        <Route path="/processing/:sessionId" element={<Processing />} />
        <Route path="/capture/camera" element={<QuickCapture />} />
        <Route
          path="*"
          element={
            <AppShell>
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
            </AppShell>
          }
        />
      </Routes>
      <Toaster position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--font-sans)' } }} />
    </DataProvider>
  )
}
