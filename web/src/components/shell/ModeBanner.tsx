import { Link } from 'react-router-dom'

import { JUDGE_STOPS } from '../../lib/judge'
import { useJudge } from '../../lib/useJudge'
import { leaveDemo, useData } from '../../data/useData'

/**
 * The one mode indicator, owned by the shell (APP_PLAN.md): a black strip in mono caps. Judge tour wins
 * over demo mode; nothing shows for a person's own account.
 */
export function ModeBanner() {
  const data = useData()
  const tour = useJudge()
  if (!tour.on && data.mode !== 'demo') return null
  const text = tour.on
    ? `■ JUDGE TOUR · ${tour.seen.length} OF ${JUDGE_STOPS.length} STOPS${data.mode === 'demo' ? " · OUR TEAM'S MEASURED JOURNEY, READ-ONLY" : ' · YOUR OWN GUEST ACCOUNT'}`
    : "■ DEMO JOURNEY · OUR TEAM'S OWN PHOTOS, MEASURED BY THE LIVE ENGINE · READ-ONLY"
  return (
    <div role="note" className="relative z-[21] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-selected px-4 py-2.5 text-center font-mono text-[12px] tracking-[.06em] text-inverse">
      <span>{text}</span>
      {tour.on ? (
        <Link to="/judge" className="text-inverse underline underline-offset-4">
          Back to the tour
        </Link>
      ) : (
        <Link to="/" onClick={() => leaveDemo()} className="text-inverse underline underline-offset-4">
          Leave demo
        </Link>
      )}
    </div>
  )
}
