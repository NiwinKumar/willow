import { useEffect, useRef, useState } from 'react'

import { useChat } from '../../features/advisor/chatStore'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { AssistantAvatar, type AvatarState } from '../assistant/AssistantAvatar'
import { MODE_BANNER_EVENT } from './ModeBanner'

// No input anywhere for this long (panel closed, nothing pending): the cat dozes off. Any input wakes it.
const DOZE_MS = 90_000
// After an answer lands: the happy hop, then back to idle.
const HAPPY_MS = 1600

/**
 * The advisor's own floating button, bottom right: the shadow cat (components/assistant). It opens and closes
 * the advisor panel and shows what the advisor is doing:
 *   thinking while a question is out → speaking while the answer is revealed → a happy hop when it lands,
 *   listening while the pointer is on it or the person is typing a question, sleepy after a long quiet spell,
 *   idle otherwise.
 * Bottom right on wide screens; on phones, in the header's right corner (never over content, the mode banner or the tab bar). Opening: the cat shrinks away as the advisor grows out of its spot;
 * closing: the advisor folds back into the corner and the cat pops out again (AppShell's AdvisorHost does the
 * panel's half). Reduced motion: both only fade.
 */
export function AdvisorFab({ open, onToggle, wide, covered }: { open: boolean; onToggle: () => void; wide: boolean; covered: boolean }) {
  const { phase, messages } = useChat()
  const answered = messages.at(-1)?.role === 'willow'
  const [hover, setHover] = useState(false)
  const [typing, setTyping] = useState(false)
  const [happy, setHappy] = useState(false)
  const [dozing, setDozing] = useState(false)

  // An answer finished (thinking or revealing → idle, and the last message is Willow's, not an error): hop once.
  const lastPhase = useRef(phase)
  useEffect(() => {
    const was = lastPhase.current
    lastPhase.current = phase
    if (phase !== 'idle' || was === 'idle' || !answered) return
    setHappy(true)
    const t = window.setTimeout(() => setHappy(false), HAPPY_MS)
    return () => window.clearTimeout(t)
  }, [phase, answered])

  // Listening while the question field has focus (wherever the panel is).
  useEffect(() => {
    const check = () => setTyping(document.activeElement?.id === 'ask-input')
    document.addEventListener('focusin', check)
    document.addEventListener('focusout', check)
    return () => {
      document.removeEventListener('focusin', check)
      document.removeEventListener('focusout', check)
    }
  }, [])

  // Dozing: a quiet spell with nothing going on. Input resets the timer (cheap: no state change unless asleep).
  const asleep = useRef(false)
  useEffect(() => {
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        asleep.current = true
        setDozing(true)
      }, DOZE_MS)
    }
    const wake = () => {
      if (asleep.current) {
        asleep.current = false
        setDozing(false)
      }
      arm()
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }))
    arm()
    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, wake))
    }
  }, [])

  const state: AvatarState =
    phase === 'thinking' ? 'thinking' : phase === 'revealing' ? 'speaking' : happy ? 'happy' : hover || typing ? 'listening' : dozing && !open ? 'sleepy' : 'idle'
  // Phones: the cat sits in the header's right corner (where the profile pill was; You is a tab now), so it
  // never covers content or the tab bar's thumb zone. Wide: bottom right, as drawn.
  const size = wide ? 64 : 46
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const hidden = covered
  // Phones: the header starts below the mode banner (judge tour, demo) until the page scrolls past it, so the
  // cat moves down with the header instead of sitting on the banner's words. Set on the element, once a frame.
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = holder.current
    if (!el) return
    if (wide) {
      el.style.translate = ''
      return
    }
    let raf = 0
    const place = () => {
      raf = 0
      const banner = document.querySelector('[data-mode-banner]')
      const below = banner ? Math.max(0, Math.round(banner.getBoundingClientRect().bottom)) : 0
      el.style.translate = below ? `0 ${below}px` : ''
    }
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(place)
    }
    place()
    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    window.addEventListener(MODE_BANNER_EVENT, queue)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
      window.removeEventListener(MODE_BANNER_EVENT, queue)
    }
  }, [wide])
  return (
    // The holder shows and hides the cat: it shrinks away as the advisor grows out of its spot, and pops back
    // (a little overshoot) once the advisor has folded back into it. The button inside keeps hover and press.
    <div
      ref={holder}
      className="fixed z-[36]"
      style={{
        width: size,
        height: size,
        right: wide ? 24 : 'clamp(14px,4vw,38px)',
        ...(wide ? { bottom: 20 } : { top: 'calc(env(safe-area-inset-top) + 11px)' }),
        opacity: hidden ? 0 : 1,
        scale: hidden && !reduced ? '0.4' : '1',
        pointerEvents: hidden ? 'none' : undefined,
        transition: hidden
          ? 'scale .2s var(--ease-exit), opacity .16s ease'
          : // back once the panel has nearly folded away
            'scale .55s var(--ease-bounce) .24s, opacity .2s ease .24s',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-label="Wisp"
        aria-expanded={open}
        title="Ask Wisp"
        tabIndex={hidden ? -1 : undefined}
        className="grid size-full place-items-center rounded-full transition-[scale] duration-300 ease-spring hover:scale-[1.05] active:scale-[.94] active:duration-100 motion-reduce:hover:scale-100"
        // a soft shadow under the button, tinted like the cat's rim light
        style={{ boxShadow: '0 18px 34px -16px rgba(72,56,150,.5), 0 4px 10px -6px rgba(0,0,0,.25)' }}
      >
        <AssistantAvatar state={state} size={size} />
      </button>
    </div>
  )
}
