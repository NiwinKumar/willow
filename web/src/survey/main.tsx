import '../index.css'
import './survey.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import Survey from './Survey'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Survey />
  </StrictMode>,
)
