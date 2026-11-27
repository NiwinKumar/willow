import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { useReducedMotion } from '../../lib/useReducedMotion'

/**
 * The routine is saved: a small garden blooms, then the plan lands on the routine (~2.3 s, tap or any key to
 * go on at once). Seven Willow tulip buds (the logo's frosted bud, stem and leaf) grow out of a soft mound one
 * after another, a ring of petals lifts off, and the words say what happened and what is next.
 * Four tests:
 *   1. Tells: the routine was saved, how many products, and what to do next (tick them as you use them).
 *   2. Understood at a glance: it is the logo's own flower, and the words are plain.
 *   3. Never in the way: a fixed layer over the page (no layout shift), transform/opacity only, any tap or key
 *      skips it, it ends by itself; reduced motion gets a still garden with the same words.
 *   4. Belongs: the logo's bud gradient, willow stem and leaf, aura hues for the petals, Instrument Serif title.
 */
// The logo's bud in the middle; its neighbours take the other aura hues, so it reads as a garden, not a row.
const LOGO = 'radial-gradient(circle at 50% 72%, #FF6B4A 0%, #F25FA8 55%, #C9A8FF 100%)'
const APRICOT = 'radial-gradient(circle at 50% 72%, #FF8A5C 0%, #FFB27A 55%, #FFE3CC 100%)'
const LILAC = 'radial-gradient(circle at 50% 72%, #7A5CFF 0%, #B79CFF 55%, #E7DDFF 100%)'
const PINK = 'radial-gradient(circle at 50% 72%, #F25FA8 0%, #FF9CCB 60%, #FFE0EF 100%)'
const BUDS = [
  { x: 50, h: 1, d: 0, s: 1.15, c: LOGO },
  { x: 36, h: 0.78, d: 120, s: 0.95, c: PINK },
  { x: 64, h: 0.82, d: 180, s: 0.95, c: APRICOT },
  { x: 24, h: 0.58, d: 300, s: 0.8, c: LILAC },
  { x: 76, h: 0.6, d: 340, s: 0.8, c: LOGO },
  { x: 14, h: 0.4, d: 460, s: 0.66, c: APRICOT },
  { x: 86, h: 0.42, d: 500, s: 0.66, c: PINK },
]
const PETALS = ['#FF6B4A', '#F25FA8', '#D8B8FF', '#FFB27A', '#B8E986', '#9CD3FF', '#F25FA8', '#FFB27A', '#D8B8FF', '#FF6B4A', '#B8E986', '#9CD3FF']
const LENGTH = 2300

