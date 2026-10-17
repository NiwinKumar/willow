import './website.css'

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type Ref } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { WillowIntro } from '../../components/willow/WillowLoader'
import { enterDemo, leaveDemo } from '../../data/useData'
import { identity } from '../../lib/identity'
import { JUDGE_STOPS } from '../../lib/judge'
import { useAuth } from '../../lib/useAuth'
import { useSamples } from '../../lib/useSamples'
import { ProofLockup } from '../retail/brand'
import { HeroBloom, Lockup } from './Decor'
import { FIRST_CHECKIN, isReturning } from './entry'
import { journeyLine, journeyUnavailableLine, useEntryActions, useJourney } from './hooks'
import { ScienceSection } from './ScienceSection'
import { SectionRail } from './SectionRail'
import { glide, SECTIONS, setupReveal } from './scroll'

const pad = 'px-[clamp(18px,4vw,52px)]'
/** Sections after the hero leave room for the rail on wide screens. */
const railRoom = 'min-[760px]:pr-[max(64px,4vw)]'

/** In-page anchor that glides instead of jumping. */
function Anchor({ to, className = '', style, children }: { to: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <a
      href={`#${to}`}
      className={className}
      style={style}
      onClick={(e: MouseEvent) => {
        e.preventDefault()
        glide(to)
      }}
    >
      {children}
    </a>
  )
}

/**
 * The website (Willow.dc.html): intro loader once per session, hero, four ways in, how it works, science,
 * limits, fairness and the privacy footer, with the section rail. `/science` opens at the science section.
 */
export default function Landing() {
  const { user, loading } = useAuth()
  const { pathname, hash } = useLocation()
  const [introDone, setIntroDone] = useState(false)
  const bloom = useRef<HTMLDivElement>(null)
  const returning = !loading && isReturning(user)

  // /science and #section links open at their section (under the intro, so the reveal lands there).
  useEffect(() => {
    const id = pathname === '/science' ? 'science' : hash.slice(1)
    if (id && (SECTIONS as readonly string[]).includes(id)) requestAnimationFrame(() => glide(id, true))
  }, [pathname, hash])

  // Sections rise into view once the intro has opened.
  useEffect(() => {
    if (!introDone) return
    let cleanup = () => {}
    const t = window.setTimeout(() => (cleanup = setupReveal(SECTIONS.slice(1))), 80)
    return () => {
      window.clearTimeout(t)
      cleanup()
    }
  }, [introDone])

  // The hero flowers drift down a little slower than the page (parallax).
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (bloom.current) bloom.current.style.translate = `0 ${(Math.min(window.scrollY, window.innerHeight) * 0.18).toFixed(1)}px`
      })
    }
    window.addEventListener('scroll', on, { passive: true })
    return () => {
      window.removeEventListener('scroll', on)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="min-h-dvh overflow-x-clip bg-canvas text-ink">
      <WillowIntro onDone={() => setIntroDone(true)} />
      <SectionRail ready={introDone} />
      {/* One main landmark for the page; the privacy footer stays outside it (contentinfo). */}
      <main>
        <Hero returning={returning} bloomRef={bloom} />
        <WaysIn returning={returning} />
        <How />
        <ScienceSection className={`${pad} ${railRoom}`} />
        <Limits />
        <Fairness />
      </main>
      <Footer />
    </div>
  )
}

