import './website.css'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import type { MetricId, Site } from '../../data/types'
import type { PhotoTime, SkinType } from '../../lib/api'
import { consentChoices, setConsentChoices, syncConsent } from '../../lib/consent'
import { CLOSE_UPS, GOALS, MAX_GOALS, METRIC_META, type GoalId } from '../../lib/metrics'
import { GOAL_LOOK } from '../plan/looks'
import { browserTz, PHOTO_TIME_CLOCK, PHOTO_TIMES, SKIN_TYPES, WEEKDAYS } from '../../lib/profile'
import { fmtDate } from '../../lib/format'
import { CONSENT_VERSION, nextPath, prefs } from '../../lib/prefs'
import { useActivateData, useData } from '../../data/useData'
import { TrackChoices } from '../checkin/TrackChoices'
import { placesOf } from '../../lib/profile'
import { choicesOf, trackOf, type TrackChoice } from '../../lib/track'
import { useAuth } from '../../lib/useAuth'
import { SoftBackdrop } from './Decor'
import { FIRST_CHECKIN, hasConsent } from './entry'
import { MeetWisp } from './MeetWisp'

const BACKDROP = 'radial-gradient(40% 40% at 15% 20%, rgba(255,178,122,.55), transparent 70%), radial-gradient(40% 45% at 85% 80%, rgba(156,211,255,.6), transparent 70%), radial-gradient(35% 35% at 80% 15%, rgba(216,184,255,.5), transparent 70%), var(--bg-canvas)'

type Step = 'consent' | 'goals' | 'places' | 'about' | 'routine' | 'wisp'
const STEPS = ['Consent', 'Goals', 'Places', 'About you', 'Routine', 'Meet Wisp', 'Capture']
const STEP_INDEX: Record<Step, number> = { consent: 0, goals: 1, places: 2, about: 3, routine: 4, wisp: 5 }
const PREV: Record<Step, string | null> = { consent: null, goals: '/welcome', places: '/welcome/goals', about: '/welcome/places', routine: '/welcome/about', wisp: '/welcome/routine' }
const PREV_NAME: Record<Step, string> = { consent: '', goals: 'consent', places: 'goals', about: 'places', routine: 'about you', wisp: 'your routine' }

/**
 * Onboarding: /welcome = consent, /welcome/goals = goals, /welcome/places = places to track (every check-in covers
 * them all), /welcome/about = photo time, optional skin type and check-in days, /welcome/wisp = meet Wisp (an animated introduction to the assistant); then the person's first check-in (or `?next=`). Each step fits one screen (laptop and phone):
 * a compact title, the step's content (scrolls inside only if a detail is opened) and an action bar that is
 * always in view. Consent is kept on this device (lib/prefs) and saved to the account (PUT /v1/me/consent);
 * the rest is the profile (lib/profile, PUT /v1/me/profile). Goals only reorder the report.
 */
export default function Welcome() {
  const { step: raw } = useParams()
  const { search } = useLocation()
  const step: Step = raw === 'goals' || raw === 'places' || raw === 'about' || raw === 'routine' || raw === 'wisp' ? raw : 'consent'
  const { user } = useAuth()
  // Onboarding shows (and saves) the account's profile and consent.
  useActivateData()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  // Goals and the rest come after consent: someone who skipped it is sent back. An unknown step is consent too.
  if ((raw && step === 'consent') || (step !== 'consent' && !hasConsent())) return <Navigate to={`/welcome${search}`} replace />

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <SoftBackdrop background={BACKDROP} />
      <header className="relative flex items-center justify-between gap-3 px-[clamp(16px,3vw,32px)] pt-[clamp(10px,2.2vh,22px)]">
        <BackButton step={step} search={search} />
        <Stepper current={STEP_INDEX[step]} />
        <span className="hidden rounded-pill bg-white/55 px-3.5 py-2 font-mono text-[12px] sm:inline">{user && !user.isAnonymous ? 'SIGNED IN' : 'GUEST · THIS BROWSER'}</span>
      </header>
      {step === 'goals' ? <Goals key="goals" /> : step === 'places' ? <Places key="places" /> : step === 'about' ? <About key="about" /> : step === 'routine' ? <RoutineChoice key="routine" /> : step === 'wisp' ? <Wisp key="wisp" /> : <Consent key="consent" />}
    </div>
  )
}

