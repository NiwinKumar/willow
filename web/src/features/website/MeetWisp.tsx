import { useEffect, useState } from 'react'

import { AssistantAvatar, type AvatarState } from '../../components/assistant/AssistantAvatar'
import { useMediaQuery } from '../../lib/useMediaQuery'

const GREETING = 'Hi, I’m Wisp, your personal skin assistant. Ask me anything about your results, your routine or a product.'

/** What Wisp can do, in the app's own words: every line is true of the advisor (api/app/advisor.py). */
const ABILITIES = [
  { title: 'Reads your results', body: 'Ask why a reading moved, or what to do about it.', swatch: 'radial-gradient(circle at 40% 30%, var(--aura-ice), var(--aura-sky))' },
  { title: 'Knows your routine', body: 'Spots clashing actives, doubles and gaps, and suggests a fix.', swatch: 'radial-gradient(circle at 40% 30%, var(--aura-apricot), var(--aura-coral))' },
  { title: 'Keeps to your numbers', body: 'Every figure comes from your own measurements. Appearance only, never a diagnosis.', swatch: 'radial-gradient(circle at 40% 30%, var(--aura-lilac), var(--aura-violet))' },
]

/**
 * The "Meet Wisp" onboarding moment. The shadow cat wakes (eyes open, a happy hop), then speaks its greeting in a
 * typed speech bubble while its body moves with the words, settles, and three short cards say what it can do.
 * Reduced motion: no waking and no typing, the greeting and cards are there at once (the cat still blinks).
 */
export function MeetWisp() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const small = useMediaQuery('(max-height: 700px)')
  const phone = useMediaQuery('(max-width: 639px)')
  const [state, setState] = useState<AvatarState>('sleepy')
  const [typed, setTyped] = useState(0)
  const [said, setSaid] = useState(false)

  useEffect(() => {
    if (reduced) {
      setState('idle')
      setTyped(GREETING.length)
      setSaid(true)
      return
    }
    const timers: number[] = []
    let ticker: number | undefined
    timers.push(window.setTimeout(() => setState('listening'), 700))
    timers.push(window.setTimeout(() => setState('happy'), 1500))
    timers.push(
      window.setTimeout(() => {
        setState('speaking')
        let n = 0
        ticker = window.setInterval(() => {
          n += 1
          setTyped(n)
          if (n >= GREETING.length) {
            window.clearInterval(ticker)
            setState('idle')
            setSaid(true)
          }
        }, 26)
      }, 2500),
    )
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      if (ticker) window.clearInterval(ticker)
    }
  }, [reduced])

  const waking = state === 'sleepy' || state === 'listening'
  const size = small || phone ? 116 : 188

  return (
    <div className="flex flex-col items-center gap-4 sm:gap-5">
      <div className="relative grid place-items-center" style={{ width: size + 56, height: size + 16 }}>
        {/* a soft halo that comes up as Wisp wakes */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full transition-opacity duration-[1200ms] motion-reduce:transition-none"
          style={{ background: 'radial-gradient(closest-side, rgba(216,184,255,.75), rgba(156,211,255,.4) 55%, transparent 80%)', opacity: waking ? 0.25 : 0.9, filter: 'blur(6px)' }}
        />
        <div className="relative">
          <AssistantAvatar state={state} size={size} container="none" label="Wisp" />
        </div>
      </div>

      <div className="relative w-full max-w-[560px] rounded-[26px] px-5 py-4 text-center backdrop-blur-[24px]" style={{ background: 'rgba(250,250,248,.84)', boxShadow: '0 30px 70px -40px rgba(0,0,0,.3)', minHeight: small ? 84 : 96 }} aria-live="polite">
        <span aria-hidden className="absolute -top-[7px] left-1/2 size-3.5 -translate-x-1/2 rotate-45 rounded-[3px]" style={{ background: 'rgba(250,250,248,.9)' }} />
        <p className="m-0 font-serif text-[clamp(18px,2.4vh,22px)] leading-[1.35] text-ink">
          <span className="sr-only">{GREETING}</span>
          <span aria-hidden>
            {GREETING.slice(0, typed)}
            {!said ? <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-ink/60" /> : null}
          </span>
        </p>
      </div>

      <ul className="m-0 grid w-full list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-3">
        {ABILITIES.map((a, i) => (
          <li
            key={a.title}
            className={`flex items-start gap-3 rounded-[22px] bg-white/70 p-3.5 backdrop-blur-[16px] transition-all duration-700 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none ${said ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}
            style={{ transitionDelay: said && !reduced ? `${i * 140}ms` : '0ms', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.7)' }}
          >
            <span aria-hidden className="size-8 flex-none rounded-[11px]" style={{ background: a.swatch, boxShadow: 'inset 0 0 10px 2px rgba(255,255,255,.6)' }} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] leading-[1.25]">{a.title}</span>
              <span className="text-[13px] leading-[1.35] text-ink-2">{a.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
