import { Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'

import { AppShell } from './components/AppShell'
import { BandBarDefs } from './components/BandBar'
import { DataProvider } from './data/store'
import { Landing } from './routes/Landing'
import { Report } from './routes/Report'
import { UploadTest } from './routes/UploadTest'

export default function App() {
  return (
    <DataProvider>
      <BandBarDefs />
      <Routes>
        <Route path="/s/:site" element={<Report />} />
        <Route
          path="*"
          element={
            <AppShell>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/upload-test" element={<UploadTest />} />
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
