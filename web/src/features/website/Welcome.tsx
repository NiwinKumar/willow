import './website.css'

import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import type { MetricId, Site } from '../../data/types'
import type { PhotoTime, SkinType } from '../../lib/api'
import { syncConsent } from '../../lib/consent'
import { GOALS, MAX_GOALS, METRIC_META, type GoalId } from '../../lib/metrics'
import { browserTz, PHOTO_TIME_CLOCK, PHOTO_TIMES, SKIN_TYPES, WEEKDAYS } from '../../lib/profile'
import { fmtDate } from '../../lib/format'
import { CONSENT_VERSION, nextPath, prefs } from '../../lib/prefs'
import { useData } from '../../data/useData'
import { useAuth } from '../../lib/useAuth'
import { backButton, SoftBackdrop } from './Decor'
import { FIRST_CHECKIN, hasConsent } from './entry'

const BACKDROP = 'radial-gradient(40% 40% at 15% 20%, rgba(255,178,122,.55), transparent 70%), radial-gradient(40% 45% at 85% 80%, rgba(156,211,255,.6), transparent 70%), radial-gradient(35% 35% at 80% 15%, rgba(216,184,255,.5), transparent 70%), var(--bg-canvas)'

/**
 * Onboarding (/welcome = consent, /welcome/goals = goals, photo time, optional skin type and check-in days),
 * then the person's first check-in (or `?next=`). Consent is kept on this device (lib/prefs) and saved to the
 * account (PUT /v1/me/consent); the rest is the profile (lib/profile, PUT /v1/me/profile). Goals only reorder
 * the report.
 */
export default function Welcome() {
  const { step } = useParams()
  const { search } = useLocation()
  const isGoals = step === 'goals'
  const { user } = useAuth()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [isGoals])

  // Goals come after consent: someone who skipped it is sent back.
  if (isGoals && !hasConsent()) return <Navigate to={`/welcome${search}`} replace />

  return (
    <div className="relative flex min-h-dvh flex-col gap-5 overflow-x-clip p-[clamp(16px,3vw,32px)]">
      <SoftBackdrop background={BACKDROP} />
      <header className="relative flex items-center justify-between gap-3">
        <BackButton isGoals={isGoals} search={search} />
        <Stepper current={isGoals ? 1 : 0} />
        <span className="hidden rounded-pill bg-white/55 px-4 py-2.5 font-mono text-[13px] sm:inline">{user && !user.isAnonymous ? 'SIGNED IN' : 'GUEST · THIS BROWSER'}</span>
      </header>
      {isGoals ? <Goals key="goals" /> : <Consent key="consent" />}
    </div>
  )
}

function BackButton({ isGoals, search }: { isGoals: boolean; search: string }) {
  const navigate = useNavigate()
  if (isGoals)
    return (
      <Link to={`/welcome${search}`} aria-label="Back to consent" className={backButton}>
        ←
      </Link>
    )
  // Consent goes back where the person came from (a check-in that asked for consent, or the landing).
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  return (
    <button type="button" aria-label="Back" className={backButton} onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}>
      ←
    </button>
  )
}

const STEPS = ['Consent', 'Goals', 'Capture']

