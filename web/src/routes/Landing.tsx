import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { BandBar } from '../components/BandBar'
import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { Scrubber } from '../components/Scrubber'
import { Stage } from '../components/Stage'
import { peekDemo, pickDemo, subscribeDemo } from '../data/demoSource'
import { groupBySite, sitesWithResults } from '../data/live'
import { enterDemo, leaveDemo } from '../data/useData'
import { authErrorText } from '../lib/authErrors'
import { useAuth } from '../lib/useAuth'
import { fmtSigned, fmtValue } from '../lib/metrics'
import { DEMO_SERIES } from '../mock/series'
import { prefetchRoutes } from './lazy'

const SAMPLE_TO = '/s/forearm_treated?demo=1&t=3&m=tone_ita&layer=1'
const entries = [
  { title: 'Explore a sample journey', sub: 'A 4-day self-tanner split-arm test and a six-week face journey. Read-only.', eta: '~1 min', to: SAMPLE_TO, demo: true },
  { title: 'Run the pipeline on sample photos', sub: 'Real RAW photos, measured live in a guest account of your own.', eta: '~40 s', to: '/capture?sample=1', demo: false },
  { title: 'Measure your own skin', sub: 'A selfie, or a forearm with a phone or RAW photo. Your own baseline, really measured.', eta: '~2 min', to: '/capture?site=face_full&mode=quick', demo: false },
]

