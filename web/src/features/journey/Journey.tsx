import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { journeyViews, warmFirstPhoto } from '../../data/demoSource'
import { toSession } from '../../data/live'
import type { Metric, Session } from '../../data/types'
import { enterDemo } from '../../data/useData'
import { fmtReading, METRIC_META, unitOf } from '../../lib/metrics'
import { wordsFor, verdictKind } from '../../lib/verdict'
import { setWalkthroughs, startSegment, walkthroughsOn } from '../tour/runner'
import { useImageStatus } from '../progress/useImageStatus'
import { MEI_WEEKS } from './meiSegments'

/**
 * /journey: Mei's eight weeks as a story a judge can sit back and watch. Mei is simulated (generated photos of no
 * real person); every number on a slide is her real measurement from the live engine, every headline is Gemini's
 * explanation of it and every note is hers, all read from /v1/demo/journey. One slide per face check-in (with the
 * cheek close-up taken the same evening), then where she ended up, then the way into her full app. Between weeks a
 * short walkthrough plays her real demo account (meiSegments.ts, features/tour) and comes back to the next slide
 * (?at=); judges can turn the walkthroughs off.
 */

const SLIDE_MS = 7000
const FACE_IDS: Metric['id'][] = ['blemishes', 'redness', 'pigment_spots', 'shine', 'tone_evenness']
const CLOSE_IDS: Metric['id'][] = ['pores', 'texture']
const DAY_MS = 86_400_000

