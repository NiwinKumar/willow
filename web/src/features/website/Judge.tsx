import './website.css'

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import type { Session } from '../../data/types'
import { enterDemo, leaveDemo, useData } from '../../data/useData'
import { api } from '../../lib/api'
import { identity } from '../../lib/identity'
import { judge, JUDGE_STOPS, type JudgeStop } from '../../lib/judge'
import { useAuth } from '../../lib/useAuth'
import { CHIP_DOT, serviceChips, useDemoStatus } from '../../lib/useDemoStatus'
import { useJudge } from '../../lib/useJudge'
import { useSamples } from '../../lib/useSamples'
import { backButton, SoftBackdrop } from './Decor'
import { journeyLine, journeyUnavailableLine, useJourney } from './hooks'

const REPO = 'https://github.com/NiwinKumar/willow'
const ADVISOR_QUESTION = 'Is my routine OK together, and which sunscreen under ₹1,000 would fit it?'
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
const BACKDROP = 'radial-gradient(45% 45% at 10% 10%, rgba(122,92,255,.45), transparent 70%), radial-gradient(40% 45% at 90% 85%, rgba(255,178,122,.5), transparent 70%), var(--bg-canvas)'

const HONEST = [
  ['Numbers come from computer vision only.', 'Gemini never measures, scores skin, guesses age or tone, or diagnoses.'],
  ['Every Gemini answer is structured JSON checked against a schema.', 'A reply that does not fit is retried, then replaced by a plain template.'],
  ['Every number Gemini writes is checked.', 'A digit that is not in your measurements, your routine or a tool result rejects the answer.'],
  ['Products come only from tool calls.', 'The advisor can name a product only if the catalog search or comparison returned it.'],
  ['Routine clashes come from a rule table in code.', 'Gemini may add a finding, marked as AI-suggested, never remove one.'],
  ['The retailer assistant sees aggregates only.', 'No rows, groups under 10 people hidden; chart labels and values must exist in the data.'],
] as const

/**
 * The setup adds the routine only once (to an empty routine), so a second visit is told 0. What the first
 * visit added is kept for this tab, like the tour's progress, so stop 04 keeps describing it.
 */
const ROUTINE_KEY = 'willow.judgeRoutine'
function seededRoutine(uid: string, added: number): number {
  try {
    if (added > 0) sessionStorage.setItem(ROUTINE_KEY, `${uid}:${added}`)
    const [who, n] = (sessionStorage.getItem(ROUTINE_KEY) ?? '').split(':')
    return who === uid ? Number(n) || 0 : added
  } catch {
    return added
  }
}

/** idle covers "working on it": the guest account or the tour setup is on its way. */
type Setup = 'idle' | 'ready' | 'failed' | 'no-guest'

/** Each stop's look, from the design's tour cards (hue is decoration only). */
const LOOK: Record<JudgeStop, { bg: string; fg: string; dark?: boolean }> = {
  run: { bg: 'radial-gradient(90% 80% at 50% 100%, #F2B53A 0%, #F6DE5C 40%, #F5F0DA 85%)', fg: '#2A2410' },
  proof: { bg: 'radial-gradient(90% 80% at 50% 100%, #2F8A6A 0%, #8FC9B0 45%, #E3EFE9 85%)', fg: '#0E2A1E' },
  advisor: { bg: 'radial-gradient(90% 80% at 50% 100%, #3D7BFF 0%, #9CD3FF 45%, #E6EEF6 85%)', fg: '#0A1840' },
  routine: { bg: 'radial-gradient(90% 80% at 50% 100%, #FF6A1F 0%, #FFB27A 40%, #F4E5D8 80%)', fg: '#2A1206' },
  retailer: { bg: 'linear-gradient(180deg, #1A1A22 0%, #07070A 100%)', fg: '#FFFFFF', dark: true },
}

const STAMP = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false } as const

/** A previous sample run, in the design's "14 OCT 09:12 · 4 measured · 1 rejected" form, from the session itself. */
function runLine(s: Session): { when: string; result: string } {
  const when = new Date(s.created_at).toLocaleString('en-GB', STAMP).replace(',', '').toUpperCase()
  if (s.status === 'failed') return { when, result: s.error?.code === 'too_few_frames' ? 'no photo passed' : 'failed' }
  if (s.status !== 'done') return { when, result: s.status === 'uploading' ? 'uploading' : 'measuring' }
  const frames = s.result?.quality.per_frame
  if (!frames?.length) return { when, result: `${s.result?.frames_used ?? s.n_frames} measured` }
  const passed = frames.filter((f) => f.passed).length
  const rejected = frames.length - passed
  return { when, result: `${passed} measured${rejected ? ` · ${rejected} rejected` : ''}` }
}

