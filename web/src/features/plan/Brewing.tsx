import { useEffect, useEffectEvent, useMemo, useState, type CSSProperties } from 'react'

import { RollingNumber } from '../../components/willow/RollingNumber'
import { useData } from '../../data/useData'
import { ApiError } from '../../lib/api'
import { MAX_GOALS } from '../../lib/metrics'
import { putSafety } from '../../lib/safety'
import { useAuth } from '../../lib/useAuth'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { usePlan } from './draft'
import { errorText, money, postPlan, saveLastPlan, type FunnelStep, type PlanResponse } from './planApi'

type Nearest = { product_id: string; brand: string; name: string; price: number; currency: string; budget: number }
import { card, cardStyle, primary, secondary } from './styles'
import { Frame } from './ui'

/** One filter's beat: the dots settle, the count rolls, the scan line passes. */
const BEAT = 720
const FIRST = 520
const HOLD = 1250
/** At most this many dots are drawn; above it each dot stands for a few products (said under the dish). */
const MAX_DOTS = 180
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/**
 * The "brewing" moment between the questions and the plan. It asks /v1/plan and saves the answers to the
 * account, and while the plan is made the catalog sits in a glass dish as one dot per product. When the
 * answer lands, the dish replays the api's REAL funnel: each filter (sold where you are, within budget, no
 * flags, fit) drops the dots that did not pass and the survivors gather closer, the counts roll down beside
 * it. About four seconds, skippable; with reduced motion the counts are simply shown.
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
  const last = funnel.length - 1
  // Reduced motion shows the whole funnel at once.
  const stage = plan && reduce ? last : played

  // Play the funnel: one filter per beat, then hold on the result and move on (at once after Skip).
  useEffect(() => {
    if (!plan || !funnel.length) return
    if (skip) return void go('profile', { replace: true })
    if (reduce) return
    const timers: number[] = []
    funnel.forEach((_, i) => timers.push(window.setTimeout(() => setPlayed(i), i === 0 ? 60 : FIRST + i * BEAT)))
    timers.push(window.setTimeout(() => go('profile', { replace: true }), FIRST + last * BEAT + HOLD))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [plan, reduce, skip, funnel, last, go])

  const done = Boolean(plan) && stage >= last
  const now = stage >= 0 ? funnel[stage] : null

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

  return (
    <Frame
      wide
      title={done ? <span key="d" className="inline-block animate-[wWord_.5s_both]">{`${funnel[last].n} ${funnel[last].n === 1 ? 'product fits' : 'products fit'} you`}</span> : <span key={now?.id ?? 'w'} className="inline-block animate-[wWord_.45s_both]">{now ? checkingWords(now, stage) : 'Reading the catalog'}</span>}
      sub="Fixed rules from published sources do the choosing. No AI picks a product."
      actions={
        reduce && done ? (
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
        <Dish funnel={funnel} stage={stage} reduce={reduce} />
        <FunnelList funnel={funnel} stage={stage} />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {done ? `${funnel[last].n} of ${funnel[0].n} products fit you.` : now ? `${now.label}: ${now.n}` : 'Building your routine'}
      </p>
    </Frame>
  )
}

function checkingWords(step: FunnelStep, i: number): string {
  if (i === 0) return `${step.n} products in the catalog`
  return `${step.label}…`
}

/** A small fixed-seed random source (mulberry32), so the dish lays out the same way on every render. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Dot counts per stage: one per product, or scaled when the catalog is larger than MAX_DOTS (never zero while any product is left). */
function dotCounts(funnel: FunnelStep[]): { counts: number[]; per: number } {
  const n0 = funnel[0]?.n ?? 0
  const per = n0 > MAX_DOTS ? n0 / MAX_DOTS : 1
  return { counts: funnel.map((f) => (f.n > 0 ? Math.max(1, Math.round(f.n / per)) : 0)), per }
}

