import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { journeyViews, warmFirstPhoto } from '../../data/demoSource'
import { toSession } from '../../data/live'
import type { Metric, Session } from '../../data/types'
import { enterDemo } from '../../data/useData'
import { fmtReading, METRIC_META, unitOf } from '../../lib/metrics'
import { wordsFor, verdictKind } from '../../lib/verdict'
import { setWalkthroughs, startSegment, walkthroughsOn } from '../tour/runner'
import { useImageStatus } from '../progress/useImageStatus'
import { MEI_CHAPTERS, MEI_WEEKS } from './meiSegments'
import { lineMs, lineShow, useSlideNarration } from './narration'
import { VoiceToggle } from './VoiceToggle'
import { BriefPoints, Point } from './value'

/**
 * /journey: Mei's eight weeks as a story a judge can sit back and watch, framed by the problem it answers. Mei is
 * simulated (generated photos of no real person); every number on a slide is her real measurement from the live
 * engine, every headline is Gemini's explanation of it and every note is hers, all read from /v1/demo/journey.
 * The problem first (shoppers can't tell what works, retailers see purchases and not outcomes), then Mei, then five
 * chapters (weeks 1, 2-3, 4-5, 6-7, 8; MEI_CHAPTERS) that each say what she gains and what her retailer gains,
 * then the two gains side by side against the brief, then where she ended up. Between chapters a short walkthrough
 * plays her real demo account (meiSegments.ts, features/tour) and comes back to the next slide (?at=); judges can
 * turn the walkthroughs off.
 */

const SLIDE_MS = 7000
// The problem and the two gains carry more words: longer on screen.
const READ_MS = 12000
const FACE_IDS: Metric['id'][] = ['blemishes', 'redness', 'pigment_spots', 'shine', 'tone_evenness']
const CLOSE_IDS: Metric['id'][] = ['pores', 'texture']
const DAY_MS = 86_400_000

type Week = { face: Session; close: Session | null; week: number }
type Chapter = { weeks: Week[]; i: number }
type Slide = { kind: 'problem' } | { kind: 'intro' } | { kind: 'chapter'; c: Chapter } | { kind: 'mei' } | { kind: 'retail' } | { kind: 'end' }

/**
 * Each chapter: its title, then (under the paragraph that says what happened, voice.json `mei-c<n>`, and her data)
 * the features Mei used and what each gave her, and what it is worth to the retailer that sold her the products.
 */
const CHAPTERS: { title: string; used: [string, string][]; retail: string }[] = [
  {
    title: 'Her baseline',
    used: [
      ['Guided check-in', 'Three photos by the window and a cheek close-up, each checked for light and framing before it counts.'],
      ['Personal baseline', 'Every later week is read against her own skin and normal range, never anyone else’s.'],
      ['Routine list', 'What she uses, from any brand, lined up with her readings from day one.'],
    ],
    retail: 'Her goal and her whole routine, across brands. Not just a basket.',
  },
  {
    title: 'Weeks 2–3: a new routine',
    used: [
      ['Photo checks', 'A turned head isn’t compared with her front-on baseline, and Willow says so.'],
      ['Wisp, the adviser', 'Answers “should I stop one?” from her own data, without inventing a number.'],
      ['Routine check', 'Names the retinol and BHA clash, with a one-tap fix.'],
    ],
    retail: 'A clash caught early, before she gives up on both products or sends them back.',
  },
  {
    title: 'Weeks 4–5: a rough week, read honestly',
    used: [
      ['Normal range', 'A rise inside her own everyday variation isn’t called a change.'],
      ['Side-by-side compare', 'Her baseline next to this week, same light, same distance.'],
      ['Routine history', 'The BHA she stopped keeps its dates, so its effect can still be read.'],
    ],
    retail: 'Outcome data it can trust: everyday noise never counts as a change.',
  },
  {
    title: 'Weeks 6–7: what’s working',
    used: [
      ['Is it working?', 'Each product next to the reading it targets, since the day she started it.'],
      ['Duplicate check', 'Spots three products with niacinamide in one routine.'],
    ],
    retail: 'Which product in a mixed-brand routine goes with a visible change: what no single brand can see.',
  },
  {
    title: 'Week 8: keep, stop, save',
    used: [
      ['Hold to compare', 'Week 8 against week 1 in one gesture: what clearly changed, and what hasn’t yet.'],
      ['Wisp, the adviser', 'Tells her whether she needs both niacinamide serums.'],
      ['Stop a product', 'One less product to rebuy; its history stays for the record.'],
    ],
    retail: 'A customer who rebuys what worked for her, and one more measured outcome for Proof.',
  },
]

