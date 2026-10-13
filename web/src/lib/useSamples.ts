import { useEffect, useState } from 'react'

import { api, type DemoSample } from './api'

export type Load = { state: 'loading' } | { state: 'ready'; samples: DemoSample[] } | { state: 'error' }

/** Hosted sample photos (api demo/samples): one tap copies them into your own guest session and runs the real pipeline. */
export function useSamples(): Load {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  useEffect(() => {
    let alive = true
    api
      .demoSamples()
      .then((r) => alive && setLoad({ state: 'ready', samples: r.samples }))
      .catch(() => alive && setLoad({ state: 'error' }))
    return () => {
      alive = false
    }
  }, [])
  return load
}

