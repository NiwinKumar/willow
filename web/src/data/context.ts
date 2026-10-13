import { createContext } from 'react'

import type { Site, SiteSeries } from './types'

export type DataMode = 'demo' | 'live'

export type DataState = {
  mode: DataMode
  sites: Site[]
  series: (site: Site) => SiteSeries | null
  goals: string[]
}

export const DataContext = createContext<DataState | null>(null)