function Dish({ funnel, stage, reduce }: { funnel: FunnelStep[]; stage: number; reduce: boolean }) {
  const { counts, per } = useMemo(() => dotCounts(funnel), [funnel])
  const d0 = counts[0] ?? 0
  const last = counts.length - 1
  // Each dot gets a fixed random rank: it survives a stage while its rank is under that stage's count.
  const { ranks, jitter } = useMemo(() => {
    const rand = seeded(d0 * 7919 + (counts[last] ?? 0))
    const r = Array.from({ length: d0 }, (_, i) => i)
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[r[i], r[j]] = [r[j], r[i]]
    }
    return { ranks: r, jitter: r.map(() => rand()) }
  }, [d0, counts, last])
  const s = Math.max(0, stage)
  const done = stage >= 0 && stage >= last
  const R = 44 // % of the dish, from the centre
  const alive = counts[s] ?? 0
  const radius = R * Math.max(0.42, Math.sqrt(alive / Math.max(1, d0)))
  const size = Math.min(13, ((radius * 2) / Math.sqrt(Math.max(1, alive))) * 0.62)
  const base = Math.min(7.6, ((R * 2) / Math.sqrt(Math.max(1, d0))) * 0.62)

  return (
    <figure className="m-0 flex flex-col items-center gap-2">
      <div
        className="relative aspect-square w-[min(220px,52vw,27vh)] rounded-full sm:w-[min(300px,62vw,38vh)]"
        style={{ background: 'radial-gradient(circle at 50% 38%, rgba(255,255,255,.9), rgba(255,255,255,.45) 62%, rgba(255,255,255,.2))', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.9), inset 0 -18px 40px rgba(156,211,255,.25), inset 0 10px 30px rgba(255,255,255,.7), 0 40px 80px -40px rgba(15,59,58,.45)' }}
      >
        {/* the brew itself: a slow turning bloom under the dots */}
        <div aria-hidden className="absolute inset-[9%] overflow-hidden rounded-full">
          <div
            className="absolute inset-[-30%] opacity-70 blur-[22px]"
            style={{
              background: 'conic-gradient(from 0deg, rgba(216,184,255,.75), rgba(156,211,255,.7), rgba(184,233,134,.7), rgba(255,178,122,.6), rgba(216,184,255,.75))',
              animation: reduce ? undefined : `wTurn ${d0 ? 14 : 5}s linear infinite`,
              opacity: done ? 0.45 : d0 ? 0.55 : 0.8,
              transition: 'opacity .8s',
            }}
          />
        </div>
        {/* the filter passing through: a soft scan line, once per stage */}
        {stage > 0 && !reduce ? (
          <div key={stage} aria-hidden className="pointer-events-none absolute inset-[6%] overflow-hidden rounded-full">
            <div className="absolute inset-x-0 h-[18%] animate-[wPlanScan_.7s_var(--ease-standard)_both]" style={{ background: 'linear-gradient(180deg, transparent, rgba(255,255,255,.85) 50%, transparent)' }} />
          </div>
        ) : null}
        <div aria-hidden className="absolute inset-0">
          {ranks.map((rank, i) => {
            const survives = rank < alive
            // Before the filters run, every dot sits in the full spiral at its own index.
            const idx = stage <= 0 ? i : rank
            const total = stage <= 0 ? d0 : alive
            const rr = (stage <= 0 ? R : radius) * Math.sqrt((idx + 0.5) / Math.max(1, total))
            const a = idx * GOLDEN
            const x = 50 + rr * Math.cos(a)
            const y = 50 + rr * Math.sin(a)
            const sz = stage <= 0 ? base : size
            const fin = done && survives
            const style: CSSProperties = {
              left: `${x}%`,
              top: `${y}%`,
              width: `${sz}%`,
              height: `${sz}%`,
              translate: '-50% -50%',
              opacity: stage < 0 ? 0 : survives ? 1 : 0,
              scale: survives ? 1 : 0.3,
              filter: survives ? 'none' : 'blur(2px)',
              background: fin ? 'radial-gradient(circle at 35% 30%, #fff 0%, var(--action-tag) 30%, var(--willow-400) 75%)' : 'radial-gradient(circle at 35% 30%, rgba(255,255,255,.95) 0%, rgba(122,92,255,.55) 45%, rgba(15,59,58,.75) 100%)',
              boxShadow: fin ? '0 0 0 1px rgba(255,255,255,.7), 0 4px 14px -2px rgba(46,139,71,.6)' : 'inset 0 0 0 .5px rgba(255,255,255,.6)',
              transition: `left .75s var(--ease-spring) ${jitter[i] * 180}ms, top .75s var(--ease-spring) ${jitter[i] * 180}ms, width .6s var(--ease-standard), height .6s var(--ease-standard), opacity .45s ease ${survives ? 0 : jitter[i] * 220}ms, scale .45s var(--ease-standard) ${jitter[i] * 220}ms, filter .45s, background .6s ease ${jitter[i] * 300}ms, box-shadow .6s`,
              animation: stage === 0 ? `wDotIn .5s var(--ease-bounce) ${Math.round(jitter[i] * 420)}ms both` : undefined,
            }
            return <span key={i} className="absolute rounded-full" style={style} />
          })}
          {done && !reduce ? <span className="absolute top-1/2 left-1/2 size-[36%] animate-[wRingOut_1.1s_var(--ease-standard)_both] rounded-full border-2 border-[var(--willow-400)]" style={{ translate: '-50% -50%' }} /> : null}
        </div>
        {!d0 ? <span className="absolute inset-0 grid place-items-center font-mono text-[11px] tracking-[.08em] text-ink-2">MIXING…</span> : null}
      </div>
      <figcaption className="text-center text-[12px] text-ink-2 [@media(max-height:720px)]:hidden">{d0 ? (per > 1 ? `Each dot is about ${Math.round(per)} products` : 'Each dot is one product in the catalog') : 'Willow’s catalog, checked for you'}</figcaption>
    </figure>
  )
}

