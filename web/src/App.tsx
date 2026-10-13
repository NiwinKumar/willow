import { Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'

import { AppShell } from './components/AppShell'
import { Landing } from './routes/Landing'
import { UploadTest } from './routes/UploadTest'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/upload-test" element={<UploadTest />} />
      </Routes>
      <Toaster position="bottom-center" />
    </AppShell>
  )
}
