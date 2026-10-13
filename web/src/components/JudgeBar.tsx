import { ArrowLeft } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { useData } from '../data/useData'
import { JUDGE_STOPS } from '../lib/judge'
import { useJudge } from '../lib/useJudge'

/** While the judge tour is on, a slim bar back to the stops (replaces the demo bar). */
export function JudgeBar() {
  const tour = useJudge()
  const data = useData()
  const { pathname } = useLocation()
  if (!tour.on || pathname === '/judge') return null
  return (
    <div role="status" className="flex min-h-10 items-center justify-between gap-3 bg-willow-100 px-5 text-[13px] text-willow-700 sm:px-8">
      <Link to="/judge" className="inline-flex min-h-9 items-center gap-1.5 font-semibold underline-offset-2 hover:underline">
        <ArrowLeft size={16} aria-hidden /> Judge tour
      </Link>
      <span className="truncate text-right">
        {data.mode === 'demo' ? 'Illustrative sample journey · ' : 'Live, in your guest account · '}
        {tour.seen.length} of {JUDGE_STOPS.length} stops
      </span>
    </div>
  )
}
