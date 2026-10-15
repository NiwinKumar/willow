import { createContext } from 'react'

import type { ProfilePatch, SessionView } from '../lib/api'
import type { LocalProfile } from '../lib/profile'
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
  /** Save goals (this device, and the account when signed in; demo: this tab) and redraw every screen that orders by them. */
  setGoals: (goals: string[]) => void
  /** This device's copy of the account's profile (users/{uid}.profile); the account's wins at sign-in. */
  profile: LocalProfile
  /** Change part of the profile: here at once, then on the account (rejects when the account could not be
   * reached; the change is kept here and sent on the next sign-in or load). */
  saveProfile: (patch: ProfilePatch) => Promise<void>
  /** Re-read every session from the api (live) or do nothing (demo). */
  refresh: () => Promise<void>
  /** Put one fresh SessionView into the cache without a full reload. */
  upsert: (view: SessionView) => void
}

export const DataContext = createContext<DataState | null>(null)
