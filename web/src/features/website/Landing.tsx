import './website.css'

import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { BarChart3, Building2, PlayCircle, Smartphone, type LucideIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { WillowIntro } from '../../components/willow/WillowLoader'
import { journeyViews, warmFirstPhoto } from '../../data/demoSource'
import { identity } from '../../lib/identity'
import { useAuth } from '../../lib/useAuth'
import { ProofLockup } from '../retail/brand'
import { Lockup } from './Decor'
import { HeroGarden } from './HeroGarden'
import { BRAND_JOURNEY_PATH, JOURNEY_PATH, PROOF_PATH, useOpenApp } from './destinations'
import { LiveStatus } from './Method'
import { SectionRail } from './SectionRail'
import { Culture, Gains, How, Problem, SectionHead, storySection, Unique } from './Story'
import { glide, SECTIONS, setupReveal } from './scroll'

const pad = 'px-[clamp(18px,4vw,52px)]'

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
 * The website (Willow.dc.html): intro loader each time the site opens, the hero with its ways in, then the story
 * (Story.tsx: who gains, the problem, how Willow fixes it on Google Cloud, what makes it different, the culture it
 * builds), the ways in again and the privacy footer, with the section rail. `/science` opens at the science section.
 */
export default function Landing() {
  const { pathname, hash } = useLocation()
  const [introDone, setIntroDone] = useState(false)

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

  return (
    <div className="min-h-dvh overflow-x-clip bg-canvas text-ink">
      <WillowIntro onDone={() => setIntroDone(true)} />
      <SectionRail ready={introDone} />
      {/* One main landmark for the page; the privacy footer stays outside it (contentinfo). */}
      <main>
        <Hero grow={introDone} />
        <Gains />
        <Problem />
        <How />
        <Unique />
        <Culture />
        <Try />
      </main>
      <Footer />
    </div>
  )
}

function Hero({ grow }: { grow: boolean }) {
  const { user, loading } = useAuth()
  const app = useOpenApp()
  const me = identity(user)
  return (
    <section id="top" className="w-sky relative min-h-[min(94vh,860px)] overflow-hidden rounded-b-[clamp(36px,5vw,64px)] text-ink">
      <div className="absolute inset-0">
        <HeroGarden start={grow} />
      </div>
      <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(249,227,204,.55) 0%, rgba(249,227,204,.25) 32%, rgba(249,227,204,0) 52%)' }} />

      <header className={`relative z-[2] flex flex-wrap items-center justify-between gap-4 py-[clamp(18px,3vw,32px)] ${pad}`}>
        <Lockup />
        {/* Sign-in lives here; the hero buttons below are the ways in. */}
        {loading ? null : app.signedIn ? (
          <span className="max-w-[60vw] truncate text-[14px] text-ink-2">Signed in as {me.email ?? me.name}</span>
        ) : (
          <Link to="/signin" className="cta-yellow flex min-h-11 items-center rounded-pill px-6 text-[15px] font-medium no-underline transition-[filter] hover:brightness-105">
            Sign in
          </Link>
        )}
      </header>

      <div className={`relative z-[2] grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-center gap-[clamp(28px,5vw,72px)] pb-[clamp(32px,6vh,64px)] pt-[clamp(28px,6vh,72px)] ${pad}`}>
        <div data-garden-copy className="flex animate-[wRiseLg_.9s_cubic-bezier(.2,.7,.2,1)_both] flex-col gap-7">
          <h1 className="m-0 text-[clamp(44px,5.4vw,84px)] font-light leading-[.96] tracking-[-0.035em]">
            See whether your skin <span className="font-serif font-normal italic tracking-[-0.01em]">really</span> changed.
          </h1>
          <p className="m-0 max-w-[520px] text-[clamp(17px,1.4vw,20px)] font-light leading-normal">
            Willow compares each standardized photo with your own baseline and tells you when a change is bigger than your normal photo-to-photo variation. Computer vision measures. AI explains. Cosmetic appearance tracking only, never a diagnosis.
          </p>
          <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ COSMETIC TRACKING · NOT A MEDICAL DEVICE</span>
        </div>
        {/* The ways in: four big buttons, the first thing a judge sees. */}
        <nav data-garden-calm aria-label="Ways in" className="relative flex w-full max-w-[500px] animate-[wRiseLg_.9s_.15s_cubic-bezier(.2,.7,.2,1)_both] flex-col gap-3.5 justify-self-center md:justify-self-end">
          <span aria-hidden className="pointer-events-none absolute -inset-6 -z-10 rounded-[52px] bg-[rgba(255,248,242,.34)] shadow-[0_30px_80px_-30px_rgba(60,40,90,.35)] blur-[18px]" />
          <WayIn to={JOURNEY_PATH} onWarm={warmJourney} tone="violet" icon={PlayCircle} title="Explore Mei’s journey" tag="judge experience" sub="Judges, start here: the quickest look. Her eight weeks play by themselves, then use the app yourself. Mei is simulated." />
          <WayIn to={BRAND_JOURNEY_PATH} tone="leaf" icon={Building2} title="Explore a brand’s journey" tag="judge experience" sub="How a skincare brand uses Proof, played for you" />
          <WayIn onClick={app.open} tone="coral" icon={Smartphone} title="Open the Willow app" tag="live app" sub={app.signedIn ? 'Your own account' : app.guest ? 'Your guest account on this browser' : 'Sign in, or look around as a guest'} />
          <WayIn to={PROOF_PATH} tone="sky" icon={BarChart3} title="Open Willow Proof" tag="live app" sub="For brands: which products measurably work, for whom" />
        </nav>
      </div>
    </section>
  )
}

