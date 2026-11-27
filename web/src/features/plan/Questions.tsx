import { useState } from 'react'

import { GOALS, type GoalId } from '../../lib/metrics'
import { AVOID_OPTIONS, LIFE_STAGES, MARKETS, marketOf, type AvoidId, type LifeStage, type Market } from '../../lib/safety'
import { PLAN_MAX_GOALS, usePlan } from './draft'
import { GOAL_LOOK, GOAL_NOTE } from './looks'
import { BUDGET_RANGE, money, type PlanSkin, type StepCount, type Tier } from './planApi'
import { card, cardStyle, primary, stagger } from './styles'
import { Field, Frame, Pills, Tick } from './ui'
import { PastReactions } from '../you/PastReactions'

const arrow = <span aria-hidden>→</span>

// ------------------------------------------------------------------ (a) skin

const SKINS: { id: PlanSkin; label: string; line: string; bg: string; fg: string }[] = [
  { id: 'oily', label: 'Oily', line: 'Shiny by midday, all over', bg: 'radial-gradient(90% 80% at 50% 100%, #F2B53A 0%, #F6DE5C 42%, #F5F0DA 86%)', fg: '#2A2410' },
  { id: 'combination', label: 'Combination', line: 'Shiny T-zone, drier cheeks', bg: 'radial-gradient(90% 80% at 40% 100%, #D8B8FF 0%, #FFB27A 48%, #F4ECE6 86%)', fg: '#2A1430' },
  { id: 'dry', label: 'Dry', line: 'Feels tight, can flake', bg: 'radial-gradient(90% 80% at 60% 100%, #3D7BFF 0%, #9CD3FF 45%, #E6EEF6 86%)', fg: '#0A1840' },
  { id: 'normal', label: 'Normal', line: 'Rarely shiny or tight', bg: 'radial-gradient(90% 80% at 50% 100%, #4FB866 0%, #B8E986 45%, #EAF2E2 86%)', fg: '#0E2A12' },
]

/** A small line drawing of each skin type (no skin colours, no faces: an outline and where it shows). */
function SkinArt({ id, on }: { id: PlanSkin; on: boolean }) {
  const draw = { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1, style: { animation: 'wDrawPath .9s var(--ease-standard) .1s forwards' } } as const
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={1.6} className={`transition-transform duration-500 ease-spring ${on ? 'scale-[1.06]' : ''}`}>
      <ellipse cx="32" cy="33" rx="17" ry="22" {...draw} />
      {id === 'oily' ? (
        <g fill="currentColor" stroke="none" opacity=".55">
          {[
            [26, 20],
            [37, 18],
            [32, 34],
            [22, 36],
            [42, 38],
            [31, 47],
          ].map(([x, y], i) => (
            <path key={i} d={`M${x} ${y - 3.2}c1.6 2.2 2.4 3.4 2.4 4.4a2.4 2.4 0 0 1-4.8 0c0-1 .8-2.2 2.4-4.4z`} style={{ animation: `wDotIn .4s var(--ease-bounce) ${200 + i * 70}ms both`, transformOrigin: `${x}px ${y}px` }} />
          ))}
        </g>
      ) : id === 'combination' ? (
        <g>
          <path d="M20 21h24M32 21v22" strokeWidth={6} opacity=".28" {...draw} />
          <g fill="currentColor" stroke="none" opacity=".55">
            <circle cx="27" cy="20" r="1.4" style={{ animation: 'wDotIn .4s var(--ease-bounce) .3s both' }} />
            <circle cx="37" cy="21" r="1.4" style={{ animation: 'wDotIn .4s var(--ease-bounce) .4s both' }} />
            <circle cx="32" cy="34" r="1.4" style={{ animation: 'wDotIn .4s var(--ease-bounce) .5s both' }} />
          </g>
        </g>
      ) : id === 'dry' ? (
        <g strokeWidth={1.2} opacity=".7">
          <path d="M20 34l3 2 2-2 3 2M38 36l3-2 2 2 2-1M27 19l2 2 2-2 2 2 2-2" {...draw} />
          <path d="M24 44l2 1.5M40 45l-2 1.5" {...draw} />
        </g>
      ) : (
        <g opacity=".5">
          <ellipse cx="32" cy="33" rx="10" ry="13" strokeDasharray="2 3" />
          <circle cx="32" cy="33" r="2" fill="currentColor" stroke="none" style={{ animation: 'wBreathe 4s ease-in-out infinite' }} />
        </g>
      )}
    </svg>
  )
}

