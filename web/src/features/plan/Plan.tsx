import './plan.css'
import '../website/website.css'

import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useData, useActivateData } from '../../data/useData'
import { adultConfirmed } from '../../lib/consent'
import { nextPath } from '../../lib/prefs'
import { API_URL } from '../../lib/api'
import { EMPTY_SAFETY, budgetCurrency, loadPricedCurrencies, useSafety } from '../../lib/safety'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { SoftBackdrop } from '../website/Decor'
import { hasConsent } from '../website/entry'
import { Brewing } from './Brewing'
import { PlanContext, QUESTION_COUNT, STEP_IDS, defaultDraft, keyOf, readDraft, readResult, requestOf, writeDraft, writeResult, type Draft, type PlanState, type StepId, type StoredResult } from './draft'
import { BUDGET_RANGE, type PlanResponse } from './planApi'
import { PlanRoutineStep } from './PlanRoutine'
import { ProfileStep } from './ProfileCard'
import { BudgetStep, CareStep, GoalsStep, SkinStep } from './Questions'

const BACKDROP = 'radial-gradient(42% 42% at 12% 18%, rgba(184,233,134,.5), transparent 70%), radial-gradient(40% 45% at 88% 82%, rgba(156,211,255,.55), transparent 70%), radial-gradient(35% 35% at 82% 12%, rgba(216,184,255,.5), transparent 70%), radial-gradient(30% 30% at 20% 90%, rgba(255,178,122,.35), transparent 70%), var(--bg-canvas)'

const PREV: Record<StepId, StepId | null> = { skin: null, goals: 'skin', care: 'goals', budget: 'care', brewing: 'budget', profile: 'budget', routine: 'profile' }
const STAGE_NAME: Record<StepId, string> = { skin: 'Question 1 of 4', goals: 'Question 2 of 4', care: 'Question 3 of 4', budget: 'Question 4 of 4', brewing: 'Brewing', profile: 'Your skin profile', routine: 'Your routine' }

const EASE = [0.2, 0.8, 0.2, 1] as const

/**
 * The routine builder at /plan and /plan/:step: four questions (skin, goals, good to know, budget and range),
 * the brewing moment (the real funnel from POST /v1/plan), the skin profile and the plan, which adds to the
 * routine. Full screen like onboarding, its own backdrop; each step slides in from the side it was reached
 * from and comes into focus. Answers live in this tab (draft.ts) and go to the account as the plan is made.
 * `?next=` (onboarding) is where it ends; Routine otherwise.
 */
