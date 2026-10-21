import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { LogoMark } from '../components/willow/Logo'
import { sourceOf } from '../survey/flow'
import { GLASS_RADIUS, WaitlistField, type FieldEvent } from './WaitlistField'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080'
const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/
const KEY = 'willow.waitlist.joined'

type State = { kind: 'form' } | { kind: 'sending' } | { kind: 'done'; already: boolean; email: string | null }

const NOISE = 'abcdefghijklmnopqrstuvwxyz'
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Text that decodes itself out of random letters, left to right, like the field behind it. */
function Decode({ text, delay = 0, ms = 700 }: { text: string; delay?: number; ms?: number }) {
  const [shown, setShown] = useState(() => (still() ? text : text.replace(/\S/g, ' ')))
  useEffect(() => {
    if (still()) return
    let raf = 0
    const start = performance.now() + delay
    const tick = (now: number) => {
      const k = Math.max(0, (now - start) / ms)
      const solid = Math.floor(text.length * k)
      setShown([...text].map((ch, i) => (i < solid || ch === ' ' ? ch : now < start ? ' ' : NOISE[Math.floor(Math.random() * NOISE.length)])).join(''))
      if (solid < text.length) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text, delay, ms])
  return <span aria-hidden>{shown}</span>
}

/** a•••@example.com */
const masked = (email: string) => {
  const [name, domain] = email.split('@')
  return `${name.slice(0, 1)}•••@${domain}`
}

/** A check that draws itself in a ring of light, with two pulses spreading off it. */
function Joined() {
  return (
    <span aria-hidden className="wl-badge relative block size-14">
      <span className="wl-pulse absolute inset-0 rounded-full" />
      <span className="wl-pulse absolute inset-0 rounded-full [animation-delay:.18s]" />
      <svg viewBox="0 0 56 56" className="relative size-14">
        <circle cx="28" cy="28" r="26" fill="rgba(184,233,134,.14)" />
        <circle className="wl-draw" cx="28" cy="28" r="26" fill="none" stroke="var(--action-tag)" strokeWidth="2" pathLength={1} transform="rotate(-90 28 28)" />
        <path className="wl-draw wl-draw-late" d="M18 29 l7 7 l13 -15" fill="none" stroke="var(--action-tag)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
      </svg>
    </span>
  )
}

function joinedBefore() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The early-access waitlist at /waitlist: one card over the ASCII hologram (WaitlistField). The card talks to the
 * field: typing pulses it, a bad address glitches it, sending scans it, and joining opens the bud.
 * Emails go to POST /v1/waitlist.
 */
export default function Waitlist() {
  const fx = useMemo(() => new EventTarget(), [])
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>(() => (joinedBefore() ? { kind: 'done', already: true, email: null } : { kind: 'form' }))
  const [shake, setShake] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const honeypot = useRef<HTMLInputElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const source = useMemo(() => sourceOf(window.location.search), [])
  const button = useRef<HTMLButtonElement>(null)
  const [cheer, setCheer] = useState(false)
  const send = (kind: FieldEvent, at?: { x: number; y: number }) => fx.dispatchEvent(at ? new CustomEvent(kind, { detail: at }) : new Event(kind))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // read the field itself: some browsers autofill without telling React
    const value = (input.current?.value ?? email).trim().toLowerCase()
    if (!EMAIL.test(value)) {
      setError('That doesn’t look like an email address yet.')
      setShake((n) => n + 1)
      send('glitch')
      return
    }
    setError(null)
    setState({ kind: 'sending' })
    send('scan')
    try {
      const res = await fetch(`${API_URL}/v1/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, source, website: honeypot.current?.value ?? '' }),
      })
      if (res.status === 429) throw new Error('limit')
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { already?: boolean }
      try {
        localStorage.setItem(KEY, '1')
      } catch {
        /* private mode: the page still says thanks */
      }
      // the moment: light bursts from the button, the card springs, the bud opens
      const b = button.current?.getBoundingClientRect()
      send('win', b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : undefined)
      setCheer(true)
      setState({ kind: 'done', already: Boolean(body.already), email: value })
    } catch (err) {
      setState({ kind: 'form' })
      setError(err instanceof Error && err.message === 'limit' ? 'Too many tries from this network today. Try again tomorrow.' : 'That didn’t go through. Check your connection and try again.')
      setShake((n) => n + 1)
      send('idle')
      send('glitch')
    }
  }

  const done = state.kind === 'done'

  return (
    <main className="relative h-dvh min-h-[560px] w-full overflow-hidden bg-[#07061a] font-ui text-white">
      <WaitlistField fx={fx} />

      {/* Never shown to people; a bot that fills every field fills this one too. */}
      <div aria-hidden className="pointer-events-none absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label>
          Website
          <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-6">
        <a href="/" aria-label="Willow, home" className="pointer-events-auto flex items-center gap-2.5 no-underline">
          <LogoMark size={28} />
          <span className="text-[22px] font-light tracking-[-0.03em] text-white">willow</span>
        </a>
        <a href="/" className="pointer-events-auto text-[14px] font-light text-white/65 no-underline transition-colors hover:text-white">
          What is Willow? →
        </a>
      </header>

      {/* On a wide screen the card stands at the left edge and the hologram fills the space to its right
          (WaitlistField reads the card's place from the page, and draws its glass). */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 lg:justify-start lg:pl-8">
        <section
          data-waitlist-card
          aria-labelledby="wl-title"
          style={{ borderRadius: GLASS_RADIUS }}
          className={`wl-card wl-glass pointer-events-auto w-full max-w-[460px] p-6 sm:p-8 ${cheer ? 'wl-pop' : ''}`}
        >
          {done ? (
            <div key="done" aria-live="polite" className="wl-done">
              <Joined />
              <h1 id="wl-title" aria-label={state.already ? 'You’re already on the list.' : 'You’re on the list.'} className="wl-ink mt-6 mb-0 text-[40px] leading-[1] font-light tracking-[-0.035em] sm:text-[46px]">
                <Decode text={state.already ? 'You’re already ' : 'You’re '} ms={420} />
                <span className="font-serif font-normal italic tracking-[-0.01em]">
                  <Decode text="on the list." delay={120} ms={420} />
                </span>
              </h1>
              <p className="wl-ink mt-4 mb-0 text-[16px] leading-normal font-light text-white/78">
                We’ll email you{state.email ? <> at <span className="font-normal text-white">{masked(state.email)}</span></> : ''} when your spot is ready.
              </p>
              <a href="/" className="wl-chip mt-6 inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] text-white no-underline">
                See how Willow works →
              </a>
            </div>
          ) : (
            <div key="form">
              <h1 id="wl-title" aria-label="See whether your skin really changed." className="wl-ink m-0 text-[40px] leading-[1] font-light tracking-[-0.035em] sm:text-[46px]">
                <Decode text="See whether your skin " delay={650} />
                <span className="font-serif font-normal italic tracking-[-0.01em]">
                  <Decode text="really" delay={900} />
                </span>
                <Decode text=" changed." delay={1000} />
              </h1>
              <p className="wl-ink mt-4 mb-0 text-[16px] leading-normal font-light text-white/78">
                Willow is opening to a few people at a time. Join the waitlist and we’ll email you when your spot is ready.
              </p>
              <form
                key={shake}
                onSubmit={submit}
                noValidate
                className={`wl-bar mt-6 flex flex-col gap-2.5 rounded-[26px] p-1.5 sm:flex-row sm:items-center sm:gap-1 sm:rounded-full ${shake ? 'wl-shake' : ''}`}
              >
                <label htmlFor="wl-email" className="flex h-12 min-w-0 flex-1 items-center pl-5 sm:h-11">
                  <span className="sr-only">Email address</span>
                  <input
                    ref={input}
                    id="wl-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      if (error) setError(null)
                      send('pulse')
                    }}
                    disabled={state.kind === 'sending'}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'wl-note' : undefined}
                    className="wl-input h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] font-light text-white caret-[var(--action-primary)] placeholder:text-white/40 outline-none"
                  />
                </label>
                <button ref={button} type="submit" disabled={state.kind === 'sending'} className="cta-yellow inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border-0 px-6 text-[15px] font-normal transition-transform active:scale-[.96] disabled:cursor-wait sm:h-11">
                  {state.kind === 'sending' ? (
                    <>
                      <span aria-hidden className="wl-spin size-4 rounded-full border-2 border-black/20 border-t-black/70" />
                      Joining
                    </>
                  ) : (
                    'Join →'
                  )}
                </button>
              </form>
              <p id="wl-note" aria-live="polite" className="m-0 pl-5 text-[13.5px] leading-snug font-light text-[#ffb3a3] empty:hidden [&:not(:empty)]:mt-3.5">
                {error}
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
