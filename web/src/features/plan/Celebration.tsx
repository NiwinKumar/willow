import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ProductImage } from '../../components/willow/ProductImage'
import type { Product } from '../../data/types'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { Drift } from './petals'
import { primary } from './styles'

/** One step of the start, as the plan's schedule says it ("Today", "Week 2 · 12 Dec"…), with the products it starts. */
export type JourneyStep = { when: string; text: string; products?: Product[] }

/**
 * The routine is saved: a small garden blooms and the first steps of the journey are laid out, then it hands
 * over (to the routine, or back to the page for the shell's CelebrationHost). About five seconds to build, then still; the button (or any tap, Enter or
 * Escape) goes on at any time, and it goes on by itself a few seconds after it settles (the button's line
 * fills to show when). Seven Willow tulip buds (the logo's frosted bud, stem and leaf) grow out of a soft
 * mound, light blooms behind them, a ripple runs across the mound as the first bud opens, and petals and
 * willow leaves lift off on warm air (petals.ts), not paper confetti. The words arrive word by word, then
 * the first steps from the plan's own schedule, one row at a time.
 * Four tests:
 *   1. Tells: the routine was saved, how many products, what starts today (with their photos) and what comes next and when.
 *   2. Understood at a glance: the logo's own flower, plain words, a dated list, one button.
 *   3. Never in the way: a fixed layer (no layout shift), transform/opacity and one canvas; continue at any
 *      time; reduced motion gets a still garden with the same words and no timer.
 *   4. Belongs: the logo's bud gradient, willow stem and leaf, aura hues for the petals, Instrument Serif title,
 *      the builder's ink button.
 */
// The logo's bud in the middle; its neighbours take the other aura hues, so it reads as a garden, not a row.
const LOGO = 'radial-gradient(circle at 50% 72%, #FF6B4A 0%, #F25FA8 55%, #C9A8FF 100%)'
const APRICOT = 'radial-gradient(circle at 50% 72%, #FF8A5C 0%, #FFB27A 55%, #FFE3CC 100%)'
const LILAC = 'radial-gradient(circle at 50% 72%, #7A5CFF 0%, #B79CFF 55%, #E7DDFF 100%)'
const PINK = 'radial-gradient(circle at 50% 72%, #F25FA8 0%, #FF9CCB 60%, #FFE0EF 100%)'
/** Grow order and timing (ms): the middle bud first, then outwards in pairs. */
const GROW = 320
const BUDS = [
  { x: 50, h: 1, d: 0, s: 1.15, c: LOGO },
  { x: 36, h: 0.78, d: 170, s: 0.95, c: PINK },
  { x: 64, h: 0.82, d: 250, s: 0.95, c: APRICOT },
  { x: 24, h: 0.58, d: 420, s: 0.8, c: LILAC },
  { x: 76, h: 0.6, d: 480, s: 0.8, c: LOGO },
  { x: 14, h: 0.4, d: 640, s: 0.66, c: APRICOT },
  { x: 86, h: 0.42, d: 700, s: 0.66, c: PINK },
]
/** When the first bud opens (its stem, then the bloom). */
const OPEN = GROW + 520
const TITLE_AT = 950
const LINE_AT = 1450
const STEPS_AT = 2200
const BUTTON_AT = 3000
/** Goes on by itself this long after it opens (the drift has settled by about 5.5 s). */
const LENGTH = 9000
const BG = 'radial-gradient(80% 60% at 50% 62%, rgba(250,250,248,.97), rgba(236,235,231,.95))'
const VEIL = 'radial-gradient(80% 60% at 50% 62%, #FAFAF8, #ECEBE7)'

