import './website.css'

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import type { Session } from '../../data/types'
import { enterDemo, leaveDemo, useActivateData, useData } from '../../data/useData'
import { api } from '../../lib/api'
import { aNum } from '../../lib/format'
import { identity } from '../../lib/identity'
import { judge, JUDGE_STOPS, type JudgeStop } from '../../lib/judge'
import { LANGUAGES } from '../../lib/language'
import { useAuth } from '../../lib/useAuth'
import { CHIP_DOT, serviceChips, useDemoStatus } from '../../lib/useDemoStatus'
import { useJudge } from '../../lib/useJudge'
import { useSamples } from '../../lib/useSamples'
import { evidence, money } from '../evidence/data'
import { backButton, SoftBackdrop } from './Decor'
import { DATA_LOCATION } from './dataLocation'
import { BRAND_JOURNEY_PATH, JOURNEY_PATH, PROOF_PATH } from './destinations'
import { journeyLine, journeyUnavailableLine, useJourney } from './hooks'
import { NoiseDemo } from './NoiseDemo'

const REPO = 'https://github.com/NiwinKumar/willow'
const ADVISOR_QUESTION = 'Is my routine OK together, and which sunscreen under ₹1,000 would fit it?'
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
const BACKDROP = 'radial-gradient(45% 45% at 10% 10%, rgba(122,92,255,.45), transparent 70%), radial-gradient(40% 45% at 90% 85%, rgba(255,178,122,.5), transparent 70%), var(--bg-canvas)'

/** The legal position in four lines (research/finals/04-legal-regulatory.md §7a); the full table is on /terms#safe. */
const SAFE: [string, string][] = [
  ['Wellness, not a medical device', 'Intended only for cosmetic appearance tracking, in the words Singapore’s HSA gives wellness products. No condition is named, no severity graded, no mole assessed.'],
  ['Cosmetics only, never medicines', 'Suggestions come from over-the-counter cosmetics sold in your market. Prescription and pharmacy actives are never suggested, and nothing says to start or stop a prescribed treatment.'],
  ['Safety rules in code, not Gemini', 'Pregnancy, sensitivities, reactions and ingredient flags come from a sourced rule table. A reported reaction gets fixed “stop and see a doctor” wording.'],
  ['Adults, separate consents, 30-day photos', '18+ only. Photos, AI processing and sharing are asked for separately. Photos are deleted after 30 days and face data is never used to recognise anyone.'],
]

const HONEST = [
  ['Numbers come from computer vision only.', 'Gemini never measures, scores skin, guesses age or tone, or diagnoses.'],
  ['Every Gemini answer is structured JSON checked against a schema.', 'A reply that does not fit is retried, then replaced by a plain template.'],
  ['Every number Gemini writes is checked.', 'A digit that is not in your measurements, your routine or a tool result rejects the answer.'],
  ['Products come only from tool calls.', 'Wisp can name a product only if the catalog search or comparison returned it.'],
  ['Routine clashes come from a rule table in code.', 'Gemini may add a finding, marked as AI-suggested, never remove one.'],
  ['The retailer assistant sees aggregates only.', 'No rows, groups under 10 people hidden; chart labels and values must exist in the data.'],
] as const

/** A cost row of evidence.json by its unit name, as "2.5¢" (cost_report.py writes them from production logs). */
const costOf = (unit: string) => {
  const row = evidence.cost?.rows.find((r) => r.unit === unit)
  return row ? money(row.usd) : null
}

type Faq = { q: string; a: string; to: string; link: string }
/**
 * The eight questions a judge is likely to ask, each answered in a sentence or two with a link to the live
 * evidence. Sources: docs/PRODUCT.md (who pays, cosmetic only), docs/DECISIONS.md (proof-gated promotion,
 * 30-day photos, consent), docs/METRICS.md (noise band), docs/EVALS.md and evidence.json (the figures).
 */
