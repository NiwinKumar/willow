import { Captions, CaptionsOff, Mic, MicOff, PhoneOff, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { useMediaQuery } from '../../lib/useMediaQuery'
import { Orb } from './Orb'
import type { VoiceSession, VoiceSnapshot } from './session'
import './voice.css'

/**
 * Wisp's voice mode: a full-screen sheet on phones, a centred card on wider screens. One lead (the orb and
 * what Wisp is doing, in two short lines), then the two controls a person needs while talking: mute and
 * end. Captions are off by default (a toggle, for accessibility) and only show the last exchange; nothing
 * said here becomes a chat message. Esc or End closes it; focus stays inside while open and goes back to the
 * mic button after.
 */

type Copy = { title: string; line: string }

function copyOf(s: VoiceSnapshot): Copy {
  const mins = s.maxSeconds ? Math.max(1, Math.round(s.maxSeconds / 60)) : null
  switch (s.state) {
    case 'connecting':
      return { title: 'Connecting', line: 'Wisp will say hello in a moment.' }
    case 'listening':
      return s.muted ? { title: 'Muted', line: 'Turn the mic back on to talk.' } : { title: 'Listening', line: 'Speak in any language. Talk over Wisp to interrupt.' }
    case 'thinking':
      return { title: 'Thinking', line: s.checking ? 'Looking at your Willow data.' : 'Answers use only your Willow data.' }
    case 'speaking':
      return { title: 'Wisp is speaking', line: 'Talk any time to interrupt.' }
    case 'interrupted':
      return { title: 'Go ahead', line: 'Wisp stopped to listen.' }
    case 'reconnecting':
      return { title: 'Reconnecting', line: 'The line dropped for a moment.' }
    case 'ending':
      return { title: 'Wrapping up', line: mins ? `Voice chats last up to ${mins} minutes. Start again any time.` : 'Start again any time.' }
    case 'ended':
      return { title: 'Voice chat ended', line: 'Nothing from it was added to your chat.' }
    case 'micDenied':
      return { title: 'The microphone is off', line: 'Allow the microphone for this site in your browser settings, or type your question.' }
    case 'error':
      return { title: 'Wisp can’t talk right now', line: s.message ?? 'Try again in a moment, or type your question.' }
  }
}

/** `initial` is started in the tap that opened voice mode; `make` starts another (Start again, Try again). */
export function VoiceMode({ initial, make, onClosed }: { initial: VoiceSession; make: () => VoiceSession; onClosed: () => void }) {
  const [session, setSession] = useState(initial)
  const snap = useSyncExternalStore(session.subscribe, session.snapshot)
  const [captions, setCaptions] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const phone = useMediaQuery('(max-width: 639px)')
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const sheet = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  const done = ['ended', 'error', 'micDenied'].includes(snap.state)
  const copy = copyOf(snap)

  const close = () => {
    if (leaving) return
    session.end()
    setLeaving(true)
    window.setTimeout(onClosed, reduced ? 150 : 220)
  }
  const again = () => {
    // inside the tap, so the new audio context may play (iOS)
    session.end()
    setSession(make())
  }

  useEffect(() => {
    first.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  useEffect(() => () => session.end(), [session])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab' && sheet.current) {
      const items = Array.from(sheet.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
      if (!items.length) return
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1
      e.preventDefault()
      items[next].focus()
    }
  }

  const orbSize = phone ? 232 : 208
  return (
    <div data-phase={leaving ? 'leaving' : 'open'} className="fixed inset-0 z-[100] flex items-center justify-center" onKeyDown={onKey}>
      <div className="vm-scrim absolute inset-0 bg-[rgba(18,18,18,.28)] backdrop-blur-[6px]" onClick={close} aria-hidden />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vm-title"
        aria-describedby="vm-line"
        className={`vm-sheet relative flex flex-col items-center overflow-hidden bg-surface text-ink ${phone ? 'h-full w-full px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))]' : 'w-[440px] rounded-[36px] px-7 pb-7 pt-4 shadow-[var(--shadow-modal)] squircle'}`}
        style={{ background: 'radial-gradient(120% 70% at 50% 0%, #fff 0%, var(--bg-surface) 55%, var(--bg-sunken) 100%)' }}
      >
        <div className="flex w-full items-center gap-2">
          <span className="text-[13px] text-ink-2">Talk to Wisp</span>
          <button
            type="button"
            onClick={() => setCaptions((c) => !c)}
            aria-pressed={captions}
            title={captions ? 'Hide live captions' : 'Show live captions'}
            className="vm-btn hit44 ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-[12.5px] hover:bg-ink/5"
            style={{ background: captions ? 'var(--bg-muted)' : undefined }}
          >
            {captions ? <Captions size={15} strokeWidth={1.8} aria-hidden /> : <CaptionsOff size={15} strokeWidth={1.8} aria-hidden />}
            Captions
          </button>
          <button type="button" onClick={close} aria-label="Close voice mode" title="Close · Esc" className="vm-btn hit44 grid size-9 place-items-center rounded-full bg-ink/5 hover:bg-ink/10">
            <X size={16} strokeWidth={1.8} aria-hidden />
          </button>
        </div>

        <div className={`flex w-full flex-1 flex-col items-center justify-center ${phone ? 'gap-8' : 'gap-7 pb-2 pt-8'}`}>
          <div className="vm-orb" style={{ width: orbSize, height: orbSize }}>
            <Orb state={snap.state} muted={snap.muted} levels={session.levels} size={orbSize} reduced={reduced} />
          </div>
          <div className="flex min-h-[64px] flex-col items-center gap-1.5 text-center" aria-live="polite">
            <h2 key={copy.title} id="vm-title" className="vm-swap text-[22px] font-normal leading-tight tracking-[-0.01em]">
              {copy.title}
            </h2>
            <p key={copy.line} id="vm-line" className="vm-swap max-w-[320px] text-[13.5px] leading-snug text-ink-2 [text-wrap:balance]">
              {copy.line}
            </p>
          </div>
          {captions && !done ? (
            <div className="flex min-h-[72px] w-full max-w-[360px] flex-col gap-1.5" aria-live="polite" aria-label="Live captions">
              {snap.captions.length ? (
                snap.captions.map((c, i) => (
                  <p key={`${i}-${c.role}`} className={`vm-caption text-[14px] leading-snug ${c.role === 'you' ? 'text-ink-2' : 'text-ink'}`}>
                    <span className="sr-only">{c.role === 'you' ? 'You: ' : 'Wisp: '}</span>
                    {c.text.length > 220 ? `…${c.text.slice(-220)}` : c.text}
                  </p>
                ))
              ) : (
                <p className="vm-caption text-center text-[13px] text-ink-2">Captions appear here as you talk.</p>
              )}
            </div>
          ) : null}
        </div>

        {done ? (
          <div className="flex w-full flex-col items-center gap-2.5 pt-4">
            <button ref={first} type="button" onClick={again} className="vm-btn hit44 min-h-12 w-full max-w-[300px] rounded-pill bg-selected text-[15px] text-inverse">
              {snap.state === 'ended' ? 'Start again' : 'Try again'}
            </button>
            <button type="button" onClick={close} className="vm-btn hit44 min-h-11 w-full max-w-[300px] rounded-pill text-[14px] hover:bg-ink/5">
              {snap.state === 'ended' ? 'Close' : 'Type instead'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-8 pt-4">
            <div className="flex flex-col items-center gap-1.5">
              <button
                ref={first}
                type="button"
                onClick={() => session.setMuted(!snap.muted)}
                aria-pressed={snap.muted}
                aria-label={snap.muted ? 'Turn the microphone on' : 'Mute the microphone'}
                className="vm-btn hit44 grid size-14 place-items-center rounded-full"
                style={{ background: snap.muted ? 'var(--action-selected)' : 'var(--bg-muted)', color: snap.muted ? '#fff' : 'var(--text-primary)' }}
              >
                {snap.muted ? <MicOff size={22} strokeWidth={1.8} aria-hidden /> : <Mic size={22} strokeWidth={1.8} aria-hidden />}
              </button>
              <span className="text-[12px] text-ink-2" aria-hidden>
                {snap.muted ? 'Unmute' : 'Mute'}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <button type="button" onClick={close} aria-label="End voice chat" className="vm-btn hit44 grid size-14 place-items-center rounded-full text-white" style={{ background: 'var(--aura-coral)' }}>
                <PhoneOff size={22} strokeWidth={1.8} aria-hidden />
              </button>
              <span className="text-[12px] text-ink-2" aria-hidden>
                End
              </span>
            </div>
          </div>
        )}
        <p className="pt-4 text-center text-[11.5px] leading-snug text-ink-2">Numbers come only from your readings. Cosmetic guidance, not medical advice.</p>
      </div>
    </div>
  )
}
