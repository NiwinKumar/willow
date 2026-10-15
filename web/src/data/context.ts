import { createContext } from 'react'

import type { SessionView } from '../lib/api'
import type { Session, Site, SiteSeries } from './types'

export type DataMode = 'demo' | 'live'
export type DataStatus = 'idle' | 'loading' | 'ready' | 'error'

export type DataState = {
  mode: DataMode
  /** live: idle until someone is signed in, then loading -> ready (or error). demo: loading -> ready, or
   * error when the team's journey cannot be read (there is no made-up fallback). */
  status: DataStatus
  sites: Site[]
  series: (site: Site) => SiteSeries | null
  /** Every session, oldest first, across sites. */
  all: Session[]
  goals: string[]
  /** Re-read every session from the api (live) or do nothing (demo). */
  refresh: () => Promise<void>
  /** Put one fresh SessionView into the cache without a full reload. */
  upsert: (view: SessionView) => void
}

export const DataContext = createContext<DataState | null>(null)