const backClass = 'grid size-11 shrink-0 place-items-center rounded-full border border-line bg-white/50 text-[18px] text-ink no-underline backdrop-blur-[12px] transition-colors hover:bg-white/80'

function BackButton({ step, search }: { step: Step; search: string }) {
  const navigate = useNavigate()
  const prev = PREV[step]
  if (prev)
    return (
      <Link to={`${prev}${search}`} aria-label={`Back to ${PREV_NAME[step]}`} className={backClass}>
        ←
      </Link>
    )
  // Consent goes back where the person came from (a check-in that asked for consent, or the landing).
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  return (
    <button type="button" aria-label="Back" className={backClass} onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}>
      ←
    </button>
  )
}

function Stepper({ current }: { current: number }) {
  // Phones: the steps scroll sideways, so the current one is kept centred and the far edge fades to say there is more.
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const ol = list.current
    const li = ol?.children[current] as HTMLElement | undefined
    if (ol && li && ol.scrollWidth > ol.clientWidth) ol.scrollLeft = li.offsetLeft - (ol.clientWidth - li.offsetWidth) / 2
  }, [current])
  return (
    <>
    {/* Phones: one slim bar of seven segments and the step's name, instead of seven circles squeezed sideways. */}
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:hidden" role="group" aria-label={`Step ${current + 1} of ${STEPS.length}: ${STEPS[current]}`}>
      <span aria-hidden className="flex gap-1">
        {STEPS.map((label, i) => (
          <span key={label} className="relative h-1 flex-1 overflow-hidden rounded-pill bg-ink/12">
            <span className="absolute inset-0 origin-left rounded-pill bg-selected transition-transform duration-500 ease-standard" style={{ transform: `scaleX(${i <= current ? 1 : 0})`, transitionDelay: i === current ? '120ms' : '0ms' }} />
          </span>
        ))}
      </span>
      <span aria-hidden className="flex items-baseline justify-between text-[12.5px]">
        <span key={current} className="motion-safe:animate-[wRise_.35s_var(--ease-standard)_both]">{STEPS[current]}</span>
        <span className="font-mono text-[11px] text-ink-2 tabular-nums">
          {current + 1}/{STEPS.length}
        </span>
      </span>
    </div>
    <ol ref={list} aria-label="Setup progress" className="no-scrollbar m-0 hidden max-w-full list-none items-start overflow-x-auto px-0.5 py-1 sm:flex">
      {STEPS.map((label, i) => {
        const st = i < current ? 'done' : i === current ? 'on' : 'up'
        return (
          <li key={label} aria-current={st === 'on' ? 'step' : undefined} aria-label={`Step ${i + 1} of ${STEPS.length}: ${label}${st === 'done' ? ', done' : st === 'on' ? ', current' : ''}`} className="flex flex-none items-start">
            <span aria-hidden className="relative mx-0.5 mt-[10px] h-0.5 overflow-hidden rounded-[2px] bg-ink/15" style={{ width: i === 0 ? 0 : 'clamp(10px,2.4vw,32px)' }}>
              <span className="absolute inset-0 rounded-[2px] bg-selected transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ width: st === 'up' ? '0%' : '100%' }} />
            </span>
            <span className="flex min-w-[46px] flex-col items-center gap-1">
              <span
                aria-hidden
                className={`grid size-[22px] place-items-center rounded-full leading-none transition-colors duration-[400ms] ${st === 'up' ? 'border-[1.5px] border-ink/25 bg-transparent text-ink-2' : st === 'on' ? 'bg-selected text-lime' : 'bg-selected text-inverse'} ${st === 'done' ? 'text-[11px] font-extrabold' : 'font-dot text-[9.5px]'}`}
                style={{ animation: st === 'on' ? 'wStepPulse 2s ease-out infinite' : undefined }}
              >
                {st === 'done' ? '✓' : String(i + 1).padStart(2, '0')}
              </span>
              <span className={`whitespace-nowrap font-mono text-[9.5px] tracking-[.06em] transition-colors duration-[400ms] ${st === 'up' ? 'text-ink-2' : 'text-ink'}`}>{label.toUpperCase()}</span>
            </span>
          </li>
        )
      })}
    </ol>
    </>
  )
}

/**
 * One onboarding step: eyebrow, serif title (h1 on a phone, greeting size on a laptop), the content (which
 * scrolls inside itself only when it has to) and the action bar, always in view.
 */
