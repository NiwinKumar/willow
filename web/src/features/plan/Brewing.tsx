import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { ProductImage } from '../../components/willow/ProductImage'
import { useData } from '../../data/useData'
import { ApiError } from '../../lib/api'
import { MAX_GOALS } from '../../lib/metrics'
import { putSafety } from '../../lib/safety'
import { useAuth } from '../../lib/useAuth'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { BrewScene, type Rgb } from './brewScene'
import { usePlan } from './draft'
import { SLOT_WORDS, errorText, money, postPlan, saveLastPlan, type FunnelStep, type PlanPick, type PlanResponse } from './planApi'
import { card, cardStyle, primary, secondary } from './styles'
import { Frame } from './ui'

type Nearest = { product_id: string; brand: string; name: string; price: number; currency: string; budget: number }

/** The catalog stage settles, then one filter per beat, then the picks gather and the screen holds before moving on. */
const FIRST = 900
const BEAT = 780
const GATHER = 900
const HOLD = 1350
/** At most this many dots are drawn; above it each dot stands for a few products (said under the dish). */
const MAX_DOTS = 180

/**
 * The "brewing" moment between the questions and the plan. It asks /v1/plan and saves the answers to the
 * account. The scene is one continuous dish (brewScene.ts): while the plan is made, dots bloom out of the
 * centre and turn; when the answer lands, the dish replays the api's REAL funnel. Each filter passes as a
 * ripple: the dots it drops drift out and fade where it reaches them, the survivors close up and shift colour
 * (violet for the whole catalog, through sky, to willow green for what fits), the count rolls down, the bar
 * shrinks with it and the step's tick draws in, and the heading's words dissolve into the next stage's.
 * Last, the survivors gather into the picks' places and the picks' photos appear there. About five and a half
 * seconds, skippable; with reduced motion the end state is shown at once, with a button on.
 *
 * Four tests (for the scene):
 *   1. Tells: how many products each published rule left, with the real counts; the dots are the same counts.
 *   2. Understood at a glance: dots leave as the count drops; the caption says what one dot is.
 *   3. Never in the way: canvas and transform/opacity only, no layout moves; Skip is always there.
 *   4. Belongs: the aura hues, the willow green for "fits", onboarding's glass card and serif heading.
 */
