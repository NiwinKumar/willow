import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { AuthProvider } from './lib/auth'

// After a deploy, a page opened earlier can ask for a script file the new release no longer has. Load the
// new version instead (once: a second failure within a minute is left to the page's own error handling).
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('willow.staleReload') ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('willow.staleReload', String(Date.now()))
  } catch {
    return // storage blocked: no loop guard, so don't reload automatically
  }
  e.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