function StepFrame({ title, sub, keepSub, aside, children, actions, wide }: { title: string; sub?: ReactNode; /** shown on short screens too (the consent version) */ keepSub?: boolean; aside?: ReactNode; children: ReactNode; actions: ReactNode; wide?: boolean }) {
  return (
    <main className={`relative mx-auto flex min-h-0 w-full flex-1 animate-[wRiseLg_.5s_cubic-bezier(.2,.7,.2,1)_both] flex-col px-[clamp(16px,3vw,32px)] sm:justify-center sm:pb-[2vh] ${wide ? 'max-w-[1040px]' : 'max-w-[760px]'}`}>
      <div className="flex items-end justify-between gap-4 pt-[clamp(10px,2.4vh,28px)] pb-[clamp(8px,1.8vh,16px)] sm:pt-0">
        <div className="min-w-0">
          {/* No eyebrow: the stepper names the step; what an eyebrow said (choose up to three…) is in the sub line. */}
          <h1 className="mb-0 font-serif text-[clamp(30px,8.4vw,34px)] leading-[1.05] font-normal text-balance sm:text-greeting [@media(max-height:700px)]:text-[28px]">{title}</h1>
          {sub ? <p className={`mt-1 mb-0 text-[14px] leading-[1.4] text-ink-2 text-pretty ${keepSub ? '' : '[@media(max-height:700px)]:hidden'}`}>{sub}</p> : null}
        </div>
        {aside}
      </div>
      {/* room on every side for a hovered card to lift and grow (w-lift-sm: up 4 px, 1% larger) without the scroll box clipping it */}
      <div className="no-scrollbar -mx-3 -mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-3 sm:flex-initial">{children}</div>
      <div className="flex flex-col gap-2 pt-2.5 pb-[max(14px,env(safe-area-inset-bottom))]">{actions}</div>
    </main>
  )
}

const card = 'rounded-[28px] backdrop-blur-[24px]'
const cardStyle = { background: 'rgba(250,250,248,.84)', boxShadow: '0 30px 70px -40px rgba(0,0,0,.3)' }
const primary = 'flex min-h-[52px] items-center justify-center gap-3 rounded-[20px] bg-selected text-[16px] text-inverse transition-[background-color,opacity] hover:bg-[#2A2A2A]'

/** The consent wording (version CONSENT_VERSION). Every line is true of the running system. */
const CONSENT_ITEMS = [
  {
    title: 'Private photo storage, in the US',
    summary: 'Your photos are kept privately in the United States, then deleted 30 days after upload.',
    detail: 'Photos go to a private Cloud Storage bucket in Google Cloud’s us-central1 region (Iowa, United States) that only Willow’s own services read. They are deleted automatically 30 days after upload. Nobody at a retailer or brand can see them.',
    swatch: 'radial-gradient(circle at 40% 30%, var(--aura-ice), var(--aura-sky))',
  },
  {
    title: 'What stays after 30 days',
    summary: 'Your measurements stay until you delete them. Previews go with the photos.',
    detail: 'Numbers, verdicts and spot locations stay with your account, so your history keeps working after the photos are gone. The small previews and spot close-ups are deleted with the photos, 30 days after upload. You can delete everything any time from You.',
    swatch: 'radial-gradient(circle at 40% 30%, var(--aura-apricot), var(--aura-coral))',
  },
  {
    title: 'Face data',
    summary: 'We measure skin appearance; we never recognise faces or build an identity template.',
    detail: 'To place its measurement areas, the engine finds points such as the eyes and nose in each photo. They are used to measure that photo and nothing else. Willow never recognises who you are, never compares your face with anyone else’s and never builds a face template for identity.',
    swatch: 'radial-gradient(circle at 40% 30%, var(--aura-ice), var(--aura-lilac))',
  },
  {
    title: 'How AI is used',
    summary: 'Google’s Gemini explains results, names detected spots, reads ingredient labels and answers questions.',
    detail: 'Measurements come from computer vision. Gemini, on Google Cloud, sees small close-ups of the spots the engine found, and label photos you scan. It may only quote numbers the measurement produced; an answer with any other number is rejected. Your photos are not used to train models.',
    swatch: 'radial-gradient(circle at 40% 30%, var(--aura-lilac), var(--aura-violet))',
  },
  {
    title: 'A wellness product, not a medical one',
    summary: 'Willow is a wellness product for cosmetic appearance. It does not diagnose, treat or prevent any disease and is not a medical device.',
    detail: 'No disease labels, skin age or invented scores. If a mole changes, or anything worries you, see a dermatologist.',
    swatch: 'radial-gradient(circle at 40% 30%, var(--willow-200), var(--willow-400))',
    // Singapore HSA's wellness clarification: shown in full, never clipped.
    full: true,
  },
]