/** The design's aura gradients (Willow App.dc.html AURA): violet, leaf, coral, sky, each with its own coloured glow. */
const glow = (c: string) => `0 26px 48px -24px ${c}, inset 0 0 0 1px rgba(255,255,255,.5), inset 0 0 50px rgba(255,255,255,.3)`
const WAY_TONE = {
  violet: { bg: 'radial-gradient(90% 90% at 0% 0%, #D8B8FF 0%, transparent 60%), radial-gradient(90% 100% at 100% 100%, #7A5CFF 0%, transparent 62%), radial-gradient(60% 60% at 85% 15%, #F25FA8 0%, transparent 70%), #A994FF', shadow: glow('rgba(122,92,255,.6)') },
  leaf: { bg: 'radial-gradient(90% 90% at 0% 0%, #B8E986 0%, transparent 60%), radial-gradient(90% 100% at 100% 100%, #4FB866 0%, transparent 62%), #9FD98A', shadow: glow('rgba(79,184,102,.55)') },
  coral: { bg: 'radial-gradient(90% 90% at 0% 0%, #FFB27A 0%, transparent 60%), radial-gradient(90% 100% at 100% 100%, #F25FA8 0%, transparent 62%), radial-gradient(70% 70% at 80% 10%, #FFD9C2 0%, transparent 70%), #FF8A70', shadow: glow('rgba(242,95,168,.55)') },
  sky: { bg: 'radial-gradient(90% 90% at 0% 0%, #9CD3FF 0%, transparent 60%), radial-gradient(90% 100% at 100% 100%, #3D7BFF 0%, transparent 62%), radial-gradient(60% 60% at 85% 10%, #E6F3FF 0%, transparent 70%), #7FA6FF', shadow: glow('rgba(61,123,255,.55)') },
} as const