/**
 * The judge tour (/judge): a guest account of the judge's own (POST /v1/demo/judge-setup seeds a small
 * routine), live service status, and five stops, each saying what kind of evidence it shows.
 */
export default function Judge() {
  const { user, loading, continueAsGuest, getIdToken } = useAuth()
  const navigate = useNavigate()
  const tour = useJudge()
  const samples = useSamples()
  const journey = useJourney()
  const status = useDemoStatus()
  const [setup, setSetup] = useState<Setup>('idle')
  const [routineAdded, setRoutineAdded] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const started = useRef<string | null>(null)
  const me = identity(user)

  useEffect(() => {
    document.title = 'Judge tour · Willow'
    judge.start()
    leaveDemo()
  }, [])

  // Judges never need to sign in: a guest account is made for them.
  useEffect(() => {
    if (loading || user) return
    continueAsGuest().catch(() => setSetup('no-guest'))
  }, [loading, user, continueAsGuest, attempt])

  useEffect(() => {
    if (!user || started.current === user.uid) return
    started.current = user.uid
    const uid = user.uid
    getIdToken()
      .then((t) => api.judgeSetup(t))
      .then((r) => {
        setRoutineAdded(seededRoutine(uid, r.routine_added))
        setSetup('ready')
      })
      // The api may still be waking up: Retry runs the setup again for the same account.
      .catch(() => setSetup('failed'))
  }, [user, getIdToken, attempt])

  // Previous sample runs come from the sessions the app already loads for this account (no second fetch).
  const data = useData()
  const prevRuns = data.mode === 'live' ? data.all.filter((s) => s.sample_id).reverse().slice(0, 3) : []

  const retry = () => {
    started.current = null
    setSetup('idle')
    setAttempt((n) => n + 1)
  }
  const ready = setup === 'ready' && Boolean(user)
  const failed = setup === 'failed' || setup === 'no-guest'
  const sample = samples.state === 'ready' ? samples.samples[0] : undefined
  const seen = (s: JudgeStop) => tour.seen.includes(s)
  // A stop that needs the guest account says why it is off: still setting up, or setup failed (Retry above).
  const needsGuest = failed ? 'Retry the setup above first' : 'Waiting for guest access'

  const go = (stop: JudgeStop, to: string, demo = false) => {
    judge.visit(stop)
    if (demo) enterDemo()
    else leaveDemo()
    navigate(to)
  }

  const guest = {
    title: ready ? (me.guest ? '✓ Guest access ready' : `✓ Signed in as ${me.email ?? me.name}`) : setup === 'no-guest' ? 'Could not make a guest account' : setup === 'failed' ? 'Tour setup failed' : 'Setting up guest access…',
    body: ready
      ? me.guest
        ? `A guest account of your own on this browser. Every stop runs the real api, engine and Gemini${routineAdded ? `; a ${routineAdded}-product routine was added for stop 04` : ''}.`
        : 'The stops use your own account and routine.'
      : setup === 'no-guest'
        ? 'The sign-in service didn’t respond. Retry, or open the retailer insights, which need no account.'
        : setup === 'failed'
          ? 'The api did not answer; it may still be waking up. Retry in a moment.'
          : 'Creating a guest account for this browser',
    bg: failed ? 'bg-coral text-ink' : ready ? 'bg-selected text-inverse' : 'bg-surface text-ink',
  }

  // Live checks from the api (engine, Gemini, storage, warehouse with latency; catalog size), never colour alone.
  const services = status.status ? serviceChips(status.status, status.gaveUp).filter((c) => c.key !== 'api') : []

  const stops: { id: JudgeStop; title: string; tag: string; body: string; cta: string; disabled?: string; act: () => void }[] = [
    {
      id: 'run',
      title: 'Actual sample run',
      tag: 'ACTUAL PROCESSING',
      body: sample
        ? `${sample.title}: ${sample.note}. ${sample.credit}. The photos are copied into your account and go through the real upload, quality checks and measurement.`
        : 'Sample photos of a consenting team member go through the real upload, quality checks and measurement.',
      cta: 'Run it',
      disabled: !ready ? needsGuest : samples.state === 'loading' ? 'Loading the samples' : !sample ? 'Sample photos are not available right now' : undefined,
      act: () => sample && go('run', `/check-in?${new URLSearchParams({ site: sample.site, mode: sample.capture_mode, sample: sample.id })}`),
    },
    {
      id: 'proof',
      title: 'Our team’s proof journey',
      tag: journey.state === 'unavailable' ? 'REAL JOURNEY · UNAVAILABLE' : 'REAL JOURNEY · READ-ONLY',
      body:
        journey.state === 'ready'
          ? `Our own photos, measured by the live engine: baseline, noise band and history. ${journeyLine(journey)}.`
          : journey.state === 'loading'
            ? 'Checking the journey…'
            : `${journeyUnavailableLine(journey)} The sample run in stop 01 shows the same pipeline on real photos.`,
      cta: 'Open the journey',
      disabled: journey.state === 'ready' ? undefined : journey.state === 'loading' ? 'Checking' : 'Unavailable',
      act: () => go('proof', '/home?demo=1', true),
    },
    {
      id: 'advisor',
      title: 'Advisor',
      tag: 'LIVE AI · TOOL CALLS',
      body: 'Gemini reads your results and routine, calls the catalog and the routine checker as tools, and may quote only measured numbers. The steps it took are shown with each answer.',
      cta: 'Ask a question',
      disabled: ready ? undefined : needsGuest,
      act: () => go('advisor', `/home?${new URLSearchParams({ advisor: '1', ask: ADVISOR_QUESTION })}`),
    },
    {
      id: 'routine',
      title: 'Routine and label scan',
      tag: 'LIVE AI · RULE TABLE',
      body: `${routineAdded ? 'Your guest routine pairs a retinoid with a BHA at night and has no sunscreen; the check finds both.' : 'The check runs on the routine in this account.'} Scan any ingredient label and Gemini reads it into a product.`,
      cta: 'Open routine',
      disabled: ready ? undefined : needsGuest,
      act: () => go('routine', '/routine'),
    },
    {
      id: 'retailer',
      title: 'Retailer insights',
      tag: 'SYNTHETIC COHORT',
      body: `What ${status.status?.bigquery.synthetic ? `${status.status.bigquery.synthetic} simulated people` : 'a simulated cohort'} were trying to change, which products reached real change, and where the gaps are. Groups under 10 people are never shown.`,
      cta: 'Open dashboard',
      act: () => go('retailer', '/retail'),
    },
  ]

  const count = NUMBER_WORDS[JUDGE_STOPS.length] ?? String(JUDGE_STOPS.length)

  return (
    <div className="relative flex min-h-dvh flex-col gap-[18px] overflow-x-clip p-[clamp(16px,3vw,32px)]">
      <SoftBackdrop background={BACKDROP} />
      <header className="relative flex flex-wrap items-center justify-between gap-3">
        <Link to="/about" aria-label="Back to start" className={backButton}>
          ←
        </Link>
        <div className="glass-pill flex items-center gap-2.5 rounded-pill py-1.5 pl-1.5 pr-4" style={{ background: 'rgba(255,255,255,.55)' }}>
          <span aria-hidden className="flex gap-1">
            {JUDGE_STOPS.map((s) => (
              <span key={s} className={`h-2 w-[26px] rounded-[8px] transition-colors duration-[400ms] ${seen(s) ? 'bg-selected' : 'bg-ink/15'}`} />
            ))}
          </span>
          <span className="text-[14px]">
            {tour.seen.length} of {JUDGE_STOPS.length} visited
          </span>
        </div>
        <span className="rounded-pill bg-selected px-4 py-2.5 font-mono text-[12px] text-inverse">{me.guest ? 'JUDGE · GUEST ACCESS' : 'JUDGE · SIGNED IN'}</span>
      </header>

      <main className="relative mx-auto flex w-full max-w-[1180px] animate-[wRiseLg_.6s_cubic-bezier(.2,.7,.2,1)_both] flex-col gap-[18px]">
        <div className="flex flex-wrap items-end justify-between gap-5 pt-[clamp(8px,3vw,32px)]">
          <h1 className="m-0 font-serif text-[clamp(46px,6.4vw,92px)] font-normal leading-[.92]">{count} stops through Willow</h1>
          <p className="m-0 max-w-[420px] leading-normal text-[#3E3C38]">Each stop says what kind of evidence it shows: actual processing, our team’s measured journey, live AI, or a synthetic cohort.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div role="status" aria-live="polite" className={`flex flex-[1_1_320px] flex-wrap items-center justify-between gap-3 rounded-[30px] px-5 py-[18px] transition-colors duration-[400ms] ${guest.bg}`}>
            <span className="flex flex-col gap-[3px]">
              <span className="text-[17px]">{guest.title}</span>
              <span className="text-[13px] opacity-85">{guest.body}</span>
            </span>
            {failed ? (
              <button type="button" onClick={retry} className="min-h-[46px] rounded-pill bg-white px-[18px] text-[14px] text-ink">
                Retry
              </button>
            ) : null}
          </div>
          <div aria-label="Service status" className="flex flex-[2_1_460px] flex-wrap items-center gap-2 rounded-[30px] px-4 py-3.5" style={{ background: 'rgba(250,250,248,.8)' }}>
            <span className="px-1.5 font-mono text-[11px] text-ink-2">■ SERVICE</span>
            {status.status ? (
              services.map((s) => (
                <span key={s.key} className="flex items-center gap-2 rounded-pill bg-white px-3 py-2 text-[13px]">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: CHIP_DOT[s.state] }} />
                  {s.label} <span className="font-mono text-[11px] text-ink-2">{s.note}</span>
                </span>
              ))
            ) : (
              <span className="px-1.5 text-[13px] text-ink-2">{status.failed ? 'The status check did not answer.' : 'Checking the services…'}</span>
            )}
          </div>
        </div>

        {/* Cards grow to fill the last row (five stops never leave a hole). */}
        <div className="flex flex-wrap gap-3.5">
          {stops.map((st, i) => {
            const look = LOOK[st.id]
            const visited = seen(st.id)
            return (
              <div
                key={st.id}
                className="relative flex min-h-[300px] flex-[1_1_340px] animate-[wRise_.5s_both] flex-col justify-between gap-4 rounded-[40px] p-6"
                style={{ background: look.bg, color: look.fg, boxShadow: 'inset 0 0 40px 6px rgba(255,255,255,.3), 0 30px 60px -44px rgba(0,0,0,.5)', animationDelay: `${i * 70}ms` }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-dot text-[44px] leading-none">{String(i + 1).padStart(2, '0')}</span>
                  <span className={`rounded-pill px-3 py-1.5 font-mono text-[11px] tracking-[.05em] text-ink ${look.dark ? 'bg-cta' : 'bg-white/60'}`}>{st.tag}</span>
                </span>
                <span className="flex flex-col gap-2">
                  <span className="text-[24px] leading-[1.15] tracking-[-0.02em]">{st.title}</span>
                  <span className="text-[14px] leading-[1.45] opacity-90">{st.body}</span>
                </span>
                {st.id === 'run' && prevRuns.length ? (
                  <span className="flex flex-col gap-1">
                    <span className="sr-only">Your previous sample runs</span>
                    {prevRuns.map((v) => {
                      const r = runLine(v)
                      return (
                        <Link key={v.id} to={`/result/${v.id}`} onClick={() => judge.visit('run')} className="flex min-h-9 items-center justify-between gap-2 rounded-[14px] bg-white/45 px-3 py-2 font-mono text-[12px] no-underline" style={{ color: look.fg }}>
                          <span>{r.when}</span>
                          <span>{r.result}</span>
                        </Link>
                      )
                    })}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={st.act}
                  disabled={Boolean(st.disabled)}
                  className={`flex min-h-12 items-center gap-2.5 self-start rounded-pill py-0 pl-[18px] pr-2 text-[14px] ${look.dark ? 'bg-white text-ink' : 'bg-selected text-inverse'}`}
                >
                  {st.disabled ?? (visited ? 'Visited · open again' : st.cta)}
                  <span aria-hidden className={`grid size-[34px] place-items-center rounded-full ${look.dark ? 'bg-selected text-inverse' : 'bg-white text-ink'}`}>
                    {visited ? '✓' : '→'}
                  </span>
                </button>
              </div>
            )
          })}
        </div>

        <section aria-labelledby="honest" className="glass mt-2 grid gap-6 rounded-[36px] p-[clamp(20px,3vw,32px)] md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex flex-col items-start gap-3">
            <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ HOW GEMINI IS KEPT HONEST</span>
            <h2 id="honest" className="m-0 font-serif text-[clamp(28px,3vw,40px)] font-normal leading-[1.05]">
              Measured by code, explained by Gemini, checked again.
            </h2>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center rounded-pill bg-white/70 px-4 text-[14px] text-ink no-underline hover:bg-white">
              Source code on GitHub ↗
            </a>
          </div>
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
            {HONEST.map(([t, d]) => (
              <li key={t} className="flex flex-col gap-1">
                <span className="text-[15px]">{t}</span>
                <span className="text-[13px] leading-[1.45] text-ink-2">{d}</span>
              </li>
            ))}
          </ul>
        </section>

        <button
          type="button"
          onClick={() => {
            judge.stop()
            judge.start()
          }}
          className="min-h-11 self-center px-[18px] text-[14px] underline"
        >
          Reset tour progress
        </button>
      </main>
    </div>
  )
}
