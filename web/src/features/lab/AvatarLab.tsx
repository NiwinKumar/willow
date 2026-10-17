import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { AssistantAvatar, type AvatarState } from '../../components/assistant/AssistantAvatar'
import { AVATAR_STATES } from '../../components/assistant/avatarMotion'

const SIZES = [48, 64, 96, 128, 256, 512]
const WORDS: Record<AvatarState, string> = {
  idle: 'Idle: floats, breathes, blinks every few seconds, glances now and then.',
  listening: 'Listening: lifts and leans in, eyes a little larger and steadier, glow up.',
  thinking: 'Thinking: tilts, eyes drift up and aside, slower and rarer blinks.',
  speaking: 'Speaking: the voice moves the body (smoothed), eyes stay lively.',
  happy: 'Happy: one springy hop with happy eyes, then back to idle by itself.',
  sleepy: 'Sleepy: settles low, slow deep breaths, sleepy eyes.',
  inactive: 'Inactive: half-lidded and almost still.',
}

type Voice = 'auto' | 'simulated' | 'manual'

/**
 * /lab/avatar: the assistant avatar in every state and size, with a state switcher, a simulated voice and
 * a manual level, and a reduced-motion switch. Not linked from the app; for checking the motion.
 */
export default function AvatarLab() {
  const [state, setState] = useState<AvatarState>('idle')
  const [size, setSize] = useState(256)
  const [voice, setVoice] = useState<Voice>('simulated')
  const [manual, setManual] = useState(0.5)
  const [reduced, setReduced] = useState<boolean | undefined>(undefined)
  const [container, setContainer] = useState<'minimal' | 'none'>('minimal')
  const meter = useRef<HTMLSpanElement>(null)

  // Simulated speech: phrases of syllables with pauses between them, read every frame (no re-render).
  const level = useRef(0)
  useEffect(() => {
    if (voice !== 'simulated') return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = (now - start) / 1000
      const phrase = t % 3.2 < 2.4 ? 1 : 0 // speak 2.4 s, pause 0.8 s
      const syll = Math.max(0, Math.sin(t * 11)) ** 1.5
      level.current = phrase * (0.2 + 0.7 * syll * (0.55 + 0.45 * Math.sin(t * 2.3)))
      if (meter.current) meter.current.style.transform = `scaleX(${level.current.toFixed(3)})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [voice])
  const audioSource = useMemo(() => (voice === 'simulated' ? () => level.current : undefined), [voice])

  useEffect(() => {
    document.title = 'Assistant avatar · Willow'
  }, [])

  const chip = (on: boolean) => `rounded-pill px-3.5 py-2 text-[14px] transition-colors ${on ? 'bg-selected text-inverse' : 'bg-white/70 text-ink hover:bg-white'}`
  return (
    <main className="min-h-dvh bg-[#F0F0F4] px-4 py-8 text-ink sm:px-8">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 font-serif text-[40px] leading-none font-normal">Assistant avatar</h1>
            <p className="m-0 max-w-[60ch] text-[15px] text-ink-2">The shadow cat from the asset pack, drawn and animated in code (minimal button, rim glow, body, vector eyes): every state is a pose the creature glides to.</p>
          </div>
          <Link to="/home" className="text-[14px] text-ink underline underline-offset-4">
            Back to Willow
          </Link>
        </header>

        <section aria-label="Stage" className="grid gap-6 rounded-[32px] bg-white/60 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,.8)] lg:grid-cols-[1fr_340px]">
          <div className="grid min-h-[300px] place-items-center overflow-hidden rounded-[24px] bg-[radial-gradient(80%_80%_at_50%_40%,#fff,#ECECF2)] p-6">
            <AssistantAvatar state={state} size={size} audioLevel={voice === 'manual' ? manual : undefined} audioSource={audioSource} reducedMotion={reduced} container={container} label={`Assistant, ${state}`} />
          </div>
          <div className="flex flex-col gap-5">
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-[13px] text-ink-2">State</legend>
              <div className="flex flex-wrap gap-1.5">
                {AVATAR_STATES.map((s) => (
                  <button key={s} type="button" aria-pressed={state === s} onClick={() => setState(s)} className={chip(state === s)}>
                    {s}
                  </button>
                ))}
              </div>
              <p className="m-0 min-h-[40px] text-[13px] leading-[1.45] text-ink-2" aria-live="polite">
                {WORDS[state]}
              </p>
            </fieldset>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-[13px] text-ink-2">Size (CSS px)</legend>
              <div className="flex flex-wrap gap-1.5">
                {SIZES.map((s) => (
                  <button key={s} type="button" aria-pressed={size === s} onClick={() => setSize(s)} className={chip(size === s)}>
                    {s}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-[13px] text-ink-2">Container</legend>
              <div className="flex flex-wrap gap-1.5">
                {(['minimal', 'none'] as const).map((c) => (
                  <button key={c} type="button" aria-pressed={container === c} onClick={() => setContainer(c)} className={chip(container === c)}>
                    {c === 'minimal' ? 'minimal button' : 'no container'}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-[13px] text-ink-2">Voice (used while speaking)</legend>
              <div className="flex flex-wrap gap-1.5">
                {(['simulated', 'manual', 'auto'] as Voice[]).map((v) => (
                  <button key={v} type="button" aria-pressed={voice === v} onClick={() => setVoice(v)} className={chip(voice === v)}>
                    {v === 'auto' ? 'built-in' : v}
                  </button>
                ))}
              </div>
              {voice === 'manual' ? (
                <label className="flex items-center gap-3 text-[13px] text-ink-2">
                  Level
                  <input type="range" min={0} max={1} step={0.01} value={manual} onChange={(e) => setManual(Number(e.target.value))} className="flex-1" />
                  <span className="w-9 text-right tabular-nums">{manual.toFixed(2)}</span>
                </label>
              ) : voice === 'simulated' ? (
                <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-ink/10">
                  <span ref={meter} className="block h-full origin-left rounded-full bg-[linear-gradient(90deg,#7FE3F0,#B89BFF,#F2A6D8)]" style={{ transform: 'scaleX(0)' }} />
                </span>
              ) : (
                <span className="text-[13px] text-ink-2">No level given: the avatar makes its own soft speech rhythm.</span>
              )}
            </fieldset>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-[13px] text-ink-2">Motion</legend>
              <div className="flex flex-wrap gap-1.5">
                {([
                  [undefined, 'follow system'],
                  [false, 'full'],
                  [true, 'reduced'],
                ] as const).map(([v, l]) => (
                  <button key={l} type="button" aria-pressed={reduced === v} onClick={() => setReduced(v)} className={chip(reduced === v)}>
                    {l}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <section aria-labelledby="all-h" className="flex flex-col gap-4">
          <h2 id="all-h" className="m-0 text-[18px] font-medium">
            Every state at 96
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {AVATAR_STATES.map((s) => (
              <button key={s} type="button" onClick={() => setState(s)} className="flex flex-col items-center gap-2 rounded-[22px] bg-white/60 p-4 text-[13px] text-ink-2 hover:bg-white">
                <AssistantAvatar state={s} size={96} reducedMotion={reduced} container={container} />
                {s}
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="sizes-h" className="flex flex-col gap-4">
          <h2 id="sizes-h" className="m-0 text-[18px] font-medium">
            Sizes
          </h2>
          <div className="flex flex-wrap items-end gap-6 overflow-x-auto rounded-[22px] bg-white/60 p-5">
            {SIZES.slice(0, 5).map((s) => (
              <div key={s} className="flex flex-col items-center gap-2 text-[13px] text-ink-2">
                <AssistantAvatar state={state} size={s} reducedMotion={reduced} container={container} />
                {s}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
