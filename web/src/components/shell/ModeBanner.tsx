import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { judge, JUDGE_STOPS, type JudgeStop } from '../../lib/judge'
import { useJudge } from '../../lib/useJudge'
import { leaveDemo, useData } from '../../data/useData'
import { useMaybeShell } from './ShellContext'

// Text links in the strip get a taller hit area without making the strip taller.
const action = 'relative -my-3 inline-flex min-h-11 items-center text-inverse underline underline-offset-4'

/** Sent when the strip appears, goes or changes height: the phone's Wisp button sits below it (AdvisorFab). */
export const MODE_BANNER_EVENT = 'willow-mode-banner'

const STOP_NAME: Partial<Record<JudgeStop, string>> = { proof: 'MEI’S JOURNEY', advisor: 'WISP', routine: 'ROUTINE' }

/**
 * The one mode indicator, owned by the shell (APP_PLAN.md): a black strip in mono caps. A sample run's
 * result says so first (the photos are the sample subject's, not yours); then the judge tour; then demo
 * mode. Nothing shows for a person's own results.
 *
 * On the tour it names the stop this page is ("STOP 4 OF 5 · ROUTINE") and counts a stop as visited however the
 * page was reached (the tour's own button, the tab bar, Wisp's button). Anywhere else in the app it says how
 * many stops have been visited, in those words, so the count is never read as a position.
 */
export function ModeBanner() {
  const data = useData()
  const tour = useJudge()
  const shell = useMaybeShell()
  const { pathname } = useLocation()
  const shownId = pathname.startsWith('/result/') ? decodeURIComponent(pathname.slice('/result/'.length).split('/')[0]) : null
  const sample = shownId ? Boolean(data.all.find((s) => s.id === shownId)?.sample_id) : false
  const stop: JudgeStop | null = !tour.on ? null : sample ? 'run' : data.mode === 'demo' ? 'proof' : shell?.advisorOpen ? 'advisor' : pathname.startsWith('/routine') ? 'routine' : null
  useEffect(() => {
    if (stop) judge.visit(stop)
  }, [stop])
  if (!sample && !tour.on && data.mode !== 'demo') return null
  const where = stop && STOP_NAME[stop] ? `STOP ${JUDGE_STOPS.indexOf(stop) + 1} OF ${JUDGE_STOPS.length} · ${STOP_NAME[stop]}` : `${tour.seen.length} OF ${JUDGE_STOPS.length} STOPS VISITED`
  const text = sample
    ? '■ SAMPLE RUN · REAL PIPELINE · SAMPLE SUBJECT, NOT YOUR SKIN'
    : tour.on
      ? `■ JUDGE TOUR · ${where}${data.mode === 'demo' ? ' · MEI, A SIMULATED PERSON, READ-ONLY' : ' · YOUR OWN GUEST ACCOUNT'}`
      : '■ DEMO JOURNEY · MEI IS SIMULATED: GENERATED PHOTOS, MEASURED BY THE LIVE ENGINE · READ-ONLY'
  return (
    <Strip label={tour.on ? 'Judge tour' : 'Demo journey'}>
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
    </Strip>
  )
}

/** The strip itself. It tells the shell when it appears, goes or changes height (its words wrap on a phone). */
function Strip({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const tell = () => window.dispatchEvent(new Event(MODE_BANNER_EVENT))
    tell()
    const ro = typeof ResizeObserver === 'undefined' || !ref.current ? null : new ResizeObserver(tell)
    if (ro && ref.current) ro.observe(ref.current)
    return () => {
      ro?.disconnect()
      // after React has removed the strip
      window.setTimeout(tell, 0)
    }
  }, [])
  return (
    <aside ref={ref} data-mode-banner aria-label={label} className="relative z-[21] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-selected px-4 py-2.5 text-center font-mono text-[12px] tracking-[.06em] text-inverse">
      {children}
    </aside>
  )
}