/** One consent choice: its own unticked box, a title and a line saying what it covers. */
function Choice({ checked, onChange, title, note, tag }: { checked: boolean; onChange: (v: boolean) => void; title: string; note: string; tag: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[16px] px-2.5 py-2 transition-colors duration-200 sm:[@media(max-height:700px)]:py-1.5 ${checked ? 'bg-white/70' : 'hover:bg-white/40'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="m-0 mt-px size-5 flex-none accent-[var(--action-selected)]" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-[14px] leading-[1.35]">
          {title}
          <span className="font-mono text-[9.5px] tracking-[.08em] text-ink-2">{tag}</span>
        </span>
        <span className="text-[12.5px] leading-[1.35] text-ink-2 sm:[@media(max-height:760px)]:line-clamp-1">{note}</span>
      </span>
    </label>
  )
}

function Consent() {
  const { user, getIdToken } = useAuth()
  const navigate = useNavigate()
  const { search } = useLocation()
  const saved = prefs.consent()
  const chosen = consentChoices()
  const [open, setOpen] = useState<number | null>(null)
  // Someone who agreed before the separate choices existed agreed to photos and AI together: shown ticked.
  const [photos, setPhotos] = useState(chosen?.photos ?? hasConsent())
  const [ai, setAi] = useState(chosen?.ai ?? hasConsent())
  const [adult, setAdult] = useState(chosen?.adult ?? false)
  const [share, setShare] = useState(saved?.aggregate_opt_in ?? false)
  const [minor, setMinor] = useState(false)
  const ready = adult && photos && ai

  const accept = () => {
    if (!ready) return
    setConsentChoices({ photos, ai, adult })
    // Re-agreeing to the same version keeps the original date.
    prefs.setConsent({ version: CONSENT_VERSION, accepted_at: saved?.version === CONSENT_VERSION ? saved.accepted_at : new Date().toISOString(), aggregate_opt_in: share })
    // The data layer syncs on sign-in; someone already signed in is saved now (a failure retries next load).
    if (user) syncConsent(user.uid, getIdToken).catch(() => undefined)
    navigate(`/welcome/goals${search}`)
  }

  // Under 18: a kind stop. Nothing is written anywhere.
  if (minor)
    return (
      <StepFrame
        title="Thanks for telling us"
        actions={
          <>
            <Link to="/" className={`${primary} no-underline`}>
              Back to the start
            </Link>
            <button type="button" onClick={() => setMinor(false)} className="min-h-11 self-center rounded-pill px-4 text-[14px] text-ink-2 underline underline-offset-2">
              I chose this by mistake
            </button>
          </>
        }
      >
        <div className={`${card} flex flex-col gap-3 px-5 py-5`} style={cardStyle}>
          <p className="m-0 text-[16px] leading-[1.5]">Willow is made for people aged 18 and over, so it can’t be set up for you. Nothing has been saved.</p>
          <p className="m-0 text-[14px] leading-[1.5] text-ink-2">Skin changes a lot in the teenage years, and that is normal. A gentle cleanser, a moisturiser and sunscreen are a good start. A parent, a pharmacist or a doctor can help with anything more.</p>
        </div>
      </StepFrame>
    )

  // The age check and the three choices. On a phone they scroll with the items above them, so a short screen
  // reads every item in full; on a laptop they sit in the action bar, always in view.
  const choices = (
    <div className={`${card} flex flex-col gap-0.5 px-2 py-2 sm:px-3`} style={cardStyle}>
      <div className="flex items-center justify-between gap-2 border-b border-ink/[.07] px-2.5 pt-1 pb-2">
        <label className="flex cursor-pointer items-center gap-3 text-[14px]">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="m-0 size-5 flex-none accent-[var(--action-selected)]" />
          I’m 18 or older
        </label>
        <button type="button" onClick={() => setMinor(true)} className="min-h-9 rounded-pill px-2.5 text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink">
          I’m under 18
        </button>
      </div>
      <Choice checked={photos} onChange={setPhotos} tag="REQUIRED" title="Photos and measurements" note="Kept privately in the US for 30 days; skin appearance is measured from them." />
      <Choice checked={ai} onChange={setAi} tag="REQUIRED" title="AI processing with Gemini" note="Close-ups, label photos and measurements go to Google’s Gemini to explain results." />
      <Choice checked={share} onChange={setShare} tag="OPTIONAL" title="Share aggregate results with brands and retailers" note="Numbers only, never photos or your name; groups under 10 hidden. Brands and retailers pay for these insights." />
    </div>
  )

  return (
    <StepFrame
      title="Before your first photo"
      sub={`Consent version ${fmtDate(CONSENT_VERSION, { day: 'numeric', month: 'short', year: 'numeric' })}`}
      keepSub
      actions={
        <>
          {/* laptops: the choices stay in view under the items; phones: they scroll with the items (below) */}
          <div className="hidden sm:block">{choices}</div>
          <button type="button" onClick={accept} disabled={!ready} className={`${primary} disabled:opacity-60`}>
            {ready ? 'Agree and continue' : !adult ? 'Confirm you’re 18 or older to continue' : 'Tick both required choices to continue'}
          </button>
        </>
      }
    >
      <div className={`${card} overflow-hidden`} style={cardStyle}>
        {CONSENT_ITEMS.map((c, i) => (
          <div key={c.title} className="border-b border-ink/[.07] last:border-b-0">
            <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} aria-controls={`consent-${i}`} className="flex w-full items-center gap-3.5 px-4 py-[clamp(7px,1.1vh,12px)] text-left text-ink sm:px-5 sm:[@media(max-height:760px)]:py-1.5">
              <span aria-hidden className="size-8 flex-none rounded-[11px] sm:[@media(max-height:760px)]:size-6 sm:[@media(max-height:760px)]:rounded-[9px]" style={{ background: c.swatch, boxShadow: 'inset 0 0 10px 2px rgba(255,255,255,.6)' }} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px]">{c.title}</span>
                <span className={`text-[13px] leading-[1.35] text-ink-2 ${open === i || 'full' in c ? '' : 'line-clamp-1 sm:[@media(max-height:760px)]:hidden'}`}>{c.summary}</span>
              </span>
              <span aria-hidden className="text-[20px] text-ink-2">
                {open === i ? '−' : '+'}
              </span>
            </button>
            {open === i ? (
              <p id={`consent-${i}`} className="m-0 px-4 pb-3.5 text-[14px] leading-[1.5] text-[#3E3C38] sm:pr-5 sm:pl-[66px]">
                {c.detail}
              </p>
            ) : null}
          </div>
        ))}
        <p className="m-0 border-t border-ink/[.07] px-4 py-2 text-[12.5px] leading-[1.4] text-ink-2 sm:px-5">
          Change sharing or delete your data any time, in You. Read the full{' '}
          <Link to="/terms" target="_blank" rel="noopener" className="text-ink underline underline-offset-2">
            terms and privacy notice
          </Link>
          .
        </p>
      </div>
      <div className="mt-3 sm:hidden">{choices}</div>
    </StepFrame>
  )
}