type Week = { face: Session; close: Session | null; week: number }
type Slide = { kind: 'intro' } | { kind: 'week'; w: Week; i: number } | { kind: 'end' }

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

  const slides: Slide[] = useMemo(() => [{ kind: 'intro' }, ...weeks.map((w, k) => ({ kind: 'week' as const, w, i: k })), { kind: 'end' }], [weeks])
  const last = slides.length - 1
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)))
  // Forward from a week slide: that week in the app first (when walkthroughs are on), then the next slide.
  const forward = (from: number) => {
    const s = slides[from]
    const seg = s?.kind === 'week' ? MEI_WEEKS[s.i] : undefined
    if (walk && seg) startSegment(seg, `/journey?at=${from + 1}`)
    else go(from + 1)
  }
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
    const t = window.setTimeout(() => forwardRef.current(i), SLIDE_MS)
    return () => window.clearTimeout(t)
  }, [i, paused, state, last])

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
          <span className="flex items-center gap-2.5">
            <span className="font-serif text-[22px]">willow</span>
            <span className="rounded-pill bg-ink/[.06] px-3 py-1 text-[12.5px] text-ink-2">Mei is simulated · generated photos, real measurements</span>
          </span>
          <button type="button" role="switch" aria-checked={walk} onClick={toggleWalk} className="ml-auto flex min-h-11 items-center gap-2 rounded-pill px-3 text-[13px] text-ink-2 hover:bg-ink/5">
            <span className={`relative h-5 w-9 rounded-full transition-colors ${walk ? 'bg-ink' : 'bg-ink/20'}`} aria-hidden>
              <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${walk ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
            Show her in the app between weeks
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
                  style={k < i ? undefined : k === i && i < last ? { animation: `wFill ${SLIDE_MS}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' } : { transform: k === i ? undefined : 'scaleX(0)' }}
                />
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <section aria-live="polite" className="mx-auto flex w-full max-w-[1180px] flex-1 items-center px-[clamp(16px,3vw,32px)] py-5">
        {state === 'loading' ? <IntroSkeleton /> : null}
        {state === 'error' ? (
          <div className="m-auto flex flex-col items-center gap-3 text-center">
            <p className="m-0 text-[17px]">Mei’s journey can’t be read right now.</p>
            <button type="button" onClick={() => navigate('/')} className="min-h-11 rounded-pill bg-selected px-5 text-inverse">
              Back to Willow
            </button>
          </div>
        ) : null}
        {state === 'ready' && slide.kind === 'intro' && first ? <Intro face={first.face} count={weeks.length} closeUps={weeks.filter((w) => w.close).length} /> : null}
        {state === 'ready' && slide.kind === 'week' ? <WeekSlide w={slide.w} n={slide.i} total={weeks.length} /> : null}
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
              {walk && slide?.kind === 'week' ? `Week ${slide.i + 1} in the app` : 'Next'} <ChevronRight size={18} />
            </button>
          ) : (
            <button type="button" onClick={openApp} className="min-h-11 rounded-pill bg-selected px-5 text-inverse">
              Open Mei’s account
            </button>
          )}
        </footer>
      ) : null}
      {/* the next photos load while this slide plays (after her first photo, so they never slow it down) */}
      <div hidden>{slides[i + 1]?.kind === 'week' && (i > 0 || firstShown) ? <Prefetch w={(slides[i + 1] as { w: Week }).w} /> : null}</div>
    </main>
  )
}

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
          Mei is simulated: her photos are generated and show no real person. Every number in this story was measured from them by Willow’s live engine and explained by Gemini, exactly as for anyone. It plays by itself, about a minute; tap or use the arrow keys to move faster.
        </p>
      </div>
    </div>
  )
}

function Reading({ m, s }: { m: Metric; s: Session }) {
  const unit = m.value === null ? '' : unitOf(m).trim()
  const words = wordsFor(m, s)
  const kind = verdictKind(m, s)
  const tone = kind === 'changed' ? (words.label === 'Improved' ? 'bg-[#DDF3C9]' : words.label === 'Moved the other way' ? 'bg-[#FFE3CF]' : 'bg-[#E9E2FF]') : 'bg-white/70'
  return (
    <li className={`flex items-center justify-between gap-3 rounded-[16px] px-3.5 py-2.5 ${tone}`}>
      <span className="flex min-w-0 flex-col">
        <span className="text-[14.5px]">{METRIC_META[m.id].label}</span>
        <span className="text-[12.5px] text-ink-2">
          <span aria-hidden>{words.glyph} </span>
          {kind === 'changed' && m.delta !== null ? `${words.label}: ${m.delta < 0 ? METRIC_META[m.id].decrease : METRIC_META[m.id].increase}` : words.label}
        </span>
      </span>
      <span className="flex flex-none items-baseline gap-1">
        <span className="font-dot text-[22px] tnum">{fmtReading(m.value, m)}</span>
        {unit ? <span className="text-[11px] text-ink-2">{unit}</span> : null}
      </span>
    </li>
  )
}

function pick(s: Session, ids: Metric['id'][]) {
  return ids.map((id) => s.result?.metrics.find((m) => m.id === id)).filter((m): m is Metric => Boolean(m))
}

function WeekSlide({ w, n, total }: { w: Week; n: number; total: number }) {
  const { face, close } = w
  const sideOn = (face.result?.warnings ?? []).some((x) => x.startsWith('side view'))
  return (
    <div key={face.id} className="grid w-full items-start gap-[clamp(20px,3.4vw,48px)] md:grid-cols-[minmax(0,.9fr)_minmax(0,1fr)]" style={{ animation: 'wRise .45s both' }}>
      <div className="relative">
        <Photo s={face} label={`Mei's face check-in, ${when(face.created_at)}`} className="max-h-[70dvh]" />
        {close ? (
          <div className="absolute right-3 bottom-3 w-[34%] max-w-[180px] rounded-[18px] bg-white p-1 shadow-[0_18px_40px_-20px_rgba(0,0,0,.5)]">
            <Photo s={close} label={`Mei's cheek close-up, ${when(close.created_at)}`} className="rounded-[14px]" />
            <span className="block px-1.5 py-1 text-[11px] text-ink-2">Cheek close-up</span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-ink-2">
            {n + 1} of {total} · {when(face.created_at)}
          </span>
          <h2 className="m-0 font-serif text-[clamp(32px,3.6vw,52px)] leading-none font-normal">{face.is_baseline ? 'Her baseline' : `Week ${w.week}`}</h2>
        </div>
        {face.note ? (
          <blockquote className="m-0 border-l-2 border-ink/20 pl-3.5 text-[clamp(15px,1.3vw,18px)] leading-[1.45] text-pretty">
            “{face.note}”<span className="mt-1 block text-[12.5px] text-ink-2">Mei’s note</span>
          </blockquote>
        ) : null}
        {face.explanation?.headline ? (
          <p className="m-0 rounded-[18px] bg-white/70 px-4 py-3 text-[14.5px] leading-[1.45]">
            <span className="mb-0.5 block text-[12px] text-ink-2">What Willow read (Gemini, from the measured numbers)</span>
            {face.explanation.headline}
          </p>
        ) : null}
        {sideOn ? <p className="m-0 text-[13.5px] text-ink-2">Her head was turned this week, so Willow did not compare these readings with her front-on baseline. It says so instead of guessing.</p> : null}
        <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2">
          {[...pick(face, FACE_IDS).map((m) => ({ m, s: face })), ...(close ? pick(close, CLOSE_IDS).map((m) => ({ m, s: close })) : [])].map(({ m, s }) => (
            <Reading key={`${s.id}-${m.id}`} m={m} s={s} />
          ))}
        </ul>
      </div>
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
