import { Check, ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '../components/Button'
import { SampleRuns } from '../components/SampleRuns'
import { SystemStatus } from '../components/SystemStatus'
import { enterDemo, leaveDemo, useData } from '../data/useData'
import { api } from '../lib/api'
import { judge, type JudgeStop } from '../lib/judge'
import { useAuth } from '../lib/useAuth'
import { useSamples } from '../lib/useSamples'
import { useJudge } from '../lib/useJudge'

const REPO = 'https://github.com/NiwinKumar/willow'

const HONEST = [
  ['Numbers come from computer vision only.', 'Gemini never measures, scores skin, guesses age or tone, or diagnoses.'],
  ['Every Gemini answer is structured JSON checked against a schema.', 'A reply that does not fit is retried, then replaced by a plain template.'],
  ['Every number Gemini writes is checked.', 'A digit that is not in your measurements, your routine or a tool result rejects the answer.'],
  ['Products come only from tool calls.', 'The advisor can name a product only if search_catalog or compare_products returned it.'],
  ['Routine clashes come from a rule table in code.', 'Gemini may add a finding, marked as AI-suggested, never remove one.'],
] as const

/** /judge: the guided tour. A guest account of your own, five stops, every one of them live. */
export function Judge() {
  const { user, loading, continueAsGuest, signOutUser, getIdToken } = useAuth()
  const data = useData()
  const navigate = useNavigate()
  const tour = useJudge()
  const samples = useSamples()
  const [setup, setSetup] = useState<'idle' | 'working' | 'ready' | 'failed'>('idle')
  const [routineAdded, setRoutineAdded] = useState(0)
  const started = useRef<string | null>(null)

  // Judges never need to sign in: a fresh guest account is made for them.
  useEffect(() => {
    judge.start()
    leaveDemo()
  }, [])
  useEffect(() => {
    if (loading || user) return
    continueAsGuest().catch(() => setSetup('failed'))
  }, [loading, user, continueAsGuest])
  useEffect(() => {
    if (!user || started.current === user.uid) return
    started.current = user.uid
    setSetup('working')
    getIdToken()
      .then((t) => api.judgeSetup(t))
      .then((r) => {
        setRoutineAdded(r.routine_added)
        setSetup('ready')
      })
      .catch(() => setSetup('failed'))
  }, [user, getIdToken])

  const go = (stop: JudgeStop, to: string, demo = false) => {
    judge.visit(stop)
    if (demo) enterDemo()
    else leaveDemo()
    navigate(to)
  }
  const ran = (['forearm_treated', 'forearm_control', 'face_full'] as const)
    .flatMap((s) => data.series(s)?.sessions ?? [])
    .filter((s) => s.status === 'done')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const lastRun = ran[ran.length - 1]
  const seen = (s: JudgeStop) => tour.seen.includes(s)

  return (
    <div className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-4 sm:px-8">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
        <div>
          <h1 className="max-w-[34rem] text-[clamp(32px,6vw,44px)] font-bold leading-[1.05] tracking-[-0.03em]">Judging Willow</h1>
          <p className="mt-3 max-w-[36rem] text-[17px] leading-relaxed text-text-2">
            Five stops, about four minutes. Nothing here is a recording: you have a guest account of your own, photos are measured by the engine on Cloud Run, and Gemini answers live on Vertex AI.
          </p>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-2" role="status">
            <span aria-hidden className={`h-2 w-2 rounded-full ${setup === 'ready' ? 'bg-willow-500' : setup === 'failed' ? 'bg-danger' : 'animate-pulse bg-border'}`} />
            {setup === 'ready'
              ? `Your guest account is ready${routineAdded ? `, with a ${routineAdded}-product routine to check` : ''}.`
              : setup === 'failed'
                ? 'Could not make a guest account. Reload the page to try again.'
                : 'Making you a guest account…'}
            {setup === 'ready' && user?.isAnonymous ? (
              <button
                type="button"
                className="font-medium text-text underline-offset-2 hover:underline"
                onClick={() => {
                  judge.stop()
                  void signOutUser().then(() => judge.start())
                }}
              >
                Start fresh
              </button>
            ) : null}
          </p>

          <ol className="mt-8 border-t border-border">
            <Stop n={1} done={seen('run') || Boolean(lastRun)} title="Measure real photos" eta="about 40 s" tech="Cloud Run engine · RAW decoding · noise band · Gemini explanation">
              <p>
                One tap copies a set of consented RAW photos into your account and runs the full pipeline: quality checks, colour correction against a white reference, the measured square, then a plain-language explanation whose every number is checked.
              </p>
              <div className="mt-3">
                {samples.state === 'ready' && samples.samples.length ? (
                  <SampleRuns samples={samples.samples} onStart={() => judge.visit('run')} />
                ) : samples.state === 'loading' ? (
                  <p className="text-[13px] text-text-3">Loading the sample photos…</p>
                ) : (
                  <p className="text-[13px] text-text-2">
                    Sample photos are not available right now.{' '}
                    <Link to="/capture?site=forearm_control&mode=quick" className="font-medium text-text underline-offset-2 hover:underline" onClick={() => judge.visit('run')}>
                      Take a quick photo of your forearm instead
                    </Link>
                    .
                  </p>
                )}
                {lastRun ? (
                  <p className="mt-2 text-[13px]">
                    <Link to={`/s/${lastRun.site}`} className="font-medium text-willow-700 underline-offset-2 hover:underline">
                      Open your latest result
                    </Link>
                    <span className="text-text-2">. Run a second sample to see it compared with the first.</span>
                  </p>
                ) : null}
              </div>
            </Stop>
            <Stop n={2} done={seen('proof')} title="See how Willow proves a change" eta="about 1 min" tech="per-person noise band · treated vs untreated control">
              <p>A self-tanner split-forearm test over four days: one square treated, one left alone. Drag through time and watch the treated square clear its noise band while the control stays inside it.</p>
              <Button variant="secondary" className="mt-3" onClick={() => go('proof', '/s/forearm_treated?demo=1&t=3&m=tone_ita&layer=1', true)}>
                Open the test
              </Button>
            </Stop>
            <Stop n={3} done={seen('advisor')} title="Ask the advisor" eta="about 1 min" tech="Gemini function calling · 3 tools · number validator">
              <p>Gemini reads your results and routine, calls the catalog and the routine checker as tools, and answers with products and store links. The steps it took are shown above each answer.</p>
              <Button variant="secondary" className="mt-3" onClick={() => go('advisor', `/advisor?q=${encodeURIComponent('Is my routine OK together, and which sunscreen under ₹1,000 would fit it?')}`)}>
                Ask about my routine
              </Button>
            </Stop>
            <Stop n={4} done={seen('routine')} title="Check a routine, scan a label" eta="about 1 min" tech="rule table in code · Gemini vision for labels">
              <p>Your guest routine pairs a retinoid with a BHA at night and has no sunscreen. The check finds both. Scan any ingredient label with the camera or a photo and Gemini reads it into a product.</p>
              <Button variant="secondary" className="mt-3" onClick={() => go('routine', '/routine')}>
                Open the routine
              </Button>
            </Stop>
            <Stop n={5} done={seen('retailer')} title="See what a retailer learns" eta="about 30 s" tech="BigQuery · groups under 10 hidden · synthetic cohort labelled">
              <p>Outcomes, not purchases: which products produced real, measured change for which goals, from a labelled synthetic cohort of 500 people plus anyone who opted in.</p>
              <Button variant="secondary" className="mt-3" onClick={() => go('retailer', '/retailer')}>
                Open the retailer view
              </Button>
            </Stop>
          </ol>
          <p className="mt-6 text-[13px] text-text-2">
            Or look around on your own:{' '}
            <Link to="/capture?site=forearm_control&mode=quick" className="font-medium text-text underline-offset-2 hover:underline">
              photograph your own forearm
            </Link>{' '}
            or read{' '}
            <Link to="/science" className="font-medium text-text underline-offset-2 hover:underline">
              how the measurement works
            </Link>
            .
          </p>
        </div>

        <aside className="space-y-10 lg:pt-2">
          <section aria-labelledby="running">
            <h2 id="running" className="text-[17px] font-semibold">Running right now</h2>
            <div className="mt-3">
              <SystemStatus />
            </div>
          </section>
          <section aria-labelledby="honest">
            <h2 id="honest" className="text-[17px] font-semibold">How Gemini is kept honest</h2>
            <ul className="mt-3 space-y-3 text-[13px] leading-relaxed">
              {HONEST.map(([t, d]) => (
                <li key={t}>
                  <span className="block font-medium text-text">{t}</span>
                  <span className="block text-text-2">{d}</span>
                </li>
              ))}
            </ul>
          </section>
          <a href={REPO} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-(--radius-control) border border-border bg-surface px-4 text-[15px] font-medium hover:bg-surface-2">
            Source code on GitHub <ExternalLink size={14} aria-hidden />
          </a>
        </aside>
      </div>
    </div>
  )
}

function Stop({ n, title, eta, tech, done, children }: { n: number; title: string; eta: string; tech: string; done: boolean; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-3 border-b border-border py-6">
      <span aria-hidden className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-[13px] ${done ? 'bg-willow-500 text-surface' : 'bg-surface-2 text-text-2'}`}>
        {done ? <Check size={15} /> : n}
      </span>
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-baseline justify-between gap-x-3 text-[19px] font-semibold leading-snug">
          <span>
            {title}
            {done ? <span className="sr-only"> (done)</span> : null}
          </span>
          <span className="font-mono text-[12px] font-normal text-text-3">{eta}</span>
        </h2>
        <p className="mt-0.5 text-[12px] text-text-3">{tech}</p>
        <div className="mt-2 text-[15px] leading-relaxed text-text-2">{children}</div>
      </div>
    </li>
  )
}