function Hero({ returning, bloomRef }: { returning: boolean; bloomRef: Ref<HTMLDivElement> }) {
  const { user, loading } = useAuth()
  const entry = useEntryActions()
  const me = identity(user)
  return (
    <section id="top" className="w-sky relative min-h-[min(94vh,860px)] overflow-hidden rounded-b-[clamp(36px,5vw,64px)] text-ink">
      <div ref={bloomRef} aria-hidden className="absolute inset-y-0 right-0 w-[min(68%,1100px)]">
        <HeroBloom className="absolute inset-0" />
      </div>
      <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(249,227,204,.55) 0%, rgba(249,227,204,.25) 32%, rgba(249,227,204,0) 52%)' }} />

      <header className={`relative z-[2] flex flex-wrap items-center justify-between gap-4 py-[clamp(18px,3vw,32px)] ${pad}`}>
        <Lockup />
        <div className="flex items-center gap-[clamp(12px,2vw,24px)]">
          {/* With the longer "Open Willow →" the header would wrap on a phone; business visitors still have the footer link there. */}
          <Link to="/retail" className={`text-[15px] text-ink no-underline transition-opacity hover:opacity-60 ${returning ? 'max-[439px]:hidden' : ''}`}>
            For business
          </Link>
          <Link to={returning ? '/home' : '/welcome'} className="cta-yellow rounded-pill px-6 py-[13px] text-[15px] font-medium no-underline transition-[filter] hover:brightness-105">
            {returning ? 'Open Willow →' : 'Get started →'}
          </Link>
        </div>
      </header>

      <div className={`relative z-[2] grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-center gap-[clamp(28px,5vw,72px)] pb-[clamp(32px,6vh,64px)] pt-[clamp(28px,6vh,72px)] ${pad}`}>
        <div className="flex animate-[wRiseLg_.9s_cubic-bezier(.2,.7,.2,1)_both] flex-col gap-7">
          <h1 className="m-0 text-[clamp(44px,5.4vw,84px)] font-light leading-[.96] tracking-[-0.035em]">
            See whether your skin <span className="font-serif font-normal italic tracking-[-0.01em]">really</span> changed.
          </h1>
          <p className="m-0 max-w-[520px] text-[clamp(17px,1.4vw,20px)] font-light leading-normal">
            Willow compares each standardized photo with your own baseline and tells you when a change is bigger than your normal photo-to-photo variation. Computer vision measures. AI explains. Cosmetic appearance tracking only, never a diagnosis.
          </p>
          <div className="flex min-h-14 flex-wrap gap-2.5">
            {loading ? null : returning ? (
              <>
                <Link to="/home" className="flex min-h-14 items-center gap-3 rounded-pill bg-selected px-[26px] text-[16px] text-inverse no-underline transition-transform hover:-translate-y-0.5">
                  Open Willow <span aria-hidden>→</span>
                </Link>
                <p className="m-0 self-center text-[14px] text-ink-2">Signed in {me.guest ? 'as a guest on this browser' : `as ${me.email ?? me.name}`}</p>
              </>
            ) : (
              <>
                <button type="button" onClick={entry.google} disabled={entry.pending !== null} aria-busy={entry.pending === 'google' || undefined} className="flex min-h-14 items-center gap-3 rounded-pill bg-selected py-0 pl-2 pr-[26px] text-[16px] text-inverse transition-transform hover:-translate-y-0.5">
                  <span aria-hidden className="grid size-10 place-items-center rounded-full bg-white text-[17px] font-semibold text-ink">
                    G
                  </span>
                  <span>{entry.pending === 'google' ? 'Signing in…' : user?.isAnonymous ? 'Keep my results with Google' : 'Continue with Google'}</span>
                </button>
                <button type="button" onClick={entry.guest} disabled={entry.pending !== null} aria-busy={entry.pending === 'guest' || undefined} className="min-h-14 rounded-pill border border-line-strong bg-white/50 px-[26px] text-[16px] text-ink backdrop-blur-[14px] transition-colors hover:bg-white/80">
                  {entry.pending === 'guest' ? 'Starting…' : 'Continue as guest'}
                </button>
              </>
            )}
          </div>
          {entry.error ? (
            <p role="alert" className="m-0 max-w-[460px] rounded-[16px] bg-selected px-4 py-3 text-[14px] text-inverse">
              {entry.error}
            </p>
          ) : null}
          <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ COSMETIC TRACKING · NOT A MEDICAL DEVICE</span>
        </div>
        <div aria-hidden className="min-h-[min(60vh,520px)]" />
      </div>
    </section>
  )
}

const wayCard = 'w-lift relative flex h-[380px] flex-col justify-between overflow-hidden rounded-[34px] p-6 text-left no-underline disabled:cursor-default disabled:opacity-100'

function WayText({ tag, title, body }: { tag: string; title: string; body: ReactNode }) {
  return (
    <>
      <span className="font-mono text-[12px] tracking-[.1em]">■ {tag}</span>
      <span className="flex flex-col gap-2">
        <span className="font-serif text-[30px] leading-[1.05]">{title}</span>
        <span className="text-[14px] leading-[1.4]">{body}</span>
      </span>
    </>
  )
}

