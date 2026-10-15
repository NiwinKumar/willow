import { Link, useLocation } from 'react-router-dom'

import { judge, JUDGE_STOPS } from '../../lib/judge'
import { useJudge } from '../../lib/useJudge'
import { leaveDemo, useData } from '../../data/useData'

// Text links in the strip get a taller hit area without making the strip taller.
const action = 'relative -my-3 inline-flex min-h-11 items-center text-inverse underline underline-offset-4'

/**
 * The one mode indicator, owned by the shell (APP_PLAN.md): a black strip in mono caps. A sample run's
 * result says so first (the photos are the sample subject's, not yours); then the judge tour; then demo
 * mode. Nothing shows for a person's own results.
 */
export function ModeBanner() {
  const data = useData()
  const tour = useJudge()
  const { pathname } = useLocation()
  const shownId = pathname.startsWith('/result/') ? decodeURIComponent(pathname.slice('/result/'.length).split('/')[0]) : null
  const sample = shownId ? Boolean(data.all.find((s) => s.id === shownId)?.sample_id) : false
  if (!sample && !tour.on && data.mode !== 'demo') return null
  const text = sample
    ? '■ SAMPLE RUN · REAL PIPELINE · SAMPLE SUBJECT, NOT YOUR SKIN'
    : tour.on
      ? `■ JUDGE TOUR · ${tour.seen.length} OF ${JUDGE_STOPS.length} STOPS${data.mode === 'demo' ? " · OUR TEAM'S MEASURED JOURNEY, READ-ONLY" : ' · YOUR OWN GUEST ACCOUNT'}`
      : "■ DEMO JOURNEY · OUR TEAM'S OWN PHOTOS, MEASURED BY THE LIVE ENGINE · READ-ONLY"
  return (
    <div role="note" className="relative z-[21] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-selected px-4 py-2.5 text-center font-mono text-[12px] tracking-[.06em] text-inverse">
      <span>{text}</span>
      {tour.on ? (
        <>
          <Link to="/judge" className={action}>
            Back to the tour
          </Link>
          <button type="button" onClick={() => judge.stop()} className={`${action} bg-transparent font-mono text-[12px] tracking-[.06em]`}>
            End tour
          </button>
        </>
      ) : data.mode === 'demo' ? (
        <Link to="/" onClick={() => leaveDemo()} className={action}>
          Leave demo
        </Link>
      ) : null}
    </div>
  )
}
