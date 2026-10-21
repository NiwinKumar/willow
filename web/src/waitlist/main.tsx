import '../index.css'
import './waitlist.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import Waitlist from './Waitlist'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Waitlist />
  </StrictMode>,
)