function FunnelList({ funnel, stage }: { funnel: FunnelStep[]; stage: number }) {
  const n0 = funnel[0]?.n || 1
  if (!funnel.length)
    return (
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="h-[38px] animate-[wShimmer_1.4s_linear_infinite] rounded-[14px] bg-[linear-gradient(90deg,rgba(255,255,255,.35),rgba(255,255,255,.7),rgba(255,255,255,.35))] bg-[length:200%_100%]" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </ol>
    )
  return (
    <ol className={`${card} m-0 flex list-none flex-col p-1.5`} style={cardStyle}>
      {funnel.map((f, i) => {
        const st = i < stage ? 'done' : i === stage ? 'on' : 'up'
        const lastRow = i === funnel.length - 1
        return (
          <li key={f.id} className={`relative flex items-center gap-3 rounded-[18px] px-3 py-[clamp(5px,.9vh,10px)] transition-[background-color,opacity] duration-500 ${st === 'on' ? 'bg-white' : ''} ${st === 'up' ? 'opacity-45' : 'opacity-100'}`}>
            <span aria-hidden className={`grid size-[22px] flex-none place-items-center rounded-full text-[11px] transition-colors duration-500 ${st === 'up' ? 'border-[1.5px] border-ink/25' : lastRow && st === 'on' ? 'bg-[var(--willow-400)] text-white' : 'bg-selected text-inverse'}`}>
              {st === 'done' || (lastRow && st === 'on') ? <span className="animate-[wDotIn_.3s_var(--ease-bounce)_both]">✓</span> : st === 'on' ? <span className="size-1.5 animate-[wBreathe_1s_ease-in-out_infinite] rounded-full bg-lime" /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-[14px]">{f.label}</span>
              <span aria-hidden className="h-[3px] overflow-hidden rounded-pill bg-ink/[.07]">
                <span className="block h-full origin-left rounded-pill transition-transform duration-700 ease-standard" style={{ transform: `scaleX(${st === 'up' ? 0 : f.n / n0})`, background: lastRow ? 'var(--willow-400)' : 'rgba(18,18,18,.55)' }} />
              </span>
            </span>
            <span className="w-[3.2em] text-right font-dot text-[20px] leading-none font-extrabold tabular-nums">
              {st === 'up' ? <span className="text-ink-2">–</span> : <RollingNumber value={f.n} from={i === 0 ? 0 : funnel[i - 1].n} duration={600} format={(v) => String(Math.round(v))} />}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
