import { createContext } from 'react'

import type { SessionView } from '../lib/api'
import type { Site, SiteSeries } from './types'

export type DataMode = 'demo' | 'live'
export type DataStatus = 'idle' | 'loading' | 'ready' | 'error'

export type DataState = {
  mode: DataMode
  /** demo only: real analyses of the team's consented captures, or the illustrative journey. */
  demoSource?: 'real' | 'illustrative'
  /** live: idle until someone is signed in, then loading -> ready (or error). demo is always ready. */
  status: DataStatus
  sites: Site[]
  series: (site: Site) => SiteSeries | null
  goals: string[]
  /** Re-read every session from the api (live) or do nothing (demo). */
  refresh: () => Promise<void>
  /** Put one fresh SessionView into the cache without a full reload. */
  upsert: (view: SessionView) => void
}

export const DataContext = createContext<DataState | null>(null)