export function Celebration({ title, line, steps = [], cta = 'Continue', onDone }: { title: string; line: string; steps?: JourneyStep[]; cta?: string; onDone: () => void }) {
  const reduce = useReducedMotion()
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)
  const finish = useRef(onDone)
  const canvas = useRef<HTMLCanvasElement>(null)
  const garden = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    finish.current = onDone
  }, [onDone])

  // Leave softly: the words and garden fade, then a plain veil of the same colour stays over the page while
  // the routine opens beneath it, and fades. (The veil lives outside React: this layer unmounts on navigation.)
  const go = () => {
    if (done.current) return
    done.current = true
    if (reduce) return finish.current()
    setLeaving(true)
    window.setTimeout(() => {
      const veil = document.createElement('div')
      veil.setAttribute('aria-hidden', 'true')
      Object.assign(veil.style, { position: 'fixed', inset: '0', zIndex: '75', background: VEIL, pointerEvents: 'none' })
      document.body.appendChild(veil)
      const from = location.pathname
      const t0 = performance.now()
      finish.current()
      // Lift the veil once the next page has its heading (at most 1.2 s), so it opens onto content, not a blank shell.
      const lift = () => {
        const moved = location.pathname !== from || !from.startsWith('/plan')
        const h1 = document.querySelector('h1')
        const shown = h1 && (h1.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true)
        if ((!moved || !shown) && performance.now() - t0 < 1200) return void requestAnimationFrame(lift)
        // the page's own entrance has just begun under it: the veil thins as the page rises
        const a = veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 620, delay: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' })
        a.onfinish = () => veil.remove()
        a.oncancel = () => veil.remove()
      }
      requestAnimationFrame(lift)
    }, 320)
  }

  const goOn = useEffectEvent(() => go())
  useEffect(() => {
    button.current?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault()
        goOn()
      }
    }
    window.addEventListener('keydown', key)
    // Reduced motion: still, so no timer; the button goes on.
    const t = reduce ? 0 : window.setTimeout(() => goOn(), LENGTH)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', key)
    }
  }, [reduce])

  // The drift: a burst as the first bud opens, then a few at a time from each bud as it opens.
  useEffect(() => {
    const cv = canvas.current
    const g = garden.current
    if (reduce || !cv || !g) return
    const drift = new Drift(cv)
    const timers: number[] = []
    const from = (x: number, h: number) => {
      const r = g.getBoundingClientRect()
      return { x: r.left + (r.width * x) / 100, y: r.bottom - r.height * (0.08 + 0.8 * (0.62 * h + 0.18)) }
    }
    timers.push(
      window.setTimeout(() => {
        const p = from(50, 1)
        drift.release(p.x, p.y, 30, true)
      }, OPEN + 60),
    )
    BUDS.slice(1).forEach((b) =>
      timers.push(
        window.setTimeout(() => {
          const p = from(b.x, b.h)
          drift.release(p.x, p.y, 3, false, 14)
        }, GROW + b.d + 600),
      ),
    )
    // a last gentle lift from the whole garden, then the air goes still
    for (let k = 0; k < 6; k++)
      timers.push(
        window.setTimeout(() => {
          const r = g.getBoundingClientRect()
          drift.release(r.left + r.width / 2, r.bottom - r.height * 0.3, 2, false, r.width * 0.8)
        }, 1900 + k * 380),
      )
    const onResize = () => drift.resize()
    window.addEventListener('resize', onResize)
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      window.removeEventListener('resize', onResize)
      drift.stop()
    }
  }, [reduce])

  const anim = (a: string) => (reduce ? undefined : a)
  const out = leaving ? { opacity: 0, translate: '0 -10px', filter: 'blur(4px)' } : undefined

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="celebrate-title"
      aria-describedby="celebrate-line"
      onClick={go}
      className="fixed inset-0 z-[75] grid cursor-pointer place-items-center overflow-hidden px-6"
      style={{ background: BG, backdropFilter: 'blur(14px)', animation: anim('wFadeIn .45s ease both') }}
    >
      <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 size-full transition-opacity duration-300" style={{ opacity: leaving ? 0 : 1 }} />
      <div className="relative flex w-full max-w-[440px] flex-col items-center gap-5 text-center transition-[opacity,translate,filter] duration-300 ease-exit" style={out}>
        <div ref={garden} aria-hidden className="relative h-[clamp(140px,27vh,250px)] w-[min(380px,82vw)] [--bud:1] sm:[--bud:1.2]">
          {/* light blooms behind the garden, one after another */}
          {[
            { at: OPEN - 160, c: 'rgba(255,227,204,.9)', x: 50, s: 1 },
            { at: OPEN + 120, c: 'rgba(216,184,255,.55)', x: 30, s: 0.75 },
            { at: OPEN + 300, c: 'rgba(184,233,134,.55)', x: 70, s: 0.75 },
          ].map((b, i) => (
            <span
              key={i}
              className="absolute top-[4%] aspect-square rounded-full blur-[26px]"
              style={{ left: `${b.x}%`, width: `${70 * b.s}%`, translate: '-50% 0', background: `radial-gradient(circle, ${b.c}, transparent 70%)`, animation: anim(`wPlanBloomLight 1.6s var(--ease-standard) ${b.at}ms both`) }}
            />
          ))}
          {/* the mound, and a ripple across it as the first bud opens */}
          <span className="absolute inset-x-[6%] bottom-0 h-[16%] rounded-[50%]" style={{ background: 'radial-gradient(60% 100% at 50% 0%, #CFE9C0, #A9D59A 60%, rgba(134,197,176,.4))', boxShadow: 'inset 0 2px 0 rgba(255,255,255,.6)', transformOrigin: '50% 100%', animation: anim('wMound .6s var(--ease-standard) 120ms both') }} />
          {reduce
            ? null
            : [0, 340].map((d) => (
                <span key={d} className="absolute bottom-[2%] left-1/2 h-[18%] w-[60%] rounded-[50%] border-[1.5px] border-[rgba(79,184,102,.45)]" style={{ translate: '-50% 0', opacity: 0, animation: `wPlanRipple 1.5s var(--ease-standard) ${OPEN + d}ms both` }} />
              ))}
          {BUDS.map((b, i) => (
            <Bud key={i} {...b} d={GROW + b.d} reduce={reduce} />
          ))}
        </div>
        <div className="flex flex-col items-center gap-2">
          <h2 id="celebrate-title" className="m-0 font-serif text-[clamp(32px,8vw,52px)] leading-[1.05] font-normal text-balance">
            <Words text={title} at={TITLE_AT} step={95} reduce={reduce} />
          </h2>
          <p id="celebrate-line" className="m-0 max-w-[32ch] text-[15px] leading-[1.45] text-ink-2 text-pretty">
            <Words text={line} at={LINE_AT} step={30} reduce={reduce} soft />
          </p>
        </div>
        {steps.length ? (
          <ol aria-label="Your first steps" className="relative m-0 flex w-full max-w-[360px] list-none flex-col gap-2.5 p-0 text-left">
            <span aria-hidden className="absolute top-2 bottom-2 left-[6px] w-px origin-top bg-ink/15" style={{ animation: anim(`wPlanGrow .9s var(--ease-standard) ${STEPS_AT}ms both`) }} />
            {steps.map((s, i) => (
              <li key={i} className="relative pl-6" style={{ animation: anim(`wRise .55s var(--ease-standard) ${STEPS_AT + 120 + i * 170}ms both`) }}>
                <span aria-hidden className={`absolute top-[3px] left-0 size-[13px] rounded-full border-2 border-white ${i === 0 ? 'bg-selected' : 'bg-[var(--willow-400)]'}`} style={{ boxShadow: '0 0 0 1px rgba(18,18,18,.12)' }} />
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[10.5px] tracking-[.08em] text-ink-2">{s.when.toUpperCase()}</span>
                  {s.products?.length ? (
                    <span aria-hidden className="flex -space-x-1.5">
                      {s.products.slice(0, 4).map((p, k) => (
                        <span key={p.product_id} style={{ animation: anim(`wPlanPick .6s var(--ease-spring) ${STEPS_AT + 300 + k * 80}ms both`) }}>
                          <ProductImage product={p} size={20} decorative />
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[13.5px] leading-[1.4]">{s.text}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="flex w-full max-w-[360px] flex-col items-stretch gap-1.5" style={{ animation: anim(`wRise .5s var(--ease-standard) ${BUTTON_AT}ms both`) }}>
          <button
            ref={button}
            type="button"
            className={`${primary} relative overflow-hidden`}
            onClick={(e) => {
              e.stopPropagation()
              go()
            }}
          >
            {cta} <span aria-hidden>→</span>
            {/* when it goes on by itself */}
            {reduce ? null : <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-white/40" style={{ animation: `wFill ${LENGTH - BUTTON_AT}ms linear ${BUTTON_AT}ms both` }} />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Text that arrives word by word (each rises out of a soft blur); read as one string by screen readers. */
function Words({ text, at, step, reduce, soft }: { text: string; at: number; step: number; reduce: boolean; soft?: boolean }) {
  if (reduce) return <>{text}</>
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(' ').map((w, i) => (
          <span key={i}>
            <span className="inline-block" style={{ animation: `${soft ? 'wPlanWordIn .5s' : 'wPlanWordIn .75s'} var(--ease-standard) ${at + i * step}ms both` }}>
              {w}
            </span>{' '}
          </span>
        ))}
      </span>
    </>
  )
}

/** One tulip: the stem grows, the leaf unfolds, the bud opens (the logo's mark, drawn tall). */
function Bud({ x, h, d, s, c, reduce }: { x: number; h: number; d: number; s: number; c: string; reduce: boolean }) {
  const stem = 62 * h + 18 // % of the garden's height
  const anim = (a: string) => (reduce ? undefined : a)
  return (
    <span className="absolute bottom-[8%]" style={{ left: `${x}%`, height: `${stem}%`, width: 0 }}>
      <span className="absolute bottom-0 left-[-0.75px] h-full w-[1.5px] origin-bottom rounded-pill" style={{ background: 'var(--willow-stem)', animation: anim(`wStem .6s var(--ease-standard) ${d}ms both`) }} />
      <span
        className="absolute bottom-[30%] left-0 h-[9px] w-[18px] origin-left rounded-[50%]"
        style={{ background: 'var(--willow-leaf)', rotate: x < 50 ? '-150deg' : '-30deg', filter: 'blur(.4px)', scale: `${s}`, animation: anim(`wLeaf .5s var(--ease-standard) ${d + 300}ms both`) }}
      />
      <span
        className="absolute top-0 left-0 block"
        style={{ width: `calc(${26 * s}px * var(--bud))`, height: `calc(${30 * s}px * var(--bud))`, translate: '-50% -78%', borderRadius: '50% 50% 46% 46%', background: c, filter: 'blur(1.6px)', animation: anim(`wBloom .8s var(--ease-spring) ${d + 460}ms both`) }}
      />
    </span>
  )
}