const PLACE: Record<Site, string> = { face_full: 'FACE', cheek_macro: 'CLOSE-UP', left_cheek_macro: 'CLOSE-UP', right_cheek_macro: 'CLOSE-UP', forehead_macro: 'CLOSE-UP', chin_macro: 'CLOSE-UP', nose_macro: 'CLOSE-UP', forearm_treated: 'ARM', forearm_control: 'ARM' }

/** Where a goal's measurements come from, read off the metric table: "FACE · CLOSE-UPS". */
function goalPlaces(metrics: MetricId[]): string {
  const sites = metrics.flatMap((m) => METRIC_META[m].sites)
  const order: Site[] = ['face_full', ...CLOSE_UPS, 'forearm_treated', 'forearm_control']
  return [...new Set(order.filter((s) => sites.includes(s)).map((s) => PLACE[s]))].join(' · ')
}

/** MAX_GOALS in words (it matches the api's limit in me_routes.py). */
const GOAL_WORD = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'][MAX_GOALS] ?? String(MAX_GOALS)

function Goals() {
  const { setGoals, profile } = useData()
  const navigate = useNavigate()
  const { search } = useLocation()
  const [picked, setPicked] = useState<GoalId[]>(() => profile.goals)
  const [hint, setHint] = useState(false)

  const toggle = (id: GoalId) => {
    if (picked.includes(id)) {
      setPicked(picked.filter((g) => g !== id))
      setHint(false)
    } else if (picked.length >= MAX_GOALS) setHint(true)
    else {
      setPicked([...picked, id])
      setHint(false)
    }
  }

  const next = () => {
    // Saved on this device (and for the demo journey in this tab); every screen re-orders at once. Someone
    // signed in has it on their account now; a new guest's copy goes up as their account starts (data/store).
    setGoals(picked)
    navigate(`/welcome/places${search}`)
  }

  return (
    <StepFrame
      wide
      title="What would you like to track?"
      sub={`Choose up to ${GOAL_WORD}. Goals set the order of your report; every measurement is still shown.`}
      aside={
        <span className="font-dot text-[clamp(28px,4vh,40px)] leading-none font-extrabold" role="status" aria-label={`${picked.length} of ${MAX_GOALS} goals chosen`}>
          {picked.length}/{MAX_GOALS}
        </span>
      }
      actions={
        <>
          {hint ? (
            <p role="status" className="m-0 self-start rounded-[14px] bg-selected px-3.5 py-2 text-[13px] text-inverse">
              {GOAL_WORD} goals is the limit. Remove one to choose another.
            </p>
          ) : null}
          <button type="button" onClick={next} className={primary}>
            {picked.length ? 'Continue' : 'Continue without goals'} <span aria-hidden>→</span>
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {GOALS.map((g) => {
          const on = picked.includes(g.id)
          const look = GOAL_LOOK[g.id]
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              aria-pressed={on}
              className="w-lift-sm relative flex h-[clamp(72px,12vh,124px)] flex-col justify-between rounded-[24px] p-3 text-left sm:p-3.5"
              style={{ background: look.bg, color: look.fg, boxShadow: on ? 'inset 0 0 0 2px #121212, inset 0 0 30px 4px rgba(255,255,255,.35)' : 'inset 0 0 30px 4px rgba(255,255,255,.35), 0 18px 40px -32px rgba(0,0,0,.45)' }}
            >
              <span className="flex items-start justify-between gap-1.5">
                <span className="truncate rounded-pill bg-white/35 px-2 py-1 font-mono text-[9.5px] tracking-[.06em]">{goalPlaces(g.metrics)}</span>
                <span aria-hidden className={`grid size-6 flex-none place-items-center rounded-full border-[1.5px] border-white/80 text-[12px] text-inverse ${on ? 'bg-selected' : 'bg-white/30'}`}>
                  {on ? '✓' : ''}
                </span>
              </span>
              <span className="text-[clamp(16px,2.2vh,20px)] leading-[1.1] font-normal tracking-[-0.01em]">{g.label}</span>
            </button>
          )
        })}
      </div>
    </StepFrame>
  )
}

