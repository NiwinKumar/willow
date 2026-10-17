import { useEffect, useRef, useState } from 'react'

import { useChat } from '../../features/advisor/chatStore'
import { AssistantAvatar, type AvatarState } from '../assistant/AssistantAvatar'

// No input anywhere for this long (panel closed, nothing pending): the cat dozes off. Any input wakes it.
const DOZE_MS = 90_000
// After an answer lands: the happy hop, then back to idle.
const HAPPY_MS = 1600

/**
 * The advisor's own floating button, bottom left: the shadow cat (components/assistant). It opens and closes
 * the advisor panel and shows what the advisor is doing:
 *   thinking while a question is out → speaking while the answer is revealed → a happy hop when it lands,
 *   listening while the pointer is on it or the person is typing a question, sleepy after a long quiet spell,
 *   idle otherwise.
 * Wide screens: just right of the sidebar (it follows the sidebar's collapse). Phones: above the dock, and
 * out of the way while the full-screen advisor is open.
 */
export function AdvisorFab({ open, onToggle, wide, sidebarWidth, covered }: { open: boolean; onToggle: () => void; wide: boolean; sidebarWidth: number; covered: boolean }) {
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
  const size = wide ? 64 : 58
  const hidden = covered
  return (
    <button
      type="button"
      onClick={onToggle}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      aria-label="Advisor"
      aria-pressed={open}
      title={open ? 'Close the advisor' : 'Ask Willow'}
      tabIndex={hidden ? -1 : undefined}
      className="fixed z-[36] grid place-items-center rounded-full transition-[left,opacity,scale,translate] duration-[450ms] ease-spring hover:scale-[1.05] active:scale-[.94] active:duration-100 motion-reduce:hover:scale-100"
      style={{
        width: size,
        height: size,
        left: wide ? sidebarWidth + 12 + 16 : 16,
        bottom: wide ? 20 : 'calc(max(14px, env(safe-area-inset-bottom)) + 76px)',
        opacity: hidden ? 0 : 1,
        translate: hidden ? '0 12px' : '0 0',
        pointerEvents: hidden ? 'none' : undefined,
        // a soft shadow under the glass, tinted like its rim
        boxShadow: '0 18px 34px -16px rgba(72,56,150,.5), 0 4px 10px -6px rgba(0,0,0,.25)',
      }}
    >
      <AssistantAvatar state={state} size={size} />
      {open ? <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-selected shadow-[0_0_0_2px_rgba(250,250,248,.95)]" /> : null}
    </button>
  )
}