function faqs(): Faq[] {
  const checkIn = costOf('Face check-in')
  const answer = costOf('Wisp answer')
  const e = evidence.evals?.headline
  return [
    { q: 'Is the data real?', a: 'The measurements are: every number is computed from a photo by the engine. Mei’s photos are generated and Proof’s cohort is simulated, and both are labelled wherever they appear.', to: '/evidence#simulated', link: 'What is simulated' },
    { q: 'How was the measurement validated?', a: 'Against itself. Each reading is judged against the spread of your own baseline photos. It is not clinically validated. An instrument test on real photos across skin tones is done; repeat check-ins on real people over weeks are planned.', to: '/evidence#bands', link: 'The noise band' },
    {
      q: 'What does it cost to run?',
      a: checkIn && answer ? `About ${checkIn} for a face check-in and ${answer} for a Wisp answer, from medians in the production logs at list prices.` : 'Cost per check-in and per answer is measured from the production logs.',
      to: '/evidence#cost',
      link: 'Cost per use',
    },
    { q: 'What happens to my photos?', a: `${DATA_LOCATION.where} ${DATA_LOCATION.leaves} Originals are deleted after 30 days. ${DATA_LOCATION.delete} Results reach a retailer only if you opt in, in groups of 10 or more.`, to: '/terms#where', link: 'Where it is kept' },
    { q: 'Is this medical?', a: 'No. It tracks cosmetic appearance only. No condition is named, nothing is graded, and suggestions are over-the-counter cosmetics.', to: '/terms#safe', link: 'What Willow never does' },
    { q: 'Who pays?', a: 'Shoppers use Willow free. Retailers pay for Proof, and a brand can pay that retailer to promote a product only once its measured evidence passes the bar.', to: PROOF_PATH, link: 'Open Proof' },
    { q: 'Why weekly photos?', a: 'Skin changes over weeks, and a single photo can just be a good-lighting day. The same day and time each week keeps photos comparable.', to: JOURNEY_PATH, link: 'Mei’s eight weeks' },
    {
      q: 'Why not let Gemini look at the photo and score it?',
      a: `A language model writes a plausible number whether or not it measured anything. So code measures and Gemini only explains${e ? `; in our evals a check had to reject ${e.first_try_rejected} of its ${e.answers} first answers` : ''}.`,
      to: '/evidence#checked',
      link: 'The eval results',
    },
  ]
}

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
  useActivateData()
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
    title: ready ? (me.guest ? '✓ Guest access ready' : `✓ Signed in as ${me.email ?? me.name}`) : setup === 'no-guest' ? 'Could not make a guest account' : setup === 'failed' ? 'Tour setup failed' : user ? 'Adding a sample routine…' : 'Making a guest account…',
    body: ready
      ? me.guest
        ? `A guest account of your own on this browser. Every stop runs the real api, engine and Gemini${routineAdded ? `; ${aNum(routineAdded)} ${routineAdded}-product routine was added for stop 04` : ''}.`
        : 'The stops use your own account and routine.'
      : setup === 'no-guest'
        ? 'The sign-in service didn’t respond. Retry, or open the retailer insights, which need no account.'
        : setup === 'failed'
          ? 'The api did not answer; it may still be waking up. Retry in a moment.'
          : // the step it is on: the sign-in, then the api's routine writes
            user
            ? 'Step 2 of 2: a small routine for stop 04, so the routine check has something real to read'
            : 'Step 1 of 2: a guest account of your own on this browser',
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
        : 'Hosted sample photos go through the real upload, quality checks and measurement.',
      cta: 'Run it',
      disabled: !ready ? needsGuest : samples.state === 'loading' ? 'Loading the samples' : !sample ? 'Sample photos are not available right now' : undefined,
      act: () => sample && go('run', `/check-in?${new URLSearchParams({ site: sample.site, mode: sample.capture_mode, sample: sample.id })}`),
    },
    {
      id: 'proof',
      title: 'Mei’s eight weeks, simulated',
      tag: journey.state === 'unavailable' ? 'SIMULATED JOURNEY · UNAVAILABLE' : 'SIMULATED JOURNEY · READ-ONLY',
      body:
        journey.state === 'ready'
          ? `A simulated person (generated photos), measured by the live engine: baseline, normal range, a rough week, what improved and what did not. ${journeyLine(journey)}.`
          : journey.state === 'loading'
            ? 'Checking the journey…'
            : `${journeyUnavailableLine(journey)} The sample run in stop 01 shows the same pipeline on her week-one photos.`,
      cta: 'Open the journey',
      disabled: journey.state === 'ready' ? undefined : journey.state === 'loading' ? 'Checking' : 'Unavailable',
      act: () => go('proof', JOURNEY_PATH),
    },
    {
      id: 'advisor',
      title: 'Wisp',
      tag: 'LIVE AI · TOOL CALLS',
      body: 'Gemini reads your results and routine, calls the catalog and the routine checker as tools, and may quote only measured numbers. The steps it took are shown with each answer.',
      cta: 'Ask a question',
      disabled: ready ? undefined : needsGuest,
      act: () => go('advisor', `/home?${new URLSearchParams({ advisor: '1', ask: ADVISOR_QUESTION })}`),
    },
    {
      id: 'routine',
      title: 'Routine and product photos',
      tag: 'LIVE AI · RULE TABLE',
      body: `${routineAdded ? 'Your guest routine pairs a retinoid with a BHA at night and has no sunscreen; the check finds both.' : 'The check runs on the routine in this account.'} Request a product with a photo of its pack and Gemini reads the brand and name, or finds it in the catalog.`,
      cta: 'Open routine',
      disabled: ready ? undefined : needsGuest,
      act: () => go('routine', '/routine'),
    },
    {
      id: 'retailer',
      title: 'Retailer insights',
      tag: 'SYNTHETIC COHORT',
      body: `What ${status.status?.bigquery.synthetic ? `${status.status.bigquery.synthetic.toLocaleString('en')} simulated people` : 'a simulated cohort'} were trying to change, which products reached real change, and where the gaps are. Groups under 10 people are never shown.`,
      cta: 'Open dashboard',
      act: () => go('retailer', PROOF_PATH),
    },
  ]

  const count = NUMBER_WORDS[JUDGE_STOPS.length] ?? String(JUDGE_STOPS.length)

  return (
    <div className="relative flex min-h-dvh flex-col gap-[18px] overflow-x-clip p-[clamp(16px,3vw,32px)]">
      <SoftBackdrop background={BACKDROP} />
      <header className="relative flex flex-wrap items-center justify-between gap-3">
        <Link to="/" aria-label="Back to start" className={backButton}>
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
            <span className="px-1.5 text-[13px] text-ink-2">Service</span>
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
                {st.id === 'proof' ? (
                  <Link to={BRAND_JOURNEY_PATH} className="flex min-h-11 items-center self-start text-[14px] underline underline-offset-4" style={{ color: look.fg }}>
                    Explore a brand’s journey <span aria-hidden className="ml-1.5">→</span>
                  </Link>
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

        <NoiseDemo />

        <ul aria-label="New in this build" className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          <li className="flex">
            <button
              type="button"
              onClick={() => go('advisor', '/home?advisor=1')}
              disabled={!ready}
              className="glass flex min-h-[76px] w-full flex-col items-start justify-center gap-1 rounded-[28px] px-5 py-3.5 text-left transition-[scale] duration-200 ease-standard active:scale-[.985] disabled:opacity-60"
            >
              <span className="text-[17px]">Talk to Wisp in your language <span aria-hidden>→</span></span>
              <span className="text-[13px] leading-[1.4] text-ink-2">{ready ? `Ask aloud or type, in any of ${LANGUAGES.length} languages. Spoken answers are checked as they play; a slip stops the audio and Wisp corrects it.` : needsGuest}</span>
            </button>
          </li>
          <li className="flex">
            <Link to="/evidence" className="glass flex min-h-[76px] w-full flex-col justify-center gap-1 rounded-[28px] px-5 py-3.5 text-ink no-underline transition-[scale] duration-200 ease-standard active:scale-[.985]">
              <span className="text-[17px]">How we know <span aria-hidden>→</span></span>
              <span className="text-[13px] leading-[1.4] text-ink-2">The eval results with their failures, what each check does, cost per use, and four ways to try to break Wisp.</span>
            </Link>
          </li>
        </ul>

        <section aria-labelledby="faq" className="glass mt-2 flex flex-col gap-5 rounded-[36px] p-[clamp(20px,3vw,32px)]">
          <h2 id="faq" className="m-0 font-serif text-[clamp(28px,3vw,40px)] font-normal leading-[1.05]">
            Eight fair questions, answered.
          </h2>
          <dl className="m-0 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {faqs().map((f) => (
              <div key={f.q} className="flex flex-col gap-1">
                <dt className="text-[15px]">{f.q}</dt>
                <dd className="m-0 text-[13px] leading-[1.45] text-ink-2">
                  {f.a}{' '}
                  <Link to={f.to} className="whitespace-nowrap text-ink underline underline-offset-2">
                    {f.link}
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="honest" className="glass mt-2 grid gap-6 rounded-[36px] p-[clamp(20px,3vw,32px)] md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex flex-col items-start gap-3">
            <h2 id="honest" className="m-0 font-serif text-[clamp(28px,3vw,40px)] font-normal leading-[1.05]">
              Measured by code, explained by Gemini, checked again.
            </h2>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center rounded-pill bg-white/70 px-4 text-[14px] text-ink no-underline hover:bg-white">
              Source code on GitHub ↗
            </a>
            <Link to="/evidence" className="inline-flex min-h-11 items-center rounded-pill bg-white/70 px-4 text-[14px] text-ink no-underline transition-colors duration-200 hover:bg-white">
              How we know: results and failures →
            </Link>
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

        <section aria-labelledby="safe" className="glass grid gap-6 rounded-[36px] p-[clamp(20px,3vw,32px)] md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex flex-col items-start gap-3">
            <h2 id="safe" className="m-0 font-serif text-[clamp(28px,3vw,40px)] font-normal leading-[1.05]">
              A cosmetic tracker, never a doctor.
            </h2>
            <Link to="/terms#safe" className="mt-1 inline-flex min-h-11 items-center rounded-pill bg-white/70 px-4 text-[14px] text-ink no-underline transition-colors duration-200 hover:bg-white">
              We do / we never do, in the terms →
            </Link>
          </div>
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
            {SAFE.map(([t, d]) => (
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