export function Brewing() {
  const { request, draft, setResult, go, set } = usePlan()
  const { user, continueAsGuest, getIdToken } = useAuth()
  const { saveProfile, profile } = useData()
  const reduce = useReducedMotion()
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [error, setError] = useState<{ fits: boolean; text: string; nearest?: Nearest | null; reasons?: { label: string; n: number }[] } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [played, setPlayed] = useState(-1)
  const [skip, setSkip] = useState(false)

  // Ask for the plan (a guest account first when there is none) and save the answers alongside.
  const brew = useEffectEvent(async (live: () => boolean) => {
    if (!request) return
    try {
      if (!user) await continueAsGuest()
      const t = await getIdToken()
      // The answers go to the account (safety replaces the whole object; goals keep the account's others after the plan's).
      putSafety(t, request.safety).catch(() => undefined)
      const goals = [...new Set([...draft.goals, ...profile.goals])].slice(0, MAX_GOALS)
      saveProfile({ skin_type: draft.skin_type, goals }).catch(() => undefined)
      const res = await postPlan(t, request)
      if (!live()) return
      setResult(res)
      saveLastPlan(res, request)
      setPlan(res)
    } catch (e) {
      if (!live()) return
      if (e instanceof ApiError && e.status === 422) {
        const d = e.detail ?? {}
        setError({ fits: false, text: errorText(e, 'Nothing in the catalog fits all of these answers yet.'), nearest: (d.nearest as Nearest | undefined) ?? null, reasons: (d.reasons as { label: string; n: number }[] | undefined) ?? [] })
      }
      else setError({ fits: true, text: errorText(e, 'Willow could not build your routine just now. Check your connection and try again.') })
    }
  })
  useEffect(() => {
    let alive = true
    void brew(() => alive)
    return () => {
      alive = false
    }
  }, [attempt])

  const retry = () => {
    setError(null)
    setPlan(null)
    setPlayed(-1)
    setAttempt((a) => a + 1)
  }

  const funnel = useMemo(() => plan?.funnel ?? [], [plan])
  const picks = useMemo(() => plan?.picks ?? [], [plan])
  const last = funnel.length - 1
  // Stages 0..last are the funnel's steps; last + 1 is the picks gathering. Reduced motion shows the end at once.
  const stage = plan && reduce ? last + 1 : played
  const gathered = Boolean(plan) && stage > last

  // Play the funnel: one filter per beat, the gathering, then a hold on the result and on (at once after Skip).
  // `go` changes with the route, so it is read through an effect event: the scene must not replay while it leaves.
  const leave = useEffectEvent(() => go('profile', { replace: true }))
  useEffect(() => {
    if (!plan || !funnel.length) return
    if (skip) return void leave()
    if (reduce) return
    const at = (i: number) => (i === 0 ? 60 : FIRST + (i - 1) * BEAT)
    const timers = funnel.map((_, i) => window.setTimeout(() => setPlayed(i), at(i)))
    const gather = at(last) + GATHER
    timers.push(window.setTimeout(() => setPlayed(last + 1), gather))
    timers.push(window.setTimeout(() => leave(), gather + HOLD))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [plan, reduce, skip, funnel, last])

  const now = stage >= 0 && stage <= last ? funnel[stage] : null
  const fit = funnel[last]?.n ?? 0

  if (error)
    return (
      <Frame title={error.fits ? 'Your routine is not ready' : 'Nothing fits all of that yet'}>
        <div className={`${card} flex animate-[wRise_.45s_var(--ease-standard)_both] flex-col gap-3 px-5 py-5`} style={cardStyle}>
          <p className="m-0 text-[15px] leading-[1.5]">{error.text}</p>
          {!error.fits && error.nearest ? (
            <p className="m-0 text-[13.5px] leading-[1.45] text-ink-2">
              The nearest fit for your answers is {error.nearest.brand} {error.nearest.name} at {money(error.nearest.price, error.nearest.currency)}. Your other answers stay as they are.
            </p>
          ) : !error.fits ? (
            <p className="m-0 text-[13.5px] leading-[1.45] text-ink-2">A higher budget or another market usually opens it up. Your other answers stay as they are.</p>
          ) : null}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            {error.fits ? (
              <button type="button" className={`${primary} sm:flex-1`} onClick={retry}>
                Try again
              </button>
            ) : (
              <>
                {error.nearest ? (
                  <button
                    type="button"
                    className={`${primary} sm:flex-1`}
                    onClick={() => {
                      set({ budget: error.nearest!.budget })
                      retry()
                    }}
                  >
                    Use a {money(error.nearest.budget, error.nearest.currency)} budget
                  </button>
                ) : null}
                <button type="button" className={`${error.nearest ? secondary : primary} sm:flex-1`} onClick={() => go('budget')}>
                  Change my budget
                </button>
                <button type="button" className={`${secondary} sm:flex-1`} onClick={() => go('care')}>
                  Change where I shop
                </button>
              </>
            )}
          </div>
        </div>
      </Frame>
    )

  const title = gathered ? `${picks.length} ${picks.length === 1 ? 'pick' : 'picks'} for your routine` : stage === last && now ? `${fit} ${fit === 1 ? 'product fits' : 'products fit'} you` : now ? checkingWords(now, stage) : 'Reading the catalog'
  return (
    <Frame
      wide
      title={<Morph text={title} />}
      sub="Fixed rules from published sources do the choosing. No AI picks a product."
      actions={
        reduce && gathered ? (
          <button type="button" className={primary} onClick={() => go('profile', { replace: true })}>
            See your skin profile <span aria-hidden>→</span>
          </button>
        ) : (
          <button type="button" className={`${secondary} self-center`} onClick={() => (plan ? go('profile', { replace: true }) : setSkip(true))} disabled={skip}>
            {skip ? 'Almost there…' : 'Skip'}
          </button>
        )
      }
    >
      <div className="grid items-center gap-[clamp(12px,3vh,36px)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Dish funnel={funnel} picks={picks} stage={stage} reduce={reduce} />
        <FunnelList funnel={funnel} stage={stage} reduce={reduce} />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {gathered ? `${fit} of ${funnel[0].n} products fit you. ${picks.length} picks for your routine.` : now ? `${now.label}: ${now.n}` : 'Building your routine'}
      </p>
    </Frame>
  )
}

function checkingWords(step: FunnelStep, i: number): string {
  if (i === 0) return `${step.n} products in the catalog`
  return `${step.label}…`
}

/** The scene's colour per stage: violet for the whole catalog, through sky and teal, to willow green for what fits. */
const LOADING: Rgb = [183, 160, 255]
const STOPS: Rgb[] = [
  [122, 92, 255],
  [61, 123, 255],
  [52, 160, 170],
  [79, 184, 102],
]
function stageColour(i: number, last: number): Rgb {
  const f = last > 0 ? Math.min(1, Math.max(0, i / last)) : 1
  const x = f * (STOPS.length - 1)
  const k = Math.min(STOPS.length - 2, Math.floor(x))
  const p = x - k
  const [a, b] = [STOPS[k], STOPS[k + 1]]
  return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p]
}