/** Places to track: chosen once, every check-in walks through all of them (changeable in You). */
function Places() {
  const { saveProfile, profile } = useData()
  const navigate = useNavigate()
  const { search } = useLocation()
  const [picked, setPicked] = useState<TrackChoice[]>(() => choicesOf(placesOf(profile)))

  const next = () => {
    void saveProfile({ track: trackOf(picked) }).catch(() => undefined)
    navigate(`/welcome/about${search}`)
  }

  return (
    <StepFrame
      wide
      title="Where should Willow look?"
      sub="Choose one or more. Every check-in covers them, one after another; you can change them in You."
      actions={
        <button type="button" onClick={next} className={primary}>
          Continue <span aria-hidden>→</span>
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <TrackChoices value={picked} onChange={setPicked} />
        <p className="m-0 px-1 text-[13px] leading-[1.45] text-ink-2">Have a camera that shoots RAW (DNG)? You can upload those files in a check-in instead; higher quality photos can give steadier readings.</p>
      </div>
    </StepFrame>
  )
}

const pill = (on: boolean) => `hit44 min-h-9 rounded-pill px-3.5 text-[14px] text-ink transition-colors ${on ? 'bg-white shadow-[0_1px_4px_rgba(0,0,0,.08)]' : 'bg-transparent'}`
const track = 'flex flex-wrap gap-0.5 rounded-[22px] bg-muted p-1'

function Field({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-[clamp(8px,1.6vh,16px)] sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[16px]">{title}</span>
        <span className="text-[12.5px] text-ink-2">{note}</span>
      </div>
      {children}
    </div>
  )
}

/** Photo time, skin type and check-in days (all on the profile; skin type and days optional). */
function About() {
  const { user, continueAsGuest } = useAuth()
  const { saveProfile, profile } = useData()
  const navigate = useNavigate()
  const [time, setTime] = useState<PhotoTime>(() => profile.photo_time ?? 'evening')
  const [skin, setSkin] = useState<SkinType | null>(() => profile.skin_type)
  const [days, setDays] = useState<number[]>(() => profile.checkin?.days ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { search } = useLocation()

  const finish = async () => {
    const checkin = days.length ? { days, time: profile.checkin?.time ?? PHOTO_TIME_CLOCK[time], tz: browserTz() } : null
    void saveProfile({ photo_time: time, skin_type: skin, checkin }).catch(() => undefined)
    if (!user) {
      // Capturing needs an account of your own: a guest one for this browser is enough.
      setBusy(true)
      setError(null)
      try {
        await continueAsGuest()
      } catch {
        setBusy(false)
        return setError('Could not start a guest session. Check your connection and try again.')
      }
    }
    navigate(`/welcome/routine${search}`)
  }

  return (
    <StepFrame
      title="A little about you"
      sub="When and how you check in. All of it can be changed later in You."
      actions={
        <>
          {error ? (
            <p role="alert" className="m-0 rounded-[14px] bg-selected px-3.5 py-2 text-[13px] text-inverse">
              {error}
            </p>
          ) : null}
          <button type="button" onClick={() => void finish()} disabled={busy} className={primary}>
            {busy ? 'Starting…' : 'Save and continue'} <span aria-hidden>→</span>
          </button>
        </>
      }
    >
      <div className={`${card} flex flex-col divide-y divide-ink/[.07]`} style={cardStyle}>
        <Field title="When do you prefer to take photos and check in?" note="Same time each session is best">
          <div role="radiogroup" aria-label="Usual photo time" className={`${track} self-start`}>
            {PHOTO_TIMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={time === t.id} onClick={() => setTime(t.id)} className={pill(time === t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field title="Your skin type" note="Optional · never changes a measurement">
          <div role="radiogroup" aria-label="Skin type" className={`${track} self-start`}>
            {[...SKIN_TYPES, { id: null, label: 'Prefer not to say' }].map((t) => (
              <button key={t.label} type="button" role="radio" aria-checked={skin === t.id} onClick={() => setSkin(t.id)} className={pill(skin === t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field title="Your check-in days" note="Optional · once a week is enough">
          {/* seven equal columns on a phone (no lone Sunday on a second line); a row of pills on a laptop */}
          <div role="group" aria-label="Check-in days" className="grid grid-cols-7 gap-0.5 self-stretch rounded-[22px] bg-muted p-1 sm:flex sm:flex-wrap sm:self-start">
            {WEEKDAYS.map((d, i) => {
              const on = days.includes(i)
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => setDays(on ? days.filter((x) => x !== i) : [...days, i].sort())} className={`${pill(on)} min-w-0 px-0 sm:min-w-[40px] sm:px-2`}>
                  {d}
                </button>
              )
            })}
          </div>
        </Field>
      </div>
    </StepFrame>
  )
}

type RoutineWay = 'have' | 'build' | 'track'
const ROUTINE_WAYS: { id: RoutineWay; title: string; line: string; tag: string; bg: string; fg: string }[] = [
  { id: 'have', title: 'I have a routine', line: 'Add the products you already use in Routine. Willow follows how each one does.', tag: 'ADD YOURS LATER', bg: 'radial-gradient(90% 80% at 40% 100%, #4FB866 0%, #B8E986 45%, #EAF2E2 85%)', fg: '#0E2A12' },
  { id: 'build', title: 'Build me one', line: 'Four short questions, then a simple routine in your budget, each product checked against what you tell us.', tag: 'ABOUT 2 MINUTES', bg: 'radial-gradient(90% 80% at 60% 100%, #7A5CFF 0%, #D8B8FF 45%, #EEE8F6 85%)', fg: '#1C0F4A' },
  { id: 'track', title: 'Just tracking for now', line: 'Measure your skin first. You can build a routine any time from Routine.', tag: 'SKIP', bg: 'radial-gradient(90% 80% at 50% 100%, #9CD3FF 0%, #E6EEF6 60%, #F3F2EE 90%)', fg: '#0A1840' },
]

/** Your routine: keep your own, have Willow build one (/plan, which comes back here via ?next=), or skip. */
function RoutineChoice() {
  const navigate = useNavigate()
  const { search } = useLocation()
  const [way, setWay] = useState<RoutineWay | null>(null)
  const next = () => {
    if (way === 'build') navigate(`/plan?next=${encodeURIComponent(`/welcome/wisp${search}`)}`)
    else navigate(`/welcome/wisp${search}`)
  }
  return (
    <StepFrame
      wide
      title="Do you already use skincare?"
      sub="Willow measures your skin either way. A routine lets it say which product did what."
      actions={
        <button type="button" onClick={next} disabled={!way} className={`${primary} disabled:opacity-60`}>
          {way === 'build' ? 'Build my routine' : way ? 'Continue' : 'Choose one to continue'} {way ? <span aria-hidden>→</span> : null}
        </button>
      }
    >
      <div role="radiogroup" aria-label="Your routine" className="grid gap-2.5 sm:grid-cols-3">
        {ROUTINE_WAYS.map((w, i) => {
          const on = way === w.id
          return (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setWay(w.id)}
              className="w-lift-sm relative flex min-h-[clamp(96px,17vh,210px)] flex-col justify-between gap-3 rounded-[24px] p-3.5 text-left transition-[box-shadow,transform] duration-300 ease-standard active:scale-[.98] sm:p-4"
              style={{ background: w.bg, color: w.fg, animation: `wRise .5s var(--ease-standard) ${60 + i * 70}ms both`, boxShadow: on ? 'inset 0 0 0 2px #121212, inset 0 0 30px 4px rgba(255,255,255,.35)' : 'inset 0 0 30px 4px rgba(255,255,255,.35), 0 18px 40px -32px rgba(0,0,0,.45)' }}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="rounded-pill bg-white/40 px-2 py-1 font-mono text-[9.5px] tracking-[.06em]">{w.tag}</span>
                <span aria-hidden className={`grid size-6 flex-none place-items-center rounded-full border-[1.5px] border-white/80 text-[12px] text-inverse transition-colors ${on ? 'bg-selected' : 'bg-white/30'}`}>
                  {on ? <span className="animate-[wDotIn_.28s_var(--ease-bounce)_both]">✓</span> : ''}
                </span>
              </span>
              <span>
                <span className="block text-[clamp(18px,2.4vh,22px)] leading-[1.1] tracking-[-0.01em]">{w.title}</span>
                <span className="mt-1 block text-[13px] leading-[1.35] opacity-85">{w.line}</span>
              </span>
            </button>
          )
        })}
      </div>
    </StepFrame>
  )
}

/** Meet Wisp: the assistant's introduction, then on to the first check-in (or `?next=`). */
function Wisp() {
  const { user, continueAsGuest } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = nextPath(params.get('next'), FIRST_CHECKIN)
  const toCapture = target.startsWith('/check-in')

  const finish = async () => {
    if (!user) {
      setBusy(true)
      setError(null)
      try {
        await continueAsGuest()
      } catch {
        setBusy(false)
        return setError('Could not start a guest session. Check your connection and try again.')
      }
    }
    if (toCapture) {
      // The first check-in draws over Home (not over onboarding), so its ✕ and the Back from its result land on Home.
      navigate('/home', { replace: true })
      navigate(target, { state: { background: { pathname: '/home', search: '', hash: '', state: null, key: 'welcome' } } })
    } else navigate(target)
  }

  return (
    <StepFrame
      title="Meet Wisp"
      sub="Your skincare assistant, a tap away on every screen."
      actions={
        <>
          {error ? (
            <p role="alert" className="m-0 rounded-[14px] bg-selected px-3.5 py-2 text-[13px] text-inverse">
              {error}
            </p>
          ) : null}
          <button type="button" onClick={() => void finish()} disabled={busy} className={primary}>
            {busy ? 'Starting…' : toCapture ? 'Set up my first capture' : 'Continue'} <span aria-hidden>→</span>
          </button>
        </>
      }
    >
      <MeetWisp />
    </StepFrame>
  )
}
