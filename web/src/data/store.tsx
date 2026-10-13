/**
 * Data seam. Demo mode serves the illustrative sample journeys; live mode will read the api
 * (sessions list per site) once those routes exist (M2). Screens never know which one they got.
 */
import { useMemo, type ReactNode } from 'react'

import { DataContext, type DataState } from './context'
import { useSearchParams } from 'react-router-dom'

import { DEMO_SERIES, DEMO_SITES } from '../mock/series'

export type DataMode = 'demo' | 'live'



export function DataProvider({ children }: { children: ReactNode }) {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1' || sessionStorage.getItem('willow.demo') === '1'
  const value = useMemo<DataState>(() => {
    if (demo) {
      let goals: string[] = []
      try {
        goals = JSON.parse(sessionStorage.getItem('willow.goals') ?? '[]') as string[]
      } catch {
        goals = []
      }
      return { mode: 'demo', sites: DEMO_SITES, series: (site) => DEMO_SERIES[site] ?? null, goals: goals.length ? goals : ['even_tone', 'calmer'] }
    }
    return { mode: 'live', sites: [], series: () => null, goals: [] }
  }, [demo])
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