/** Dot counts per stage: one per product, or scaled when the catalog is larger than MAX_DOTS (never zero while any product is left). */
function dotCounts(funnel: FunnelStep[]): { counts: number[]; per: number } {
  const n0 = funnel[0]?.n ?? 0
  const per = n0 > MAX_DOTS ? n0 / MAX_DOTS : 1
  return { counts: funnel.map((f) => (f.n > 0 ? Math.max(1, Math.round(f.n / per)) : 0)), per }
}

/** Where each pick gathers, in the dish's unit circle: one in the middle, two side by side, more on a ring. */
function slotsFor(n: number): { x: number; y: number }[] {
  if (n <= 1) return [{ x: 0, y: 0 }]
  if (n === 2) return [{ x: -0.34, y: 0 }, { x: 0.34, y: 0 }]
  const r = n === 3 ? 0.4 : 0.46
  return Array.from({ length: n }, (_, k) => {
    const a = -Math.PI / 2 + (k / n) * Math.PI * 2
    return { x: Math.cos(a) * r, y: Math.sin(a) * r }
  })
}

function Dish({ funnel, picks, stage, reduce }: { funnel: FunnelStep[]; picks: PlanPick[]; stage: number; reduce: boolean }) {
  const { counts, per } = useMemo(() => dotCounts(funnel), [funnel])
  const d0 = counts[0] ?? 0
  const last = counts.length - 1
  const gathered = d0 > 0 && stage > last
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const scene = useRef<BrewScene | null>(null)
  // What the scene has been told so far (catalog, stages, gathering), so each change is told once and in order.
  const told = useRef(-2)
  const [px, setPx] = useState(0)

  // The scene lives as long as the dish: sized to its box, turning while the catalog is read.
  useLayoutEffect(() => {
    const c = canvas.current
    const b = box.current
    if (!c || !b) return
    const s = new BrewScene(c)
    scene.current = s
    told.current = -2
    const ro = new ResizeObserver(() => {
      s.resize(b.clientWidth)
      setPx(b.clientWidth)
    })
    ro.observe(b)
    s.resize(b.clientWidth)
    if (!reduce) {
      s.seed(MAX_DOTS, LOADING, performance.now())
      s.start()
    }
    return () => {
      ro.disconnect()
      s.stop()
      scene.current = null
    }
  }, [reduce])

  useEffect(() => {
    const s = scene.current
    if (!s || !d0) return
    const t = performance.now()
    if (told.current < -1) {
      s.catalog(d0, d0 * 7919 + (counts[last] ?? 0), stageColour(0, last), t)
      told.current = 0
    }
    // Stages may arrive together (reduced motion, a remount): each one still runs, in order.
    const upTo = Math.min(stage, last)
    for (let i = told.current + 1; i <= upTo; i++) s.filter(counts[i], stageColour(i, last), t)
    told.current = Math.max(told.current, upTo)
    if (gathered && told.current === last) {
      s.resolve(slotsFor(picks.length), stageColour(last, last), t)
      told.current = last + 1
    }
    if (reduce) s.settle(t)
  }, [d0, counts, last, stage, gathered, picks.length, reduce])

  const slots = slotsFor(picks.length)
  const bubble = picks.length <= 3 ? 0.25 : picks.length === 4 ? 0.22 : 0.19
  const f = last > 0 ? Math.min(1, Math.max(0, stage) / last) : 0
  const caption = !d0 ? 'Willow’s catalog, checked for you' : gathered ? picks.map((p) => SLOT_WORDS[p.slot]).join(' · ') : per > 1 ? `Each dot is about ${Math.round(per)} products` : 'Each dot is one product in the catalog'

  return (
    <figure className="m-0 flex flex-col items-center gap-2">
      <div
        ref={box}
        className="relative aspect-square w-[min(220px,52vw,27vh)] rounded-full sm:w-[min(300px,62vw,38vh)]"
        style={{ background: 'radial-gradient(circle at 50% 38%, rgba(255,255,255,.9), rgba(255,255,255,.45) 62%, rgba(255,255,255,.2))', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.9), inset 0 -18px 40px rgba(156,211,255,.25), inset 0 10px 30px rgba(255,255,255,.7), 0 40px 80px -40px rgba(15,59,58,.45)' }}
      >
        {/* the brew itself: a slow turning bloom, and two tints that cross-fade from violet to green as the filters run */}
        <div aria-hidden className="absolute inset-[9%] overflow-hidden rounded-full">
          <div
            className="absolute inset-[-30%] blur-[22px]"
            style={{
              background: 'conic-gradient(from 0deg, rgba(216,184,255,.75), rgba(156,211,255,.7), rgba(184,233,134,.7), rgba(255,178,122,.6), rgba(216,184,255,.75))',
              animation: reduce ? undefined : 'wTurn 14s linear infinite',
              opacity: gathered ? 0.35 : d0 ? 0.5 : 0.8,
              transition: 'opacity 1.2s ease',
            }}
          />
          <div className="absolute inset-0 transition-opacity duration-[900ms] ease-standard" style={{ background: 'radial-gradient(circle at 50% 55%, rgba(122,92,255,.32), transparent 70%)', opacity: d0 ? 1 - f : 0.4 }} />
          <div className="absolute inset-0 transition-opacity duration-[900ms] ease-standard" style={{ background: 'radial-gradient(circle at 50% 55%, rgba(79,184,102,.34), rgba(184,233,134,.18) 45%, transparent 72%)', opacity: d0 ? f : 0 }} />
        </div>
        <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />
        {/* the picks, where the last dots gathered */}
        {gathered && px
          ? picks.map((p, k) => (
              <span
                key={p.product.product_id}
                className="absolute"
                style={{ left: `${50 + slots[k].x * 44}%`, top: `${50 + slots[k].y * 44}%`, translate: '-50% -50%', animation: `wPlanPick .8s var(--ease-spring) ${380 + k * 110}ms both` }}
              >
                <ProductImage product={p.product} size={Math.round(px * bubble)} decorative />
              </span>
            ))
          : null}
        {gathered && !reduce ? <span aria-hidden className="absolute top-1/2 left-1/2 size-[40%] animate-[wRingOut_1.3s_var(--ease-standard)_both] rounded-full border-2 border-[var(--willow-400)]" style={{ translate: '-50% -50%' }} /> : null}
      </div>
      <figcaption className="text-center text-[12px] text-ink-2 [@media(max-height:720px)]:hidden">
        <Morph text={caption} />
      </figcaption>
    </figure>
  )
}

/**
 * Words that dissolve into the next words: the old line blurs out word by word as the new one rises in,
 * both in the same grid cell so nothing below moves. The old line is dropped once it has gone.
 */
function Morph({ text }: { text: string }) {
  const [lines, setLines] = useState([{ id: 0, text, out: false }])
  const top = lines[lines.length - 1]
  if (top.text !== text) setLines([...lines.filter((l) => !l.out).map((l) => ({ ...l, out: true })), { id: top.id + 1, text, out: false }])
  useEffect(() => {
    if (!lines.some((l) => l.out)) return
    const t = window.setTimeout(() => setLines((ls) => ls.filter((l) => !l.out)), 700)
    return () => window.clearTimeout(t)
  }, [lines])
  return (
    <span className="inline-grid">
      {lines.map((l) => (
        <span key={l.id} aria-hidden={l.out || undefined} className="[grid-area:1/1]">
          {l.text.split(' ').map((w, i) => (
            <span key={i}>
              <span className="inline-block" style={{ animation: l.out ? `wPlanWordOut .26s var(--ease-exit) ${i * 16}ms both` : `wPlanWordIn .6s var(--ease-standard) ${200 + i * 48}ms both` }}>
                {w}
              </span>{' '}
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

/** A count that rolls from where it was to its new value without re-rendering (it writes its own text). */
function Count({ value, from, on, delay, reduce }: { value: number; from: number; on: boolean; delay: number; reduce: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (!on) {
      el.textContent = '–'
      shown.current = null
      return
    }
    const start = shown.current ?? from
    if (reduce || start === value) {
      el.textContent = String(value)
      shown.current = value
      return
    }
    let raf = 0
    let t0 = 0
    const tick = (t: number) => {
      if (!t0) t0 = t + delay
      const p = Math.max(0, Math.min(1, (t - t0) / 700))
      const v = Math.round(start + (value - start) * (1 - Math.pow(1 - p, 3)))
      el.textContent = String(v)
      shown.current = v
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [on, value, from, delay, reduce])
  return (
    <span className={`tnum transition-colors duration-500 ${on ? 'text-ink' : 'text-ink-2'}`}>
      <span ref={ref} aria-hidden />
      <span className="sr-only">{on ? value : ''}</span>
    </span>
  )
}

function FunnelList({ funnel, stage, reduce }: { funnel: FunnelStep[]; stage: number; reduce: boolean }) {
  const n0 = funnel[0]?.n || 1
  const last = funnel.length - 1
  const list = useRef<HTMLOListElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  // One white pill slides down to the row being checked (and fades once every row is done).
  useLayoutEffect(() => {
    const ol = list.current
    const el = pill.current
    if (!ol || !el) return
    const place = () => {
      const row = ol.children[Math.min(Math.max(stage, 0), last) + 1] as HTMLElement | undefined
      if (!row) return
      el.style.transform = `translateY(${row.offsetTop}px)`
      el.style.height = `${row.offsetHeight}px`
      el.style.opacity = stage >= 0 && stage <= last ? '1' : '0'
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(ol)
    return () => ro.disconnect()
  }, [stage, last])
  if (!funnel.length)
    return (
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="h-[38px] animate-[wShimmer_1.4s_linear_infinite] rounded-[14px] bg-[linear-gradient(90deg,rgba(255,255,255,.35),rgba(255,255,255,.7),rgba(255,255,255,.35))] bg-[length:200%_100%]" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </ol>
    )
  return (
    <ol ref={list} className={`${card} relative m-0 flex animate-[wFadeIn_.5s_ease_both] list-none flex-col p-1.5`} style={cardStyle}>
      <span ref={pill} aria-hidden className="absolute inset-x-1.5 top-0 rounded-[18px] bg-white opacity-0 shadow-[0_1px_6px_rgba(0,0,0,.05)] transition-[transform,opacity,height] duration-[560ms] ease-spring" />
      {funnel.map((f, i) => {
        const st = i < stage ? 'done' : i === stage ? 'on' : 'up'
        const lastRow = i === last
        const c = stageColour(i, last)
        const ticked = st === 'done' || (lastRow && st === 'on')
        const prev = i === 0 ? 1 : funnel[i - 1].n / n0
        return (
          <li key={f.id} className={`relative flex items-center gap-3 rounded-[18px] px-3 py-[clamp(5px,.9vh,10px)] transition-opacity duration-500 ${st === 'up' ? 'opacity-45' : 'opacity-100'}`}>
            <span aria-hidden className={`relative grid size-[22px] flex-none place-items-center rounded-full transition-[background-color,box-shadow] duration-500 ${st === 'up' ? 'shadow-[inset_0_0_0_1.5px_rgba(18,18,18,.22)]' : lastRow && ticked ? 'bg-[var(--willow-400)]' : 'bg-selected'}`}>
              {ticked ? (
                <svg viewBox="0 0 22 22" className="w-tick absolute inset-0 size-full" fill="none">
                  <path d="M6.5 11.5l3 3 6-6.5" pathLength={1} stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : st === 'on' ? (
                <span className="size-1.5 animate-[wBreathe_1s_ease-in-out_infinite] rounded-full bg-lime" />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-[14px]">{f.label}</span>
              <span aria-hidden className="h-[3px] overflow-hidden rounded-pill bg-ink/[.07]">
                <span
                  className="block h-full origin-left rounded-pill transition-[transform,opacity] duration-[800ms] ease-standard"
                  style={{ transform: `scaleX(${st === 'up' ? prev : f.n / n0})`, opacity: st === 'up' ? 0 : 1, background: `rgb(${c.map((v) => v | 0).join(',')})`, transitionDelay: st === 'up' || reduce ? '0ms' : '160ms' }}
                />
              </span>
            </span>
            <span className="w-[3.2em] text-right font-dot text-[20px] leading-none font-extrabold">
              <Count value={f.n} from={i === 0 ? 0 : funnel[i - 1].n} on={st !== 'up'} delay={i === 0 ? 0 : 160} reduce={reduce} />
            </span>
          </li>
        )
      })}
    </ol>
  )
}
