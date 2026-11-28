import { useLocation, useNavigate } from 'react-router-dom'

import type { Session } from '../../data/types'
import { useSamples } from '../../lib/useSamples'
import { NextAction } from './ExplanationCard'

/**
 * Under a sample run's insights: what to do next. A sample baseline has nothing to be compared with yet, so
 * the next step is the sample that follows it (the same person, weeks later: api demo.py `after`), which is
 * measured for real and compared with this one. After a compared sample, the person's own check-in.
 */
export function SampleNext({ session, onOwn }: { session: Session; onOwn: () => void }) {
  const samples = useSamples()
  const navigate = useNavigate()
  const location = useLocation()
  const next = samples.state === 'ready' && session.is_baseline ? samples.samples.find((s) => s.after === session.sample_id) : undefined
  return (
    <>
      {next ? (
        <NextAction primary onClick={() => navigate(`/check-in?${new URLSearchParams({ site: next.site, mode: next.capture_mode, sample: next.id })}`, { state: { background: location } })}>
          Run the second sample to see a comparison
        </NextAction>
      ) : null}
      <NextAction onClick={onOwn}>Take your own check-in</NextAction>
    </>
  )
}