export function Celebration({ title, line, onDone }: { title: string; line: string; onDone: () => void }) {
  const reduce = useReducedMotion()
  const done = useRef(false)
  const finish = useRef(onDone)
  useEffect(() => {
    finish.current = onDone
  }, [onDone])
  const go = () => {
    if (done.current) return
    done.current = true
    finish.current()
  }
  useEffect(() => {
    const t = window.setTimeout(go, reduce ? 2600 : LENGTH)
    const key = () => go()
    window.addEventListener('keydown', key)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', key)
    }
  }, [reduce])
  const anim = (a: string) => (reduce ? undefined : a)

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      onClick={go}
      className="fixed inset-0 z-[75] grid cursor-pointer place-items-center px-6"
      style={{ background: 'radial-gradient(80% 60% at 50% 62%, rgba(250,250,248,.96), rgba(236,235,231,.94))', backdropFilter: 'blur(14px)', animation: anim(`wFadeIn .25s ease both, wCelebrateOut .3s var(--ease-exit) ${LENGTH - 300}ms forwards`) }}
    >
      <div className="flex w-full max-w-[420px] flex-col items-center gap-5 text-center">
        <div aria-hidden className="relative h-[clamp(150px,26vh,210px)] w-[min(320px,80vw)]">
          {/* soft light behind the garden */}
          <span className="absolute inset-x-[10%] top-[8%] bottom-[18%] rounded-full blur-[30px]" style={{ background: 'radial-gradient(circle, rgba(255,255,255,.95), rgba(255,227,204,.55) 45%, rgba(216,184,255,.3) 65%, transparent 78%)', animation: anim('wBreathe 3s ease-in-out infinite') }} />
          {/* the mound */}
          <span className="absolute inset-x-[6%] bottom-0 h-[16%] rounded-[50%]" style={{ background: 'radial-gradient(60% 100% at 50% 0%, #CFE9C0, #A9D59A 60%, rgba(134,197,176,.4))', boxShadow: 'inset 0 2px 0 rgba(255,255,255,.6)', transformOrigin: '50% 100%', animation: anim('wMound .45s var(--ease-standard) both') }} />
          {BUDS.map((b, i) => (
            <Bud key={i} {...b} reduce={reduce} />
          ))}
          {/* a ring of petals lifts off once the garden is up */}
          {reduce
            ? null
            : PETALS.map((c, i) => {
                const a = (i / PETALS.length) * Math.PI * 2
                return (
                  <span
                    key={i}
                    className="absolute top-[42%] left-1/2 h-[9px] w-[6px] rounded-[50%_50%_50%_50%/60%_60%_40%_40%]"
                    style={{ background: c, opacity: 0, ['--px' as string]: `${Math.round(Math.cos(a) * 130)}px`, ['--py' as string]: `${Math.round(Math.sin(a) * 80 - 50)}px`, ['--pr' as string]: `${i * 47}deg`, animation: `wPetal 1.2s var(--ease-standard) ${800 + (i % 4) * 60}ms both` }}
                  />
                )
              })}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <h2 className="m-0 font-serif text-[clamp(30px,8vw,40px)] leading-[1.05] font-normal text-balance" style={{ animation: anim('wRise .5s var(--ease-standard) 650ms both') }}>
            {title}
          </h2>
          <p className="m-0 max-w-[30ch] text-[15px] leading-[1.45] text-ink-2 text-pretty" style={{ animation: anim('wRise .5s var(--ease-standard) 820ms both') }}>
            {line}
          </p>
        </div>
        <span className="text-[12px] text-ink-2" style={{ animation: anim('wFadeIn .4s ease 1200ms both') }}>
          Tap to continue
        </span>
      </div>
    </div>,
    document.body,
  )
}

/** One tulip: the stem grows, the leaf unfolds, the bud opens (the logo's mark, drawn tall). */
function Bud({ x, h, d, s, c, reduce }: { x: number; h: number; d: number; s: number; c: string; reduce: boolean }) {
  const stem = 62 * h + 18 // % of the garden's height
  const anim = (a: string) => (reduce ? undefined : a)
  return (
    <span className="absolute bottom-[8%]" style={{ left: `${x}%`, height: `${stem}%`, width: 0 }}>
      <span className="absolute bottom-0 left-[-0.75px] h-full w-[1.5px] origin-bottom rounded-pill" style={{ background: 'var(--willow-stem)', animation: anim(`wStem .5s var(--ease-standard) ${d}ms both`) }} />
      <span
        className="absolute bottom-[30%] left-0 h-[9px] w-[18px] origin-left rounded-[50%]"
        style={{ background: 'var(--willow-leaf)', rotate: x < 50 ? '-150deg' : '-30deg', filter: 'blur(.4px)', scale: `${s}`, animation: anim(`wLeaf .4s var(--ease-standard) ${d + 260}ms both`) }}
      />
      <span
        className="absolute top-0 left-0 block"
        style={{ width: 26 * s, height: 30 * s, translate: '-50% -78%', borderRadius: '50% 50% 46% 46%', background: c, filter: 'blur(1.6px)', animation: anim(`wBloom .55s var(--ease-bounce) ${d + 380}ms both`) }}
      />
    </span>
  )
}