function WaysIn({ returning }: { returning: boolean }) {
  const navigate = useNavigate()
  const { continueAsGuest } = useAuth()
  const own = useEntryActions(FIRST_CHECKIN)
  const journey = useJourney()
  const samples = useSamples()
  const sample = samples.state === 'ready' ? samples.samples[0] : undefined
  const [sampleState, setSampleState] = useState<'idle' | 'starting' | 'failed'>('idle')

  const runSample = async () => {
    if (!sample || sampleState === 'starting') return
    setSampleState('starting')
    try {
      // Sample photos are copied into an account of your own, so a guest one is made when needed.
      await continueAsGuest()
    } catch {
      return setSampleState('failed')
    }
    leaveDemo()
    navigate(`/check-in?${new URLSearchParams({ site: sample.site, mode: sample.capture_mode, sample: sample.id })}`)
  }

  return (
    <section id="ways" className={`pt-[clamp(56px,8vw,110px)] ${pad} ${railRoom}`}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <h2 className="m-0 font-serif text-[clamp(36px,4.4vw,60px)] font-normal leading-none tracking-[-0.01em]">Four ways in</h2>
        <p className="m-0 max-w-[420px] text-[16px] leading-normal text-ink-2">
          The demo journey is our team’s own photos, measured by the live engine and read-only. Sample runs go through the real pipeline in a guest account of your own. Only your own capture creates personal results.
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-4">
        <button
          type="button"
          onClick={own.guest}
          disabled={own.pending !== null}
          className={`${wayCard} text-white`}
          style={{ background: 'radial-gradient(70% 50% at 70% 30%, #E7864A 0%, transparent 70%), linear-gradient(160deg, #B5A6A0 0%, #C2622F 45%, #4E1D0E 100%)' }}
        >
          <WayText
            tag="PERSONAL"
            title={returning ? 'Check in with your own photos' : 'Start my own baseline'}
            body={own.pending ? 'Starting…' : own.error ? <span role="alert">{own.error}</span> : returning ? 'A face check-in, compared with your own baseline.' : 'Consent, goals, then five photos of one site.'}
          />
        </button>

        <button
          type="button"
          disabled={journey.state !== 'ready'}
          onClick={() => {
            enterDemo()
            navigate('/home?demo=1')
          }}
          className={`${wayCard} text-white`}
          style={{ background: 'radial-gradient(60% 40% at 30% 60%, #9FC2C9 0%, transparent 70%), linear-gradient(200deg, #2F4A2A 0%, #3E6A6E 45%, #15241C 100%)' }}
        >
          <WayText
            tag={journey.state === 'unavailable' ? 'REAL JOURNEY · UNAVAILABLE' : 'REAL JOURNEY · READ-ONLY'}
            title="Walk our team’s proof journey"
            body={
              journey.state === 'ready'
                ? `Our own photos, measured by the same engine as yours. ${journeyLine(journey)}.`
                : journey.state === 'loading'
                  ? 'Checking the journey…'
                  : journeyUnavailableLine(journey)
            }
          />
        </button>

        <button
          type="button"
          disabled={!sample || sampleState === 'starting'}
          onClick={() => void runSample()}
          className={`${wayCard} text-[#2A2410]`}
          style={{ background: 'radial-gradient(70% 60% at 60% 40%, #FFF3B8 0%, transparent 70%), linear-gradient(150deg, #F3E7A6 0%, #D9B94A 50%, #6E5A12 100%)' }}
        >
          <span className="font-mono text-[12px] tracking-[.1em]">■ ACTUAL SAMPLE RUN</span>
          <span className="flex flex-col gap-2 text-white">
            <span className="font-serif text-[30px] leading-[1.05]">Run sample photos through the real pipeline</span>
            <span className="text-[14px] leading-[1.4]">
              {sampleState === 'starting'
                ? 'Starting…'
                : sampleState === 'failed'
                  ? <span role="alert">Could not start a guest session. Try again.</span>
                  : sample
                    ? `Live processing in a guest account of your own. ${sample.title}.`
                    : samples.state === 'loading'
                      ? 'Live processing, sample subject.'
                      : 'Sample photos are not available right now.'}
            </span>
          </span>
        </button>

        <Link
          to="/judge"
          className={`${wayCard} text-white hover:text-white`}
          style={{ background: 'radial-gradient(60% 50% at 50% 20%, #B8B4FF 0%, transparent 70%), linear-gradient(180deg, #5E64D6 0%, #2B2E8C 55%, #0E0F33 100%)' }}
        >
          <WayText tag={`JUDGE TOUR · ${JUDGE_STOPS.length} STOPS`} title="Guided tour, guest access" body="Sample run, proof journey, advisor, routine scan, retailer insights." />
        </Link>
      </div>
    </section>
  )
}