export default function Plan() {
  const { step: raw } = useParams()
  const { search } = useLocation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  useActivateData()
  const { profile } = useData()
  const safety = useSafety()
  const reduce = useReducedMotion()
  const known = !raw || (STEP_IDS as readonly string[]).includes(raw)
  const step: StepId = raw && known ? (raw as StepId) : 'skin'
  const exit = nextPath(params.get('next'), '/routine')

  // This tab's answers when there are some, else a fresh start from the profile.
  const [fromTab] = useState(readDraft)
  const [draft, setDraft] = useState<Draft>(() => fromTab ?? defaultDraft({ skin_type: profile.skin_type, goals: profile.goals }))
  // Which currency each market is priced in (its own, or USD where local prices are few): once
  // known, a budget outside that currency's range starts again from its usual value.
  useEffect(() => {
    let alive = true
    void loadPricedCurrencies(API_URL).then(() => {
      if (!alive) return
      setDraft((d) => {
        const r = BUDGET_RANGE[budgetCurrency(d.market)]
        return r && (d.budget < r.min || d.budget > r.max) ? { ...d, budget: r.start } : d
      })
    })
    return () => {
      alive = false
    }
  }, [])
  const set = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch }
      writeDraft(next)
      return next
    })
  }, [])

  // A fresh start takes what the account already knows (life stage, avoids, market…) once it arrives.
  const [seeded, setSeeded] = useState(Boolean(fromTab))
  if (!seeded && safety.status === 'ready') {
    setSeeded(true)
    const s = safety.data
    if (s) {
      const market = s.market ?? draft.market
      setDraft({ ...draft, reactive: s.reactive ?? draft.reactive, life_stage: s.life_stage ?? draft.life_stage, avoid: s.avoid.length ? s.avoid : draft.avoid, avoid_ingredients: s.avoid_ingredients.length ? s.avoid_ingredients : draft.avoid_ingredients, note: s.note ?? draft.note, rx_treatment: s.rx_treatment ?? draft.rx_treatment, market, budget: market === draft.market ? draft.budget : (BUDGET_RANGE[budgetCurrency(market)]?.start ?? draft.budget) })
    }
  }

  const base = safety.data ?? EMPTY_SAFETY
  const request = useMemo(() => requestOf(draft, base, adultConfirmed()), [draft, base])
  const [kept, setKept] = useState<StoredResult | null>(readResult)
  const result = kept && request && kept.key === keyOf(request) ? kept.plan : null
  const setResult = useCallback(
    (plan: PlanResponse) => {
      if (!request) return
      const r = { key: keyOf(request), plan }
      writeResult(r)
      setKept(r)
    },
    [request],
  )
  const go = useCallback((s: StepId, opts?: { replace?: boolean }) => navigate(`${s === 'skin' ? '/plan' : `/plan/${s}`}${search}`, opts), [navigate, search])
  const state: PlanState = useMemo(() => ({ draft, set, result, setResult, request, go, exit }), [draft, set, result, setResult, request, go, exit])

  // Which way the steps move: forward slides in from the right, back from the left.
  const index = STEP_IDS.indexOf(step)
  const [nav, setNav] = useState({ at: index, dir: 1 })
  if (nav.at !== index) setNav({ at: index, dir: index > nav.at ? 1 : -1 })

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  if (!hasConsent()) return <Navigate to={`/welcome?next=${encodeURIComponent(`/plan${search}`)}`} replace />
  if (!known) return <Navigate to={`/plan${search}`} replace />
  if (step !== 'skin' && !draft.skin_type) return <Navigate to={`/plan${search}`} replace />
  if ((step === 'profile' || step === 'routine') && !result) return <Navigate to={`/plan/brewing${search}`} replace />

  const variants: Variants = {
    enter: (d: number) => (reduce ? { opacity: 0 } : { opacity: 0, x: d * 48, filter: 'blur(8px)' }),
    center: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: reduce ? 0.15 : 0.42, ease: EASE } },
    exit: (d: number) => (reduce ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, x: d * -36, filter: 'blur(6px)', transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }),
  }

  return (
    <PlanContext.Provider value={state}>
      <div className="relative flex h-dvh flex-col overflow-hidden">
        <SoftBackdrop background={BACKDROP} />
        <header className="relative z-10 flex items-center justify-between gap-3 px-[clamp(16px,3vw,32px)] pt-[clamp(10px,2.2vh,22px)]">
          <Back step={step} go={go} exit={exit} />
          <Progress step={step} />
          <Link to={exit} className="flex min-h-11 items-center rounded-pill bg-white/55 px-3.5 text-[13.5px] text-ink no-underline backdrop-blur-[12px] transition-colors hover:bg-white/85">
            {params.get('next') ? 'Skip for now' : 'Close'}
          </Link>
        </header>
        <AnimatePresence mode="wait" initial={false} custom={nav.dir}>
          <motion.main key={step} custom={nav.dir} variants={variants} initial="enter" animate="center" exit="exit" className="relative flex min-h-0 flex-1 flex-col">
            {step === 'goals' ? <GoalsStep /> : step === 'care' ? <CareStep /> : step === 'budget' ? <BudgetStep /> : step === 'brewing' ? <Brewing /> : step === 'profile' ? <ProfileStep /> : step === 'routine' ? <PlanRoutineStep /> : <SkinStep />}
          </motion.main>
        </AnimatePresence>
      </div>
    </PlanContext.Provider>
  )
}

const backClass = 'grid size-11 shrink-0 place-items-center rounded-full border border-line bg-white/50 text-[18px] text-ink no-underline backdrop-blur-[12px] transition-[background-color,transform] hover:bg-white/80 active:scale-95'

function Back({ step, go, exit }: { step: StepId; go: PlanState['go']; exit: string }) {
  const navigate = useNavigate()
  const prev = PREV[step]
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  return (
    <button type="button" aria-label={prev ? `Back to ${STAGE_NAME[prev].toLowerCase()}` : 'Back'} className={backClass} onClick={() => (prev ? go(prev) : canGoBack ? navigate(-1) : navigate(exit))}>
      ←
    </button>
  )
}

/** Four question segments, then the brew, the profile and the routine; the label says where you are. */
function Progress({ step }: { step: StepId }) {
  const at = STEP_IDS.indexOf(step)
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      {/* the bar says where you are; the stage name is for screen readers only */}
      <span className="sr-only" aria-live="polite">
        {STAGE_NAME[step]}
      </span>
      <ol aria-label={`Build a routine: ${STAGE_NAME[step]}`} className="m-0 flex w-full max-w-[300px] list-none gap-1 p-0">
        {STEP_IDS.map((id, i) => (
          <li key={id} aria-hidden className={`relative h-[5px] overflow-hidden rounded-pill bg-ink/12 ${i < QUESTION_COUNT ? 'flex-[2]' : 'flex-1'}`}>
            <span
              className="absolute inset-0 origin-left rounded-pill transition-transform duration-700 ease-standard"
              style={{
                transform: `scaleX(${i <= at ? 1 : 0})`,
                background: i < QUESTION_COUNT ? 'var(--action-selected)' : 'var(--willow-400)',
                transitionDelay: i <= at ? '120ms' : '0ms',
              }}
            />
            {i === at && step === 'brewing' ? <span className="absolute inset-y-0 w-1/2 animate-[wSweep_1.2s_linear_infinite] bg-white/60" /> : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
