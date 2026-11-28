import { lazy, Suspense, useEffect, useState } from 'react'

const Celebration = lazy(() => import('../../features/plan/Celebration').then((m) => ({ default: m.Celebration })))

type Moment = { title: string; line: string }
const EVENT = 'willow:celebrate'

/** Show the routine garden from anywhere (a routine saved, the first own product added): one host in the shell,
 *  so every path to "your routine is set" ends the same way. */
export function celebrate(m: Moment) {
  window.dispatchEvent(new CustomEvent<Moment>(EVENT, { detail: m }))
}

export function CelebrationHost() {
  const [moment, setMoment] = useState<Moment | null>(null)
  useEffect(() => {
    const on = (e: Event) => setMoment((e as CustomEvent<Moment>).detail)
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  if (!moment) return null
  return (
    <Suspense fallback={null}>
      <Celebration title={moment.title} line={moment.line} onDone={() => setMoment(null)} />
    </Suspense>
  )
}