function How() {
  return (
    <section id="how" className={`pt-[clamp(72px,10vw,140px)] ${pad} ${railRoom}`}>
      {/* The design draws no title here; screen readers still get one so the h3 cards sit under a section. */}
      <h2 className="sr-only">How it works</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-4">
        <div className="flex flex-col gap-14 rounded-[36px] bg-surface p-8 shadow-[0_30px_60px_-40px_rgba(0,0,0,.25)]">
          <span className="font-dot text-[64px] font-extrabold leading-none text-ink">01</span>
          <div>
            <h3 className="m-0 mb-2.5 text-[26px] font-normal tracking-[-0.02em]">Five photos, one baseline</h3>
            <p className="m-0 leading-normal text-ink-2">On day one you take five photos, repositioning between each. The spread between them is your personal noise band.</p>
          </div>
        </div>
        <div
          className="flex flex-col gap-14 rounded-[36px] p-8"
          style={{ background: 'radial-gradient(80% 70% at 50% 100%, #FFB27A 0%, #FF6B4A 30%, rgba(242,95,168,.55) 60%, #FAFAF8 92%)', boxShadow: 'inset 0 0 40px 8px rgba(255,255,255,.55), 0 30px 60px -40px rgba(255,107,74,.6)' }}
        >
          <span className="font-dot text-[64px] font-extrabold leading-none">02</span>
          <div>
            <h3 className="m-0 mb-2.5 text-[26px] font-normal tracking-[-0.02em]">Three photos each time after</h3>
            <p className="m-0 leading-normal">Same light, pose and distance. Later readings are compared with your baseline, not with anyone else.</p>
          </div>
        </div>
        <div className="flex flex-col gap-14 rounded-[36px] bg-selected p-8 text-inverse shadow-[0_30px_60px_-30px_rgba(0,0,0,.5)]">
          <span className="font-dot text-[64px] font-extrabold leading-none text-lime">03</span>
          <div>
            <h3 className="m-0 mb-2.5 text-[26px] font-normal tracking-[-0.02em]">Real change, or normal variation</h3>
            <p className="m-0 leading-normal text-[#C9C6C0]">A change counts only when it is larger than your noise band in the same capture mode.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

const LIMITS = [
  {
    tag: 'MEASURED',
    title: 'Close-up pores and texture, forearm tone and redness',
    body: 'Marked measured when the photo carries its own reference: the iris sets the scale in a close-up, a white sheet corrects the light beside a RAW forearm photo.',
  },
  {
    tag: 'INDICATIVE',
    title: 'Face readings, blemish counts, lines, shine and glow',
    body: 'Faces carry no colour reference, so these are labelled indicative. A change outside your noise band is still reported; the label says how firm it is.',
  },
  { tag: 'NOT MEASURED', title: 'Hydration, firmness, UV damage', body: 'A phone photo cannot measure these honestly, so Willow does not try.' },
  { tag: 'NEVER SHOWN', title: 'Skin age, beauty scores, diagnoses', body: 'Tone is a description, never a score. No condition is ever named.' },
]

function Limits() {
  return (
    <section id="limits" className={`pt-[clamp(72px,10vw,140px)] ${pad} ${railRoom}`}>
      <h2 className="sr-only">What is measured, and what is not</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-px overflow-hidden rounded-[32px] bg-line">
        {LIMITS.map((l) => (
          <div key={l.tag} className="flex min-h-[200px] flex-col gap-3.5 bg-canvas p-7">
            <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ {l.tag}</span>
            <span className="text-[22px] font-normal tracking-[-0.01em]">{l.title}</span>
            <span className="text-[15px] leading-normal text-ink-2">{l.body}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

const EVIDENCE = [
  { tag: 'IN PLACE', tone: 'bg-lime text-ink', title: 'Tone-relative detection', body: 'Spots, blemishes and redness are found against your own median and spread. No detector uses a fixed lightness cut-off; tone bands only describe tone.' },
  { tag: 'IN PLACE', tone: 'bg-lime text-ink', title: 'Change only against yourself', body: 'No cross-person ranking. Retail aggregates count change against each person’s own baseline and never rank tone bands.' },
  { tag: 'NOT CLAIMED', tone: 'bg-selected text-inverse', title: 'Clinical validation', body: 'Willow has not been validated against clinical instruments. What it checks is repeatability, through your own noise band. Readings describe cosmetic appearance only.' },
]

function Fairness() {
  return (
    <section id="fairness" className={`pt-[clamp(72px,10vw,140px)] ${pad} ${railRoom}`}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-stretch gap-4">
        <div
          className="relative flex min-h-[420px] flex-col justify-between gap-10 overflow-hidden rounded-[44px] p-[clamp(26px,4vw,44px)] text-inverse"
          style={{ background: 'radial-gradient(60% 60% at 30% 20%, #6E5BFF 0%, transparent 70%), radial-gradient(60% 60% at 80% 90%, #F25FA8 0%, transparent 70%), #120C2E' }}
        >
          <span className="font-mono text-[12px] tracking-[.08em]">■ SKIN-TONE FAIRNESS</span>
          <h2 className="m-0 font-serif text-[clamp(36px,4.4vw,58px)] font-normal leading-none">Every threshold is relative to your own skin.</h2>
          <p className="m-0 max-w-[520px] leading-[1.55] text-[#E7E2FF]">
            Spot and redness detection compare each region with your own median and spread, never a fixed lightness cut-off. Tone is a description, not a score. Redness is reported as change from you, because it shows differently on deeper skin.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {EVIDENCE.map((e) => (
            <div key={e.title} className="flex flex-1 items-start gap-4 rounded-[30px] bg-surface px-[22px] py-5">
              <span className={`flex-none whitespace-nowrap rounded-pill px-2.5 py-1.5 font-mono text-[11px] ${e.tone}`}>{e.tag}</span>
              <span className="flex flex-col gap-1">
                <span className="text-[17px]">{e.title}</span>
                <span className="text-[14px] leading-[1.45] text-ink-2">{e.body}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

type FooterLink = { label: string; to: string; anchor?: boolean }
const FOOTER: { title: string; links: FooterLink[] }[] = [
  {
    title: 'PRODUCT',
    links: [
      { label: 'How it works', to: 'how', anchor: true },
      { label: 'Science and limits', to: 'science', anchor: true },
      { label: 'Judge tour', to: '/judge' },
    ],
  },
  {
    title: 'ACCOUNT',
    links: [
      { label: 'Sign in', to: '/signin' },
      { label: 'Create account', to: '/signin?mode=signup' },
      { label: 'Privacy and deletion', to: '/you' },
      { label: 'Terms and privacy notice', to: '/terms' },
    ],
  },
  {
    title: 'FOR BUSINESS',
    links: [
      { label: 'Fairness approach', to: 'fairness', anchor: true },
    ],
  },
]

function Footer() {
  return (
    <footer id="privacy" className={`relative overflow-hidden pt-[clamp(72px,10vw,140px)] ${pad} ${railRoom}`}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] items-start gap-8">
        <p className="col-span-full m-0 max-w-[560px] font-serif text-[clamp(28px,3vw,40px)] leading-[1.1] min-[400px]:col-span-2">
          Original photos are deleted 30 days after upload. You can delete everything, any time.
        </p>
        {FOOTER.map((c) => (
          <div key={c.title} className="flex flex-col gap-2.5">
            <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ {c.title}</span>
            {c.title === 'FOR BUSINESS' ? (
              <Link to="/retail" aria-label="Willow Proof, retail intelligence by Willow" className="mb-1 rounded-xs no-underline transition-opacity hover:opacity-70">
                <ProofLockup size={24} descriptor />
              </Link>
            ) : null}
            {c.links.map((l) =>
              l.anchor ? (
                <Anchor key={l.label} to={l.to} className="text-[15px] no-underline transition-colors hover:text-ink-2">
                  {l.label}
                </Anchor>
              ) : (
                <Link key={l.label} to={l.to} className="text-[15px] no-underline transition-colors hover:text-ink-2">
                  {l.label}
                </Link>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-14 flex flex-wrap justify-between gap-3 border-t border-line pt-5 text-[13px] text-ink-2">
        <span>© 2026 Willow · Cosmetic appearance tracking, not a medical device</span>
        <span>Built on Firebase, Cloud Run, Firestore, BigQuery and Gemini on Vertex AI</span>
        <span>Compared with your own baseline, on any skin tone</span>
      </div>
      <div aria-hidden className="w-wordmark relative mx-[-1vw] mt-[clamp(12px,2vw,28px)] select-none pb-[.06em] text-center text-[clamp(120px,29vw,560px)] font-light leading-[.78] tracking-[-0.065em]">
        willow
      </div>
    </footer>
  )
}