/** One of the hero's ways in: a big glossy button (a link, or an action for "Open the Willow app"). The tag says which are played for judges and which are the live app. */
function WayIn({ to, onClick, onWarm, tone, icon: Icon, title, tag, sub }: { to?: string; onClick?: () => void; onWarm?: () => void; tone: keyof typeof WAY_TONE; icon: LucideIcon; title: string; tag: string; sub: string }) {
  const t = WAY_TONE[tone]
  const cls = `group relative flex min-h-[92px] w-full items-center gap-4 overflow-hidden rounded-[30px] py-4 pr-4 pl-6 text-left no-underline backdrop-blur-[14px] transition-[transform,filter] duration-200 hover:-translate-y-1 hover:brightness-[1.04] active:translate-y-0 active:scale-[.99] text-ink`
  const body = (
    <>
      <span aria-hidden className="pointer-events-none absolute inset-x-3 top-1 h-[45%] rounded-[24px] bg-gradient-to-b from-white/35 to-transparent" />
      <span className="relative flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[clamp(19px,1.7vw,23px)] leading-[1.15] font-medium tracking-[-0.01em]">
          {title} <span className="text-[.8em] font-normal whitespace-nowrap opacity-70">({tag})</span>
        </span>
        <span className="text-[13.5px] leading-[1.35] opacity-80">{sub}</span>
      </span>
      <span aria-hidden className={`relative grid size-12 flex-none place-items-center rounded-full transition-transform duration-200 group-hover:translate-x-0.5 bg-ink text-inverse`}>
        <Icon size={22} strokeWidth={1.8} />
      </span>
    </>
  )
  const style = { background: t.bg, boxShadow: t.shadow }
  const warm = onWarm ? { onPointerEnter: onWarm, onFocus: onWarm, onTouchStart: onWarm } : {}
  return to ? (
    <Link to={to} className={cls} style={style} {...warm}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} style={style} {...warm}>
      {body}
    </button>
  )
}

/** On the way to Mei's journey (pointer over, focus, touch): its code and her first photo start loading. */
function warmJourney() {
  void import('../journey/Journey')
  journeyViews().then(warmFirstPhoto, () => undefined)
}

/** The story ends where it starts: the ways in, for anyone who scrolled first. */
function Try() {
  const app = useOpenApp()
  return (
    <section id="try" className={storySection}>
      <SectionHead
        tag="SEE IT FOR YOURSELF"
        title="Watch it work, then use it."
        lead={
          <>
            Mei is simulated: her photos are generated by Gemini 3 Pro Image and show no real person, and every number is measured from them by the live engine. Both journeys are narrated with Gemini text-to-speech.{' '}
            <Link to="/judge" className="text-ink">
              Or take the guided judge tour
            </Link>
            .
          </>
        }
      />
      <nav aria-label="Ways in, again" className="grid gap-3 md:grid-cols-2">
        <WayIn to={JOURNEY_PATH} onWarm={warmJourney} tone="violet" icon={PlayCircle} title="Explore Mei’s journey" tag="judge experience" sub="Her eight weeks, narrated, with the app in between" />
        <WayIn to={BRAND_JOURNEY_PATH} tone="leaf" icon={Building2} title="Explore a brand’s journey" tag="judge experience" sub="How a skincare brand uses Proof, played for you" />
        <WayIn onClick={app.open} tone="coral" icon={Smartphone} title="Open the Willow app" tag="live app" sub={app.signedIn ? 'Your own account' : app.guest ? 'Your guest account on this browser' : 'Sign in, or look around as a guest'} />
        <WayIn to={PROOF_PATH} tone="sky" icon={BarChart3} title="Open Willow Proof" tag="live app" sub="For brands: which products measurably work, for whom" />
      </nav>
    </section>
  )
}

type FooterLink = { label: string; to: string; anchor?: boolean }
const FOOTER: { title: string; links: FooterLink[] }[] = [
  {
    title: 'PRODUCT',
    links: [
      { label: 'The problem', to: 'problem', anchor: true },
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
      { label: 'What retailers gain', to: 'gains', anchor: true },
      { label: 'Fairness approach', to: 'culture', anchor: true },
    ],
  },
]

function Footer() {
  return (
    <footer id="privacy" className={`relative overflow-hidden ${storySection}`}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] items-start gap-8">
        <p className="col-span-full m-0 max-w-[560px] font-serif text-[clamp(28px,3vw,40px)] leading-[1.1] min-[400px]:col-span-2">
          Original photos are deleted 30 days after upload. You can delete everything, any time.
        </p>
        {FOOTER.map((c) => (
          <div key={c.title} className="flex flex-col gap-2.5">
            <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ {c.title}</span>
            {c.title === 'FOR BUSINESS' ? (
              <Link to="/retail" aria-label="Proof by Willow, retail intelligence" className="mb-1 rounded-xs no-underline transition-opacity hover:opacity-70">
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
      <LiveStatus className="mt-12" />
      <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-line pt-5 text-[13px] text-ink-2">
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