/** The narration line each slide speaks (voice.json). */
const voiceOf = (s: Slide | undefined) =>
  !s ? undefined : s.kind === 'chapter' ? `mei-c${s.c.i + 1}` : ({ problem: 'mei-problem', intro: 'mei-intro', mei: 'mei-gains', retail: 'mei-retail', end: 'mei-end' } as const)[s.kind]
// After a slide's line has been said, a short breath before the next slide.
const GAP_MS = 1100

const dayOf = (iso: string) => iso.slice(0, 10)
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export default function Journey() {
  const navigate = useNavigate()
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [weeks, setWeeks] = useState<Week[]>([])
  const [params] = useSearchParams()
  const [i, setI] = useState(() => Math.max(0, Number(params.get('at')) || 0))
  const [paused, setPaused] = useState(false)
  const [walk, setWalk] = useState(walkthroughsOn)
  const touch = useRef<number | null>(null)
  const iRef = useRef(0)

  useEffect(() => {
    let alive = true
    // The landing page has usually asked for the journey already; her first photo starts loading with it.
    journeyViews()
      .then((views) => {
        warmFirstPhoto(views)
        if (!alive) return
        const done = views.map(toSession).filter((s) => s.status === 'done' && s.result)
        const faces = done.filter((s) => s.site === 'face_full').sort((a, b) => a.created_at.localeCompare(b.created_at))
        const closes = done.filter((s) => s.site !== 'face_full')
        const start = faces[0] ? new Date(faces[0].created_at).getTime() : 0
        setWeeks(faces.map((f) => ({ face: f, close: closes.find((c) => dayOf(c.created_at) === dayOf(f.created_at)) ?? null, week: Math.round((new Date(f.created_at).getTime() - start) / (7 * DAY_MS)) })))
        setState(faces.length ? 'ready' : 'error')
      })
      .catch(() => alive && setState('error'))
    return () => {
      alive = false
    }
  }, [])

  const slides: Slide[] = useMemo(() => {
    const chapters = MEI_CHAPTERS.map((c, k) => ({ weeks: c.weeks.map((n) => weeks[n]).filter((w): w is Week => Boolean(w)), i: k })).filter((c) => c.weeks.length)
    return [{ kind: 'problem' }, { kind: 'intro' }, ...chapters.map((c) => ({ kind: 'chapter' as const, c })), { kind: 'mei' }, { kind: 'retail' }, { kind: 'end' }]
  }, [weeks])
  const last = slides.length - 1
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)))
  // Forward from a chapter slide: that chapter in the app first (when walkthroughs are on), then the next slide.
  const forward = (from: number) => {
    const s = slides[from]
    const seg = s?.kind === 'chapter' ? MEI_WEEKS[s.c.i] : undefined
    if (walk && seg) startSegment(seg, `/journey?at=${from + 1}`)
    else go(from + 1)
  }
  const { narrated, finished } = useSlideNarration(i, voiceOf(slides[i]), voiceOf(slides[i + 1]), state === 'ready', paused)
  // how long this slide stays: its line and a breath when narrated, else its own time
  const slideMs = (k: number) => (narrated && k === i ? lineMs(voiceOf(slides[k]) ?? '') + GAP_MS : msOf(slides[k]))
  const forwardRef = useRef(forward)
  useEffect(() => {
    forwardRef.current = forward
    iRef.current = i
  })
  const toggleWalk = () => {
    setWalkthroughs(!walk)
    setWalk(!walk)
  }

  useEffect(() => {
    if (state !== 'ready' || paused || i >= last) return
    if (narrated && !finished) return // the slide waits for its line
    const t = window.setTimeout(() => forwardRef.current(i), narrated ? GAP_MS : msOf(slides[i]))
    return () => window.clearTimeout(t)
  }, [i, paused, state, last, slides, narrated, finished])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') forwardRef.current(iRef.current)
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
      else if (e.key === ' ') {
        e.preventDefault()
        setPaused((p) => !p)
      } else if (e.key === 'Escape') navigate('/')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [last, navigate])

  const openApp = () => {
    enterDemo()
    navigate('/home?demo=1')
  }

  const slide = slides[i]
  const nextSlide = slides[i + 1]
  const first = weeks[0]
  const latest = weeks.at(-1)
  const firstShown = useImageStatus(first?.face.preview?.url ?? null) !== 'loading'

  return (
    <main
      className="flex min-h-dvh flex-col bg-[#F3F1EC] text-ink"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return
        const dx = e.changedTouches[0].clientX - touch.current
        touch.current = null
        if (Math.abs(dx) > 50) {
          if (dx < 0) forward(i)
          else go(i - 1)
        }
      }}
    >
      <header className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 px-[clamp(16px,3vw,32px)] pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="mr-auto flex items-center gap-2.5">
            <span className="font-serif text-[22px]">willow</span>
            <span className="rounded-pill bg-ink/[.06] px-3 py-1 text-[12.5px] text-ink-2">
              <span className="hidden md:inline">Mei is simulated · generated photos, real measurements</span>
              <span className="md:hidden">Simulated</span>
            </span>
          </span>
          <VoiceToggle />
          <button type="button" role="switch" aria-checked={walk} onClick={toggleWalk} className="flex min-h-11 items-center gap-2 rounded-pill px-3 text-[13px] text-ink-2 hover:bg-ink/5">
            <span className={`relative h-5 w-9 rounded-full transition-colors ${walk ? 'bg-ink' : 'bg-ink/20'}`} aria-hidden>
              <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${walk ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
            <span className="hidden md:inline">Show her in the app between chapters</span>
            <span className="whitespace-nowrap md:hidden">In the app</span>
          </button>
          <button type="button" onClick={() => navigate('/')} aria-label="Close the journey" className="grid size-11 place-items-center rounded-full hover:bg-ink/5">
            <X size={20} strokeWidth={1.6} />
          </button>
        </div>
        {state === 'ready' ? (
          <div className="flex gap-1" aria-hidden>
            {slides.map((_, k) => (
              <button key={k} type="button" tabIndex={-1} onClick={() => go(k)} className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
                <span
                  key={`${k}-${i}`}
                  className="block h-full origin-left rounded-full bg-ink"
                  style={k < i ? undefined : k === i && i < last ? { animation: `wFill ${slideMs(k)}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' } : { transform: k === i ? undefined : 'scaleX(0)' }}
                />
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <section aria-live="polite" className="mx-auto flex w-full max-w-[1180px] flex-1 items-center px-[clamp(16px,3vw,32px)] py-5">
        {/* the problem needs no data: it shows at once while her journey loads */}
        {state === 'loading' ? i === 0 ? <Problem /> : <IntroSkeleton /> : null}
        {state === 'error' ? (
          <div className="m-auto flex flex-col items-center gap-3 text-center">
            <p className="m-0 text-[17px]">Mei’s journey can’t be read right now.</p>
            <button type="button" onClick={() => navigate('/')} className="min-h-11 rounded-pill bg-selected px-5 text-inverse">
              Back to Willow
            </button>
          </div>
        ) : null}
        {state === 'ready' && slide.kind === 'problem' ? <Problem /> : null}
        {state === 'ready' && slide.kind === 'intro' && first ? <Intro face={first.face} count={weeks.length} closeUps={weeks.filter((w) => w.close).length} /> : null}
        {state === 'ready' && slide.kind === 'chapter' ? <ChapterSlide c={slide.c} total={MEI_CHAPTERS.length} /> : null}
        {state === 'ready' && slide.kind === 'mei' ? <MeiGains count={weeks.length} /> : null}
        {state === 'ready' && slide.kind === 'retail' ? <RetailGains onBrand={() => navigate('/journey/brand')} /> : null}
        {state === 'ready' && slide.kind === 'end' && first && latest ? <End first={first} latest={latest} onApp={openApp} onBrand={() => navigate('/journey/brand')} onProof={() => navigate('/retail')} onOwn={() => navigate('/welcome')} /> : null}
      </section>

      {state === 'ready' ? (
        <footer className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-3 px-[clamp(16px,3vw,32px)] pb-5">
          <button type="button" onClick={() => go(i - 1)} disabled={i === 0} className="flex min-h-11 items-center gap-1 rounded-pill bg-white px-4 shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)] disabled:opacity-40">
            <ChevronLeft size={18} /> Back
          </button>
          <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'} className="grid size-11 place-items-center rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]">
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          {i < last ? (
            <button type="button" onClick={() => forward(i)} className="flex min-h-11 items-center gap-1 rounded-pill bg-selected px-5 text-inverse">
              {walk && slide?.kind === 'chapter' ? MEI_WEEKS[slide.c.i]?.title ?? 'Next' : 'Next'} <ChevronRight size={18} />
            </button>
          ) : (
            <button type="button" onClick={openApp} className="min-h-11 rounded-pill bg-selected px-5 text-inverse">
              Open Mei’s account
            </button>
          )}
        </footer>
      ) : null}
      {/* the next photos load while this slide plays (after her first photo, so they never slow it down) */}
      <div hidden>{nextSlide?.kind === 'chapter' && (i > 0 || firstShown) ? <Prefetch w={nextSlide.c.weeks.at(-1) as Week} /> : null}</div>
    </main>
  )
}

const msOf = (s: Slide | undefined) => (s?.kind === 'problem' || s?.kind === 'mei' || s?.kind === 'retail' ? READ_MS : SLIDE_MS)

function Prefetch({ w }: { w: Week }) {
  return (
    <>
      {w.face.preview ? <img src={w.face.preview.url} alt="" /> : null}
      {w.close?.preview ? <img src={w.close.preview.url} alt="" /> : null}
    </>
  )
}

/** A check-in photo (3:4). A shimmer holds its place until it has loaded, then the photo fades in. `first` is the
 * "Meet Mei" photo, the slide's largest image: fetched at high priority. */
function Photo({ s, label, className = '', first = false }: { s: Session; label: string; className?: string; first?: boolean }) {
  const url = s.preview?.url ?? null
  const status = useImageStatus(url)
  if (!s.preview || status === 'failed')
    return <div className={`grid aspect-[3/4] w-full place-items-center rounded-[24px] bg-ink/5 text-ink-2 ${className}`}>No photo</div>
  const ready = status === 'ready'
  return (
    <div className={`relative aspect-[3/4] w-full overflow-hidden rounded-[24px] squircle ${className}`}>
      {ready ? null : <span aria-hidden className="skeleton absolute inset-0 rounded-none" style={SHIMMER} />}
      <img
        src={s.preview.url}
        alt={label}
        width={s.preview.width ?? 1200}
        height={s.preview.height ?? 1600}
        decoding="async"
        fetchPriority={first ? 'high' : 'auto'}
        className="relative size-full object-cover transition-opacity duration-300"
        style={{ opacity: ready ? 1 : 0 }}
      />
    </div>
  )
}

/** "Meet Mei" while her journey is read: the slide's own layout, its photo and lines as shimmers. */
function IntroSkeleton() {
  return (
    <div role="status" aria-label="Loading Mei’s journey" className="grid w-full items-center gap-[clamp(20px,4vw,56px)] md:grid-cols-[minmax(0,.8fr)_minmax(0,1fr)]">
      <span aria-hidden className={`skeleton aspect-[3/4] w-full rounded-[24px] squircle ${INTRO_PHOTO}`} style={SHIMMER} />
      <div aria-hidden className="flex flex-col gap-4">
        <h1 className="m-0 font-serif text-[clamp(40px,5vw,72px)] leading-[.95] font-normal">Meet Mei</h1>
        {/* the two paragraphs' lines, so the heading does not move when they arrive */}
        <span className="flex max-w-[520px] flex-col gap-[clamp(10px,1vw,13px)] py-1">
          {['100%', '96%', '100%', '58%'].map((w, k) => (
            <span key={k} className="skeleton h-[clamp(14px,1.2vw,16px)]" style={{ ...SHIMMER, width: w }} />
          ))}
        </span>
        <span className="flex max-w-[520px] flex-col gap-2 pt-1">
          {['100%', '100%', '100%', '40%'].map((w, k) => (
            <span key={k} className="skeleton h-3" style={{ ...SHIMMER, width: w }} />
          ))}
        </span>
      </div>
    </div>
  )
}

// The shimmer a shade darker than the app's: the journey's page is the warm #F3F1EC, where the usual one barely shows.
const SHIMMER = { background: 'linear-gradient(90deg, #E7E4DD 25%, #DAD6CE 50%, #E7E4DD 75%)', backgroundSize: '200% 100%' }

// 3:4 and no taller than 68% of the screen
const INTRO_PHOTO = 'max-w-[calc(68dvh*.75)] justify-self-center'

function Intro({ face, count, closeUps }: { face: Session; count: number; closeUps: number }) {
  return (
    <div className="grid w-full items-center gap-[clamp(20px,4vw,56px)] md:grid-cols-[minmax(0,.8fr)_minmax(0,1fr)]" style={{ animation: 'wRise .5s both' }}>
      <Photo s={face} label="Mei's first check-in selfie" className={INTRO_PHOTO} first />
      <div className="flex flex-col gap-4">
        <h1 className="m-0 font-serif text-[clamp(40px,5vw,72px)] leading-[.95] font-normal">Meet Mei</h1>
        <p className="m-0 max-w-[520px] text-[clamp(16px,1.4vw,19px)] leading-[1.5] text-pretty">
          Mei is 26, lives in Singapore and has acne along her cheeks, jaw and chin. She checks in with Willow every Sunday evening: {count} face check-ins and {closeUps} cheek close-ups over eight weeks, while she changes her routine.
        </p>
        <p className="m-0 max-w-[520px] text-[14px] leading-[1.5] text-ink-2">
          Mei is simulated: her photos are generated and show no real person. Every number in this story was measured from them by Willow’s live engine and explained by Gemini, exactly as for anyone. Her eight weeks play in five chapters, by themselves; tap or use the arrow keys to move faster.
        </p>
      </div>
    </div>
  )
}

function Reading({ m, s, compact = false }: { m: Metric; s: Session; compact?: boolean }) {
  const unit = m.value === null ? '' : unitOf(m).trim()
  const words = wordsFor(m, s)
  const kind = verdictKind(m, s)
  const tone = kind === 'changed' ? (words.label === 'Improved' ? 'bg-[#DDF3C9]' : words.label === 'Moved the other way' ? 'bg-[#FFE3CF]' : 'bg-[#E9E2FF]') : 'bg-white/70'
  return (
    <li className={`flex items-center justify-between gap-3 rounded-[16px] px-3.5 ${compact ? 'py-2' : 'py-2.5'} ${tone}`}>
      <span className="flex min-w-0 flex-col">
        <span className="text-[14.5px]">{METRIC_META[m.id].label}</span>
        <span className="text-[12.5px] text-ink-2">
          <span aria-hidden>{words.glyph} </span>
          {kind === 'changed' && m.delta !== null ? `${words.label}: ${m.delta < 0 ? METRIC_META[m.id].decrease : METRIC_META[m.id].increase}` : words.label}
        </span>
      </span>
      <span className="flex flex-none items-baseline gap-1">
        <span className={`font-dot tnum ${compact ? 'text-[19px]' : 'text-[22px]'}`}>{fmtReading(m.value, m)}</span>
        {unit ? <span className="text-[11px] text-ink-2">{unit}</span> : null}
      </span>
    </li>
  )
}

function pick(s: Session, ids: Metric['id'][]) {
  return ids.map((id) => s.result?.metrics.find((m) => m.id === id)).filter((m): m is Metric => Boolean(m))
}

/** What a chapter was worth, last on its slide: each feature Mei used and what it gave her, then what the retailer gains. */
function Gains({ used, retail }: { used: [string, string][]; retail: string }) {
  return (
    <div className="grid gap-2 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <div className="rounded-[18px] bg-[#EEF7E6] px-4 py-3">
        <span className="text-[12.5px] text-ink-2">What she used, and what it gave her</span>
        <ul className="m-0 mt-1.5 grid list-none gap-1.5 p-0">
          {used.map(([f, g]) => (
            <li key={f} className="text-[13px] leading-[1.4]">
              <span className="font-medium">{f}:</span> {g}
            </li>
          ))}
        </ul>
      </div>
      <p className="m-0 flex flex-col gap-0.5 rounded-[18px] bg-[#ECEFFB] px-4 py-3 text-[13px] leading-[1.4]">
        <span className="text-[12.5px] text-ink-2">For the retailer</span>
        {retail}
      </p>
    </div>
  )
}

/** A chapter: what happened (the paragraph the narration reads), then her measured data, then what it was worth. */
function ChapterSlide({ c, total }: { c: Chapter; total: number }) {
  const w = c.weeks.at(-1) as Week
  const { face, close } = w
  const copy = CHAPTERS[c.i]
  const firstDay = c.weeks[0].face.created_at
  const note = face.note ?? c.weeks.find((x) => x.face.note)?.face.note
  const story = lineShow(`mei-c${c.i + 1}`)
  return (
    <div key={face.id} className="grid w-full items-start gap-[clamp(20px,3.4vw,48px)] md:grid-cols-[minmax(0,.72fr)_minmax(0,1fr)]" style={{ animation: 'wRise .45s both' }}>
      <div className="flex flex-col">
        <div className="relative">
          <Photo s={face} label={`Mei's face check-in, ${when(face.created_at)}`} className="max-h-[60dvh]" />
          {close ? (
            <div className="absolute right-3 bottom-3 w-[34%] max-w-[160px] rounded-[18px] bg-white p-1 shadow-[0_18px_40px_-20px_rgba(0,0,0,.5)]">
              <Photo s={close} label={`Mei's cheek close-up, ${when(close.created_at)}`} className="rounded-[14px]" />
              <span className="block px-1.5 py-1 text-[11px] text-ink-2">Cheek close-up</span>
            </div>
          ) : null}
        </div>
        {note ? (
          <blockquote className="m-0 mt-3 border-l-2 border-ink/20 pl-3.5 text-[14px] leading-[1.45] text-pretty">
            “{note}”<span className="mt-0.5 block text-[12px] text-ink-2">Mei’s note, {when(face.created_at)}</span>
          </blockquote>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-ink-2">
            Chapter {c.i + 1} of {total} · {c.weeks.length > 1 ? `${when(firstDay)} to ${when(face.created_at)}` : when(face.created_at)}
          </span>
          <h2 className="m-0 font-serif text-[clamp(30px,3.4vw,46px)] leading-none font-normal text-balance">{copy?.title ?? (face.is_baseline ? 'Her baseline' : `Week ${w.week}`)}</h2>
        </div>
        {story ? <p className="m-0 max-w-[620px] text-[clamp(15px,1.2vw,17px)] leading-[1.5] text-pretty">{story}</p> : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-ink-2">
            Her readings on {when(face.created_at)}, against her baseline{face.explanation?.headline ? ` · Gemini: “${face.explanation.headline}”` : ''}
          </span>
          <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {[...pick(face, FACE_IDS).map((m) => ({ m, s: face })), ...(close ? pick(close, CLOSE_IDS).map((m) => ({ m, s: close })) : [])].map(({ m, s }) => (
              <Reading key={`${s.id}-${m.id}`} m={m} s={s} compact />
            ))}
          </ul>
        </div>
        {copy ? <Gains used={copy.used} retail={copy.retail} /> : null}
      </div>
    </div>
  )
}

function SlideHead({ kicker, title, lead }: { kicker: string; title: string; lead: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[13px] text-ink-2">{kicker}</span>
      <h2 className="m-0 font-serif text-[clamp(34px,4.2vw,60px)] leading-[.98] font-normal text-balance">{title}</h2>
      <p className="m-0 max-w-[540px] text-[clamp(15px,1.3vw,18px)] leading-[1.5] text-pretty">{lead}</p>
    </div>
  )
}

/** Public survey figures behind the problem, each with its source. Drawn to scale: the bar is the share. */
const PROBLEM_STATS: { group: string; rows: { pct: number; label: string; value?: string; source: string; good?: boolean }[] }[] = [
  {
    group: 'Shoppers can’t tell what works',
    rows: [
      { pct: 90, label: 'are frustrated finding skincare products that work', source: 'Drive Research, 1,004 women' },
      { pct: 62, label: 'worry about ineffective results', source: 'Drive Research, 1,004 women' },
      { pct: 15, label: 'think their wrinkle products work very well', source: 'Drive Research, 1,004 women' },
    ],
  },
  {
    group: 'So money is wasted',
    rows: [
      { pct: 52, label: 'of Gen Z regret overspending on beauty', source: 'LendingTree, US' },
      { pct: 50, value: '~50%', label: 'have kept unused skincare for over a year', source: 'Consumer Council, Hong Kong' },
    ],
  },
  {
    group: 'And proof is worth paying for',
    rows: [{ pct: 85, label: 'would pay more for products with proven efficacy', source: 'Euromonitor, Top Global Consumer Trends 2024', good: true }],
  },
]

/** The problem Willow answers, before anyone meets Mei: shoppers can't tell what works; retailers can't see it. */
function Problem() {
  return (
    <div className="grid w-full items-center gap-[clamp(20px,4vw,56px)] md:grid-cols-[minmax(0,.9fr)_minmax(0,1fr)]" style={{ animation: 'wRise .5s both' }}>
      <div className="flex flex-col gap-5">
        <SlideHead
          kicker="The problem"
          title="Skincare is sold on claims. Nobody sees whether it worked."
          lead="Willow measures the outcome from ordinary phone photos, then gives it to the shopper and to the retailer that sold the product."
        />
        <div className="grid max-w-[540px] grid-cols-2 gap-2">
          <p className="m-0 flex flex-col gap-0.5 rounded-[18px] bg-white/75 px-4 py-3">
            <span className="text-[clamp(24px,2.4vw,32px)] leading-none tracking-[-0.02em] tnum">£1 billion+</span>
            <span className="text-[13px] leading-[1.35] text-ink-2">of unused skincare sits in UK homes (The Body Shop, 2,000 adults)</span>
          </p>
          <p className="m-0 flex flex-col gap-0.5 rounded-[18px] bg-[#ECEFFB] px-4 py-3">
            <span className="text-[15px] leading-[1.3]">Retailers see purchases, never outcomes</span>
            <span className="text-[13px] leading-[1.35] text-ink-2">Routines mix brands, so no single brand sees what changed. A multi-brand retailer could.</span>
          </p>
        </div>
      </div>
      <figure className="m-0 flex flex-col gap-4 rounded-[24px] bg-white/70 p-[clamp(16px,2vw,24px)]">
        {PROBLEM_STATS.map((g) => (
          <div key={g.group} className="flex flex-col gap-2">
            <span className="text-[13px] text-ink-2">{g.group}</span>
            <ul className="m-0 grid list-none gap-2.5 p-0">
              {g.rows.map((r) => (
                <li key={r.label} className="grid grid-cols-[3.4em_minmax(0,1fr)] items-baseline gap-x-3">
                  <span className={`text-[clamp(20px,2vw,26px)] leading-none tracking-[-0.02em] tnum ${r.good ? 'text-[#1F7F45]' : ''}`}>{r.value ?? `${r.pct}%`}</span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-[14px] leading-[1.35]">{r.label}</span>
                    <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-ink/[.07]">
                      <span className={`block h-full origin-left rounded-full ${r.good ? 'bg-[#1F7F45]' : 'bg-[#C8603A]'}`} style={{ width: `${r.pct}%`, animation: 'wFill .9s cubic-bezier(.2,.7,.2,1) .2s both' }} />
                    </span>
                    <span className="text-[11.5px] text-ink-2">{r.source}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </figure>
    </div>
  )
}

/** What eight Sundays gave Mei, from her own data. */
function MeiGains({ count }: { count: number }) {
  return (
    <div className="grid w-full items-center gap-[clamp(20px,4vw,56px)] md:grid-cols-[minmax(0,.8fr)_minmax(0,1fr)]" style={{ animation: 'wRise .45s both' }}>
      <SlideHead kicker="What the shopper gains" title="Mei knows what works for her skin" lead={`${count} Sunday check-ins with her phone. Instead of guessing, she has answers.`} />
      <ul className="m-0 grid list-none gap-2 p-0">
        <Point title="Proof, not a feeling">Each reading against her own baseline and normal range: what clearly changed, and what hasn’t moved yet.</Point>
        <Point title="Problems caught in a week">A retinol and BHA clash, then a duplicate serum, each with a one-tap fix.</Point>
        <Point title="Less money wasted">She stopped a product she didn’t need and keeps the ones that go with her change.</Point>
        <Point title="Advice in her own words">Wisp answers from her measurements and routine, and never invents a number.</Point>
      </ul>
    </div>
  )
}

/** What the retailer gains, against the four parts of the Retail & Commerce brief. */
function RetailGains({ onBrand }: { onBrand: () => void }) {
  return (
    <div className="grid w-full items-center gap-[clamp(20px,4vw,56px)] md:grid-cols-[minmax(0,.8fr)_minmax(0,1fr)]" style={{ animation: 'wRise .45s both' }}>
      <div className="flex flex-col gap-4">
        <SlideHead
          kicker="What the retailer gains"
          title="Outcomes, not just purchases"
          lead="With consent and only in aggregate, check-ins like Mei’s become Proof by Willow: the retailer’s view of what actually works, and for whom."
        />
        <button type="button" onClick={onBrand} className="min-h-11 self-start rounded-pill bg-white px-5 text-[14.5px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.15)]">
          See how a brand uses Proof
        </button>
      </div>
      <BriefPoints />
    </div>
  )
}

function End({ first, latest, onApp, onBrand, onProof, onOwn }: { first: Week; latest: Week; onApp: () => void; onBrand: () => void; onProof: () => void; onOwn: () => void }) {
  const ms = pick(latest.face, FACE_IDS)
  return (
    <div className="grid w-full items-center gap-[clamp(20px,3.4vw,48px)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" style={{ animation: 'wRise .45s both' }}>
      <div className="grid grid-cols-2 gap-2.5">
        <figure className="m-0 flex flex-col gap-1.5">
          <Photo s={first.face} label="Mei at her baseline" />
          <figcaption className="text-[12.5px] text-ink-2">Baseline · {when(first.face.created_at)}</figcaption>
        </figure>
        <figure className="m-0 flex flex-col gap-1.5">
          <Photo s={latest.face} label="Mei at her latest check-in" />
          <figcaption className="text-[12.5px] text-ink-2">Latest · {when(latest.face.created_at)}</figcaption>
        </figure>
      </div>
      <div className="flex flex-col gap-4">
        <h2 className="m-0 font-serif text-[clamp(32px,3.6vw,52px)] leading-none font-normal">Eight weeks later</h2>
        <p className="m-0 max-w-[520px] text-[15px] leading-[1.5] text-ink-2">Each reading against her own baseline and normal range: what clearly changed, and what has not moved yet.</p>
        <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2">
          {ms.map((m) => (
            <Reading key={m.id} m={m} s={latest.face} />
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={onApp} className="min-h-12 rounded-pill bg-selected px-6 text-[15px] text-inverse">
            Open Mei’s account
          </button>
          <button type="button" onClick={onProof} className="min-h-12 rounded-pill bg-white px-6 text-[15px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.15)]">
            Open Willow Proof
          </button>
          <button type="button" onClick={onOwn} className="min-h-12 rounded-pill bg-white px-6 text-[15px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.15)]">
            Start my own baseline
          </button>
        </div>
        <button type="button" onClick={onBrand} className="self-start text-[14px] text-ink-2 underline underline-offset-4">
          See how a brand uses Willow Proof
        </button>
        <p className="m-0 text-[12.5px] text-ink-2">Cosmetic appearance only, not a medical assessment.</p>
      </div>
    </div>
  )
}