export function SkinStep() {
  const { draft, set, go } = usePlan()
  return (
    <Frame
      wide
      eyebrow="QUESTION 1 · YOUR SKIN"
      title="How does your skin usually feel?"
      sub="By early afternoon, on a normal day, without much on it."
      actions={
        <button type="button" disabled={!draft.skin_type} onClick={() => go('goals')} className={primary}>
          {draft.skin_type ? <>Continue {arrow}</> : 'Choose the closest one'}
        </button>
      }
    >
      <div role="radiogroup" aria-label="Skin type" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {SKINS.map((s, i) => {
          const on = draft.skin_type === s.id
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set({ skin_type: s.id })}
              className="w-lift-sm relative flex h-[clamp(132px,22vh,200px)] flex-col justify-between overflow-hidden rounded-[24px] p-3 text-left transition-[box-shadow,transform] duration-300 ease-standard active:scale-[.97] sm:p-3.5"
              style={{ ...stagger(i), background: s.bg, color: s.fg, boxShadow: on ? 'inset 0 0 0 2px #121212, inset 0 0 30px 4px rgba(255,255,255,.35)' : 'inset 0 0 30px 4px rgba(255,255,255,.35), 0 18px 40px -32px rgba(0,0,0,.45)' }}
            >
              <span className="flex items-start justify-between">
                <span className="size-[clamp(44px,8vh,72px)]">
                  <SkinArt id={s.id} on={on} />
                </span>
                <Tick on={on} light />
              </span>
              <span>
                <span className="block text-[clamp(17px,2.3vh,21px)] leading-[1.1]">{s.label}</span>
                <span className="mt-0.5 block text-[12.5px] leading-[1.3] opacity-80">{s.line}</span>
              </span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={draft.reactive}
        onClick={() => set({ reactive: !draft.reactive })}
        className={`${card} mt-2.5 flex w-full items-center gap-3.5 px-4 py-3 text-left transition-transform duration-200 active:scale-[.99] sm:px-5`}
        style={{ ...cardStyle, ...stagger(4) }}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15.5px]">My skin reacts easily</span>
          <span className="text-[13px] leading-[1.35] text-ink-2">Stings, flushes or itches with new products. Willow leaves out fragrance and keeps actives gentle.</span>
        </span>
        <span aria-hidden className={`relative h-[30px] w-[50px] flex-none rounded-pill transition-colors duration-300 ${draft.reactive ? 'bg-selected' : 'bg-ink/15'}`}>
          <span className="absolute top-[3px] left-[3px] size-6 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,.2)] transition-transform duration-300 ease-spring" style={{ transform: draft.reactive ? 'translateX(20px)' : 'none' }} />
        </span>
      </button>
    </Frame>
  )
}

// ------------------------------------------------------------------ (b) goals

export function GoalsStep() {
  const { draft, set, go } = usePlan()
  const [hint, setHint] = useState(false)
  const toggle = (id: GoalId) => {
    if (draft.goals.includes(id)) {
      set({ goals: draft.goals.filter((g) => g !== id) })
      setHint(false)
    } else if (draft.goals.length >= PLAN_MAX_GOALS) setHint(true)
    else {
      set({ goals: [...draft.goals, id] })
      setHint(false)
    }
  }
  return (
    <Frame
      wide
      eyebrow={`QUESTION 2 · CHOOSE UP TO ${PLAN_MAX_GOALS}`}
      title="What would you like to change?"
      sub="Your first choice leads: it picks the plan's first active. The others shape the rest."
      aside={
        <span className="font-dot text-[clamp(28px,4vh,40px)] leading-none font-extrabold" role="status" aria-label={`${draft.goals.length} of ${PLAN_MAX_GOALS} chosen`}>
          {draft.goals.length}/{PLAN_MAX_GOALS}
        </span>
      }
      actions={
        <>
          {hint ? (
            <p role="status" className="m-0 animate-[wRise_.3s_var(--ease-standard)_both] self-start rounded-[14px] bg-selected px-3.5 py-2 text-[13px] text-inverse">
              Three is the most a first routine can take on. Remove one to choose another.
            </p>
          ) : null}
          <button type="button" disabled={!draft.goals.length} onClick={() => go('care')} className={primary}>
            {draft.goals.length ? <>Continue {arrow}</> : 'Choose at least one'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {GOALS.map((g, i) => {
          const at = draft.goals.indexOf(g.id)
          const on = at >= 0
          const look = GOAL_LOOK[g.id]
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              aria-pressed={on}
              aria-label={`${g.label}${on ? `, choice ${at + 1}` : ''}`}
              className="w-lift-sm relative flex h-[clamp(76px,13vh,128px)] flex-col justify-between rounded-[24px] p-3 text-left transition-[box-shadow,transform] duration-300 ease-standard active:scale-[.97] sm:p-3.5"
              style={{ ...stagger(i, 20, 35), background: look.bg, color: look.fg, boxShadow: on ? 'inset 0 0 0 2px #121212, inset 0 0 30px 4px rgba(255,255,255,.35)' : 'inset 0 0 30px 4px rgba(255,255,255,.35), 0 18px 40px -32px rgba(0,0,0,.45)' }}
            >
              <span className="flex items-start justify-between gap-1.5">
                <span className="truncate text-[12px] leading-[1.25] opacity-80">{GOAL_NOTE[g.id]}</span>
                <Tick on={on} n={on ? at + 1 : undefined} light />
              </span>
              <span className="text-[clamp(16px,2.2vh,20px)] leading-[1.1] tracking-[-0.01em]">{g.label}</span>
            </button>
          )
        })}
      </div>
    </Frame>
  )
}

// ------------------------------------------------------------------ (c) good to know

export function CareStep() {
  const { draft, set, go } = usePlan()
  const toggleAvoid = (id: AvoidId) => set({ avoid: draft.avoid.includes(id) ? draft.avoid.filter((a) => a !== id) : [...draft.avoid, id] })
  const setMarket = (m: Market) => {
    // A new market brings its own currency, so the budget starts again from that currency's usual value.
    if (m !== draft.market) set({ market: m, budget: BUDGET_RANGE[marketOf(m).currency]?.start ?? draft.budget })
  }
  return (
    <Frame
      eyebrow="QUESTION 3 · GOOD TO KNOW"
      title="A few things to leave out"
      sub="Each answer removes products, never adds them. Kept private to your account."
      actions={
        <button type="button" onClick={() => go('budget')} className={primary}>
          Continue {arrow}
        </button>
      }
    >
      <div className={`${card} flex flex-col divide-y divide-ink/[.07]`} style={{ ...cardStyle, ...stagger(0) }}>
        <Field title="Are any of these true right now?" note="Some actives are left out then">
          <Pills<LifeStage> label="Life stage" options={LIFE_STAGES} value={draft.life_stage} onChange={(v) => set({ life_stage: v })} />
        </Field>
        <Field title="Ingredients you avoid" note="Choose any">
          <Pills<AvoidId> multi label="Ingredients to avoid" options={AVOID_OPTIONS} value={draft.avoid} onChange={toggleAvoid} />
        </Field>
        <Field title="Past reactions" note="Optional">
          <PastReactions dense value={draft} onChange={set} />
        </Field>
        <Field title="Do you use a prescription skin treatment?" note="From a doctor, for your face">
          <Pills<'yes' | 'no'>
            label="Prescription skin treatment"
            options={[
              { id: 'no', label: 'No' },
              { id: 'yes', label: 'Yes' },
            ]}
            value={draft.rx_treatment ? 'yes' : 'no'}
            onChange={(v) => set({ rx_treatment: v === 'yes' })}
          />
          {draft.rx_treatment ? <p className="m-0 animate-[wRise_.3s_var(--ease-standard)_both] text-[12.5px] leading-[1.4] text-ink-2">Exfoliating acids and retinoids are left out. Ask whoever prescribed it before adding anything new.</p> : null}
        </Field>
        <Field title="Where do you shop?" note="Sets what is sold there, and the currency">
          <Pills<Market> label="Market" options={MARKETS.map((m) => ({ id: m.id, label: m.label }))} value={draft.market} onChange={setMarket} />
        </Field>
      </div>
    </Frame>
  )
}

// ------------------------------------------------------------------ (d) budget and range

const TIERS: { id: Tier; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'budget', label: 'Budget' },
  { id: 'mid', label: 'Mid-range' },
  { id: 'premium', label: 'Premium' },
]

const SIZES: { n: StepCount; label: string; line: string }[] = [
  { n: 3, label: 'The essentials', line: 'Cleanser, moisturiser, sunscreen' },
  { n: 4, label: 'Plus one active', line: 'For your first goal, added after two weeks' },
  { n: 5, label: 'Plus a second', line: 'A night active, only if the two pair well' },
]

export function BudgetStep() {
  const { draft, set, go } = usePlan()
  const m = marketOf(draft.market)
  const range = BUDGET_RANGE[m.currency] ?? BUDGET_RANGE.USD
  const pct = ((draft.budget - range.min) / (range.max - range.min)) * 100
  return (
    <Frame
      wide
      eyebrow="QUESTION 4 · BUDGET AND RANGE"
      title="What fits your budget?"
      sub={`Prices in ${m.currency}, as listed for ${m.label}. Willow never converts a price.`}
      actions={
        <button type="button" onClick={() => go('brewing')} className={primary}>
          Build my routine {arrow}
        </button>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-[1.1fr_1fr]">
        <div className={`${card} flex flex-col gap-3 px-4 py-4 sm:px-5`} style={{ ...cardStyle, ...stagger(0) }}>
          <label htmlFor="plan-budget" className="flex items-baseline justify-between gap-3">
            <span className="text-[15.5px]">Most you'd pay per product</span>
            <span className="text-[12.5px] text-ink-2">Each, not in total</span>
          </label>
          <output htmlFor="plan-budget" className="font-dot text-[clamp(40px,7vh,64px)] leading-[.9] font-extrabold tabular-nums">
            {money(draft.budget, m.currency)}
          </output>
          <input
            id="plan-budget"
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={Math.min(Math.max(draft.budget, range.min), range.max)}
            onChange={(e) => set({ budget: Number(e.target.value) })}
            aria-valuetext={`${money(draft.budget, m.currency)} per product`}
            className="h-2 w-full cursor-pointer appearance-auto rounded-pill accent-[var(--action-selected)]"
            style={{ background: `linear-gradient(90deg, var(--action-selected) ${pct}%, rgba(18,18,18,.12) ${pct}%)` }}
          />
          <span className="flex justify-between font-mono text-[10.5px] text-ink-2">
            <span>{money(range.min, m.currency)}</span>
            <span>{money(range.max, m.currency)}</span>
          </span>
          <div className="flex flex-col gap-1.5 border-t border-ink/[.07] pt-3">
            <span className="text-[14px]">Price range</span>
            <Pills<Tier> label="Price range" options={TIERS} value={draft.tier} onChange={(v) => set({ tier: v })} />
          </div>
        </div>
        <div role="radiogroup" aria-label="How many steps" className="flex flex-col gap-2">
          {SIZES.map((s, i) => {
            const on = draft.steps === s.n
            return (
              <button
                key={s.n}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ steps: s.n })}
                className={`${card} flex flex-1 items-center gap-3.5 px-4 py-3 text-left transition-[box-shadow,transform] duration-300 ease-standard active:scale-[.98]`}
                style={{ ...cardStyle, ...stagger(i + 1), boxShadow: on ? 'inset 0 0 0 2px #121212, 0 30px 70px -40px rgba(0,0,0,.3)' : cardStyle.boxShadow }}
              >
                <span className="font-dot text-[34px] leading-none font-extrabold">{s.n}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px]">{s.label}</span>
                  <span className="text-[12.5px] leading-[1.3] text-ink-2">{s.line}</span>
                  <span aria-hidden className="mt-1 flex gap-1">
                    {Array.from({ length: s.n }, (_, k) => (
                      <span key={k} className="size-2 rounded-full transition-colors duration-300" style={{ background: k < 3 ? 'rgba(18,18,18,.35)' : on ? 'var(--willow-400)' : 'rgba(79,184,102,.45)' }} />
                    ))}
                  </span>
                </span>
                <Tick on={on} />
              </button>
            )
          })}
        </div>
      </div>
    </Frame>
  )
}