function Stepper({ current }: { current: number }) {
  return (
    <ol aria-label="Setup progress" className="no-scrollbar m-0 flex max-w-full list-none items-start overflow-x-auto px-0.5 py-1">
      {STEPS.map((label, i) => {
        const st = i < current ? 'done' : i === current ? 'on' : 'up'
        return (
          <li key={label} aria-current={st === 'on' ? 'step' : undefined} aria-label={`Step ${i + 1} of ${STEPS.length}: ${label}${st === 'done' ? ', done' : st === 'on' ? ', current' : ''}`} className="flex flex-none items-start">
            <span aria-hidden className="relative mx-1 mt-[13px] h-0.5 overflow-hidden rounded-[2px] bg-ink/15" style={{ width: i === 0 ? 0 : 'clamp(18px,3.4vw,44px)' }}>
              <span className="absolute inset-0 rounded-[2px] bg-selected transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ width: st === 'up' ? '0%' : '100%' }} />
            </span>
            <span className="flex min-w-[52px] flex-col items-center gap-[7px]">
              <span
                aria-hidden
                className={`grid size-7 place-items-center rounded-full leading-none transition-colors duration-[400ms] ${st === 'up' ? 'border-[1.5px] border-ink/25 bg-transparent text-ink-2' : st === 'on' ? 'bg-selected text-lime' : 'bg-selected text-inverse'} ${st === 'done' ? 'text-[13px] font-extrabold' : 'font-dot text-[11px]'}`}
                style={{ animation: st === 'on' ? 'wStepPulse 2s ease-out infinite' : undefined }}
              >
                {st === 'done' ? '✓' : String(i + 1).padStart(2, '0')}
              </span>
              <span className={`whitespace-nowrap font-mono text-[10.5px] tracking-[.08em] transition-colors duration-[400ms] ${st === 'up' ? 'text-ink-2' : 'text-ink'}`}>{label.toUpperCase()}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** The consent wording (version CONSENT_VERSION). Every line is true of the running system. */
const CONSENT_ITEMS = [
  {
    title: 'Private photo storage',
    summary: 'Your original photos are kept privately, then deleted 30 days after upload.',
    detail: 'Photos go to a private Cloud Storage bucket in us-central1 that only Willow’s own services read. They are deleted automatically 30 days after upload. Nobody at a retailer can see them.',
    swatch: 'radial-gradient(circle at 40% 30%, var(--aura-ice), var(--aura-sky))',
  },
  {
    title: 'What stays after 30 days',
    summary: 'Your measurements stay until you delete them. Previews go with the photos.',
    detail: 'Numbers, verdicts and spot locations stay with your account, so your history keeps working after the photos are gone. The small previews and spot close-ups are deleted with the photos, 30 days after upload. You can delete everything any time from You.',
    swatch: 'radial-gradient(circle at 40% 30%, var(--aura-apricot), var(--aura-coral))',
  },
  {
    title: 'How AI is used',
    summary: 'Gemini explains results, names detected spots, reads ingredient labels and answers questions.',
    detail: 'Measurements come from computer vision. Gemini sees small close-ups of the spots the engine found, and label photos you scan. It may only quote numbers the measurement produced; an answer with any other number is rejected. Your photos are not used to train models.',
    swatch: 'radial-gradient(circle at 40% 30%, var(--aura-lilac), var(--aura-violet))',
  },
  {
    title: 'Cosmetic scope only',
    summary: 'Willow tracks appearance. It does not diagnose.',
    detail: 'No disease labels, skin age or invented scores. If a mole changes, or anything worries you, see a dermatologist.',
    swatch: 'radial-gradient(circle at 40% 30%, var(--willow-200), var(--willow-400))',
  },
]

function Consent() {
  const { user, getIdToken } = useAuth()
  const navigate = useNavigate()
  const { search } = useLocation()
  const saved = prefs.consent()
  const [open, setOpen] = useState<number | null>(null)
  const [agree, setAgree] = useState(hasConsent())
  const [share, setShare] = useState(saved?.aggregate_opt_in ?? false)

  const accept = () => {
    if (!agree) return
    // Re-agreeing to the same version keeps the original date.
    prefs.setConsent({ version: CONSENT_VERSION, accepted_at: saved?.version === CONSENT_VERSION ? saved.accepted_at : new Date().toISOString(), aggregate_opt_in: share })
    // The data layer syncs on sign-in; someone already signed in is saved now (a failure retries next load).
    if (user) syncConsent(user.uid, getIdToken).catch(() => undefined)
    navigate(`/welcome/goals${search}`)
  }

  return (
    <main className="relative mx-auto flex w-full max-w-[760px] animate-[wRiseLg_.6s_cubic-bezier(.2,.7,.2,1)_both] flex-col gap-5 pb-10">
      <div className="px-1 pb-2 pt-[clamp(20px,4vw,40px)]">
        <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ CONSENT · VERSION {fmtDate(CONSENT_VERSION, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()}</span>
        <h1 className="mt-3.5 mb-0 font-serif text-[clamp(44px,6vw,76px)] font-normal leading-[.95] tracking-[-0.01em]">Before your first photo</h1>
      </div>
      <div className="overflow-hidden rounded-[36px] backdrop-blur-[24px]" style={{ background: 'rgba(250,250,248,.82)', boxShadow: '0 30px 70px -40px rgba(0,0,0,.3)' }}>
        {CONSENT_ITEMS.map((c, i) => (
          <div key={c.title} className="border-b border-ink/[.07]">
            <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} aria-controls={`consent-${i}`} className="flex w-full items-center gap-[18px] px-[clamp(18px,3vw,28px)] py-[22px] text-left text-ink">
              <span aria-hidden className="size-[46px] flex-none rounded-[16px]" style={{ background: c.swatch, boxShadow: 'inset 0 0 12px 2px rgba(255,255,255,.6)' }} />
              <span className="flex flex-1 flex-col gap-1">
                <span className="text-[19px]">{c.title}</span>
                <span className="text-[15px] leading-[1.4] text-ink-2">{c.summary}</span>
              </span>
              <span aria-hidden className="text-[22px] text-ink-2">
                {open === i ? '−' : '+'}
              </span>
            </button>
            {open === i ? (
              <p id={`consent-${i}`} className="m-0 pb-[22px] pl-[clamp(18px,3vw,28px)] pr-[clamp(18px,3vw,28px)] text-[15px] leading-[1.55] text-[#3E3C38] sm:pl-[92px]">
                {c.detail}
              </p>
            ) : null}
          </div>
        ))}
        <div className="flex flex-col gap-[18px] px-[clamp(18px,3vw,28px)] py-6">
          <label className="flex cursor-pointer items-start gap-3.5 text-[16px] leading-[1.45]">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="m-0 size-6 flex-none accent-[var(--action-selected)]" />
            <span>I agree to private storage and analysis of my photos for cosmetic appearance tracking, as described above.</span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3.5 rounded-[22px] bg-sunken px-[18px] py-4">
            <span className="flex flex-col gap-[3px]">
              <span className="text-[16px]">Share anonymized aggregate results</span>
              <span className="text-[14px] text-ink-2">Optional. Off by default. Numbers only, never photos or your name. Helps retailers see which products work for whom. Groups under 10 people are never shown.</span>
            </span>
            <input type="checkbox" role="switch" checked={share} onChange={(e) => setShare(e.target.checked)} className="size-6 flex-none accent-[var(--action-selected)]" />
          </label>
          <p className="m-0 text-[14px] text-ink-2">
            You can change sharing or delete your data any time, from You in the app. The full{' '}
            <Link to="/terms" target="_blank" rel="noopener" className="text-ink underline underline-offset-2">
              terms and privacy notice
            </Link>{' '}
            say who runs Willow and what it keeps.
          </p>
        </div>
      </div>
      <button type="button" onClick={accept} disabled={!agree} className="min-h-[60px] self-stretch rounded-[24px] bg-selected text-[17px] text-inverse transition-opacity">
        {agree ? 'Agree and continue' : 'Tick the agreement to continue'}
      </button>
    </main>
  )
}

/** Each goal drawn with one of the design's goal gradients (decoration only) and its ink colour. */
const GOAL_LOOK: Record<GoalId, { bg: string; fg: string }> = {
  dark_spots: { bg: 'radial-gradient(90% 80% at 30% 100%, #FF8A3D 0%, #FFB27A 35%, #F6E3D4 75%)', fg: '#2A1206' },
  even_tone: { bg: 'radial-gradient(90% 80% at 70% 100%, #3D7BFF 0%, #9CD3FF 45%, #E6EEF6 85%)', fg: '#0A1840' },
  redness: { bg: 'radial-gradient(90% 80% at 50% 100%, #F25FA8 0%, #F7A6C9 45%, #F4E6EC 85%)', fg: '#3A0A22' },
  blemishes: { bg: 'radial-gradient(90% 80% at 40% 100%, #4FB866 0%, #B8E986 45%, #EAF2E2 85%)', fg: '#0E2A12' },
  pores_texture: { bg: 'radial-gradient(90% 80% at 60% 100%, #7A5CFF 0%, #D8B8FF 45%, #EEE8F6 85%)', fg: '#1C0F4A' },
  lines: { bg: 'radial-gradient(90% 80% at 50% 100%, #9CD3FF 0%, #D8B8FF 45%, #F1ECF8 85%)', fg: '#1C0F4A' },
  under_eye: { bg: 'radial-gradient(90% 80% at 40% 100%, #FF6B4A 0%, #F7A6C9 45%, #F6E8E6 85%)', fg: '#3A0E06' },
  oil_glow: { bg: 'radial-gradient(90% 80% at 50% 100%, #F2B53A 0%, #F6DE5C 40%, #F5F0DA 85%)', fg: '#2A2410' },
}

const PLACE: Record<Site, string> = { face_full: 'FACE', cheek_macro: 'CLOSE-UPS', nose_macro: 'CLOSE-UPS', forearm_treated: 'FOREARM', forearm_control: 'FOREARM' }

/** Where a goal's measurements come from, read off the metric table: "FACE · CLOSE-UPS". */
function goalPlaces(metrics: MetricId[]): string {
  const sites = metrics.flatMap((m) => METRIC_META[m].sites)
  const order: Site[] = ['face_full', 'cheek_macro', 'nose_macro', 'forearm_treated', 'forearm_control']
  return [...new Set(order.filter((s) => sites.includes(s)).map((s) => PLACE[s]))].join(' · ')
}

/** Pills in a track (the design's photo-time control), wrapping on narrow screens. */
const pillTrack = 'flex flex-wrap gap-1 rounded-[26px] bg-muted p-[5px]'
const pill = (on: boolean) => `min-h-11 rounded-pill px-5 text-[15px] text-ink transition-colors ${on ? 'bg-white' : 'bg-transparent'}`
const panel = 'flex flex-wrap items-center justify-between gap-[18px] rounded-[32px] px-[clamp(18px,3vw,28px)] py-[22px] backdrop-blur-[20px]'
const panelBg = { background: 'rgba(250,250,248,.82)' }

function Goals() {
  const { user, continueAsGuest } = useAuth()
  const { setGoals, saveProfile, profile } = useData()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [picked, setPicked] = useState<GoalId[]>(() => profile.goals)
  const [hint, setHint] = useState(false)
  const [time, setTime] = useState<PhotoTime>(() => profile.photo_time ?? 'evening')
  const [skin, setSkin] = useState<SkinType | null>(() => profile.skin_type)
  const [days, setDays] = useState<number[]>(() => profile.checkin?.days ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = nextPath(params.get('next'), FIRST_CHECKIN)
  const toCapture = target.startsWith('/check-in')

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

  const finish = async () => {
    // Saved on this device (and for the demo journey in this tab); every screen re-orders at once. Someone
    // signed in has it on their account now; a new guest's copy goes up as their account starts (data/store).
    setGoals(picked)
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
    if (toCapture) {
      // The first check-in draws over Home (not over onboarding), so its ✕ and the Back from its result land on Home.
      navigate('/home', { replace: true })
      navigate(target, { state: { background: { pathname: '/home', search: '', hash: '', state: null, key: 'welcome' } } })
    } else navigate(target)
  }

  return (
    <main className="relative mx-auto flex w-full max-w-[980px] animate-[wRiseLg_.6s_cubic-bezier(.2,.7,.2,1)_both] flex-col gap-[22px] pb-10">
      <div className="flex flex-wrap items-end justify-between gap-5 px-1 pt-[clamp(20px,4vw,40px)]">
        <div>
          <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ CHOOSE UP TO THREE</span>
          <h1 className="mt-3.5 mb-0 font-serif text-[clamp(44px,6vw,76px)] font-normal leading-[.95]">What would you like to track?</h1>
          <p className="mt-3 mb-0 text-[15px] text-ink-2">Goals set the order of your report. Every measurement is still shown.</p>
        </div>
        <span className="font-dot text-[56px] font-extrabold leading-none" role="status" aria-label={`${picked.length} of 3 goals chosen`}>
          {picked.length}/3
        </span>
      </div>
      {hint ? (
        <p role="status" className="m-0 self-start rounded-[18px] bg-selected px-[18px] py-3 text-[14px] text-inverse">
          Three goals is the limit. Remove one to choose another.
        </p>
      ) : null}
      {/* Cards grow to fill the last row, so the goals never leave a hole. */}
      <div className="flex flex-wrap gap-3.5">
        {GOALS.map((g) => {
          const on = picked.includes(g.id)
          const look = GOAL_LOOK[g.id]
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              aria-pressed={on}
              className="w-lift-sm relative flex h-[200px] flex-[1_1_280px] flex-col justify-between rounded-[36px] p-6 text-left"
              style={{ background: look.bg, color: look.fg, boxShadow: 'inset 0 0 40px 6px rgba(255,255,255,.35), 0 24px 50px -36px rgba(0,0,0,.45)' }}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="rounded-pill bg-white/35 px-2.5 py-1.5 font-mono text-[11px] tracking-[.08em]">{goalPlaces(g.metrics)}</span>
                <span aria-hidden className={`grid size-[34px] place-items-center rounded-full border-[1.5px] border-white/80 text-[16px] text-inverse ${on ? 'bg-selected' : 'bg-white/30'}`}>
                  {on ? '✓' : ''}
                </span>
              </span>
              <span className="text-[28px] font-normal tracking-[-0.02em]">{g.label}</span>
            </button>
          )
        })}
      </div>
      <div className={panel} style={panelBg}>
        <div className="flex flex-col gap-1">
          <span className="text-[18px]">When do you usually take photos?</span>
          <span className="text-[14px] text-ink-2">Shine and redness can shift through the day. Same time each session is best.</span>
        </div>
        <div role="radiogroup" aria-label="Usual photo time" className="flex gap-1 rounded-pill bg-muted p-[5px]">
          {PHOTO_TIMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={time === t.id} onClick={() => setTime(t.id)} className={pill(time === t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className={panel} style={panelBg}>
        <div className="flex max-w-[360px] flex-col gap-1">
          <span className="text-[18px]">Your skin type</span>
          <span className="text-[14px] text-ink-2">Optional. It does not change any measurement; you can change it in You.</span>
        </div>
        <div role="radiogroup" aria-label="Skin type" className={pillTrack}>
          {[...SKIN_TYPES, { id: null, label: 'Prefer not to say' }].map((t) => (
            <button key={t.label} type="button" role="radio" aria-checked={skin === t.id} onClick={() => setSkin(t.id)} className={pill(skin === t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className={panel} style={panelBg}>
        <div className="flex max-w-[360px] flex-col gap-1">
          <span className="text-[18px]">Your check-in days</span>
          <span className="text-[14px] text-ink-2">Optional. Once a week is enough; the same day and time keeps photos comparable.</span>
        </div>
        <div role="group" aria-label="Check-in days" className={pillTrack}>
          {WEEKDAYS.map((d, i) => {
            const on = days.includes(i)
            return (
              <button key={d} type="button" aria-pressed={on} onClick={() => setDays(on ? days.filter((x) => x !== i) : [...days, i].sort())} className={`${pill(on)} min-w-[52px] px-3.5`}>
                {d}
              </button>
            )
          })}
        </div>
      </div>
      {error ? (
        <p role="alert" className="m-0 rounded-[18px] bg-selected px-[18px] py-3 text-[14px] text-inverse">
          {error}
        </p>
      ) : null}
      <button type="button" onClick={() => void finish()} disabled={busy} className="flex min-h-[60px] items-center justify-center gap-3 rounded-[24px] bg-selected text-[17px] text-inverse transition-colors hover:bg-[#2A2A2A]">
        {busy ? 'Starting…' : toCapture ? 'Save and set up my first capture' : 'Save and continue'} <span aria-hidden>→</span>
      </button>
    </main>
  )
}