export function Landing() {
  const { user, loading, continueAsGuest, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const series = DEMO_SERIES.forearm_treated
  const control = DEMO_SERIES.forearm_control
  const [i, setI] = useState(3)
  const [touched, setTouched] = useState(false)
  useEffect(() => prefetchRoutes(['Judge', 'Report', 'Capture', 'QuickCapture']), [])
  // The sample entry says which journey it opens: the same pick demo mode will show.
  const pick = useSyncExternalStore(subscribeDemo, peekDemo)
  useEffect(() => void pickDemo(), [])
  const realSites = useMemo(() => (pick?.source === 'real' ? sitesWithResults(groupBySite(pick.views)) : []), [pick])
  const sample =
    pick?.source === 'real'
      ? { sub: "Our team's own photos, measured by the same engine as yours. Real data, read-only.", to: realSites.includes('forearm_treated') ? SAMPLE_TO : realSites[0] ? `/s/${realSites[0]}?demo=1` : SAMPLE_TO }
      : pick?.source === 'illustrative'
        ? { sub: 'A 4-day self-tanner split-arm test and a six-week face journey. Illustrative data, read-only.', to: SAMPLE_TO }
        : null
  const session = series.sessions[i]
  const baseline = series.sessions[0]
  const tone = session.result!.metrics.find((m) => m.id === 'tone_ita')!
  const toneBase = baseline.result!.metrics.find((m) => m.id === 'tone_ita')!
  const ctrl = control.sessions[i].result!.metrics.find((m) => m.id === 'tone_ita')!
  const ctrlBase = control.sessions[0].result!.metrics.find((m) => m.id === 'tone_ita')!
  const reach = useMemo(() => Math.max(...series.sessions.map((s) => Math.abs(s.result!.metrics[0].delta ?? 0))), [series])

  const go = (to: string, demo: boolean) => {
    // Your own photos always run live; only the sample entries switch the app to demo mode.
    if (demo) enterDemo()
    else leaveDemo()
    navigate(to)
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-5 pb-16 sm:px-8">
      <section className="grid gap-6 pt-6 lg:grid-cols-[1.05fr_1fr] lg:gap-x-12 lg:gap-y-0 lg:pt-12">
        <h1 className="max-w-[36rem] text-[clamp(36px,8vw,56px)] font-bold leading-[1.0] tracking-[-0.03em] lg:col-start-1">Did your serum actually work?</h1>

        {/* The live Lens: drag before you read. On phones it sits right under the headline. */}
        <div className="rounded-(--radius-tile) border border-border bg-surface p-3 sm:p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <span className="text-[13px] font-semibold">Self-tanner on one square, nothing on the other</span>
            <Chip tone="neutral">sample</Chip>
          </div>
          <div className="h-[260px] sm:h-[320px]">
            <Stage site="forearm_treated" session={session} baseline={baseline} metricId="tone_ita" layer={false} compact caption={session.hours_since_baseline ? `+${session.hours_since_baseline} h` : 'Baseline'} className="h-full" />
          </div>
          <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 px-1 text-[13px]">
            <span className="text-text-2">Treated</span>
            <BandBar value={tone.value} baseline={toneBase.value} mdc95={toneBase.mdc95} verdict={tone.verdict} reach={reach} label="Treated square skin tone" />
            <span className={`font-mono ${tone.verdict === 'real_change' ? 'text-signal-700' : 'text-text-2'}`}>{tone.delta === null ? '–' : fmtSigned(tone.delta, tone)}°</span>
            <span className="text-text-2">Untreated</span>
            <BandBar value={ctrl.value} baseline={ctrlBase.value} mdc95={ctrlBase.mdc95} verdict={ctrl.verdict} reach={reach} label="Untreated square skin tone" />
            <span className="font-mono text-text-2">{ctrl.delta === null ? '–' : fmtSigned(ctrl.delta, ctrl)}°</span>
          </div>
          <div className="mt-2">
            <Scrubber
              compact
              sessions={series.sessions}
              index={i}
              onChange={(n) => {
                setI(n)
                setTouched(true)
              }}
            />
          </div>
          <p className="px-1 pt-1 text-[12px] text-text-3">
            {touched ? `Noise band ±${fmtValue(toneBase.mdc95, tone)}° from five reference photos. ${tone.verdict === 'real_change' ? 'The treated square cleared it; the untreated one did not.' : 'Neither square has cleared it yet.'}` : 'Drag the handle to move through four days.'}
          </p>
        </div>

        <div className="max-w-[36rem] lg:col-start-1">
          <p className="text-[17px] leading-relaxed text-text-2">
            Willow measures your skin from standardized photos and tells you whether a change is real or just the camera. Every number comes from computer vision on your own photos; the AI only explains.
          </p>
          <Link to="/judge" className="mt-6 flex min-h-11 items-center justify-between gap-3 rounded-(--radius-control) bg-text px-4 py-3 text-surface transition-opacity hover:opacity-90">
            <span>
              <span className="block text-[15px] font-semibold">Judging Willow? Take the guided tour</span>
              <span className="block text-[13px] opacity-80">Five stops: four run live, one replays a finished test. No sign-in.</span>
            </span>
            <span className="shrink-0 whitespace-nowrap font-mono text-[13px] opacity-80">~4 min</span>
          </Link>
          <div className="mt-3 flex flex-col gap-3">
            {entries.map((x) => (x.demo && sample ? { ...x, ...sample } : x)).map((e) => (
              <Button key={e.title} variant="secondary" className="flex-col items-start !py-3 text-left" onClick={() => go(e.to, e.demo)}>
                <span className="flex w-full items-center justify-between">
                  <span className="font-semibold">{e.title}</span>
                  <span className="shrink-0 whitespace-nowrap font-mono text-[13px] text-text-3">{e.eta}</span>
                </span>
                <span className="text-[13px] font-normal text-text-2">{e.sub}</span>
              </Button>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-2">
            {loading ? (
              <span>Checking sign-in…</span>
            ) : user ? (
              <span>Signed in{user.isAnonymous ? ' as a guest' : user.email ? ` as ${user.email}` : ''}.</span>
            ) : (
              <>
                <span>No sign-in needed to try it.</span>
                <Button variant="quiet" className="!min-h-11 !px-2" onClick={() => continueAsGuest().catch((e) => { const t = authErrorText(e); if (t) toast.error(t) })}>
                  Continue as guest
                </Button>
                <Button variant="quiet" className="!min-h-11 !px-2" onClick={() => signInWithGoogle().catch((e) => { const t = authErrorText(e); if (t) toast.error(t) })}>
                  Sign in with Google to keep your results
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      <p className="mt-12 text-[12px] text-text-3">
        Cosmetic appearance tracking, not a medical device or diagnosis. Built on Firebase, Firestore, Cloud Run and Gemini on Vertex AI.
      </p>
    </div>
  )
}
