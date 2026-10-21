import { ArrowLeft, Clock, EyeOff, Leaf, Share2, Sprout } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { LogoMark } from '../components/willow/Logo'
import { countries } from './countries'
import {
  EMAIL,
  QUESTIONS,
  SURVEY,
  answered,
  clearProgress,
  endingFor,
  loadProgress,
  markDone,
  ordered,
  prune,
  saveProgress,
  screens,
  sourceOf,
  toggle,
  wasDone,
  type Answer,
  type Answers,
  type Ending,
  type Progress,
  type Question,
} from './flow'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080'
const AUTO_ADVANCE_MS = 380
const PILOT_DAY = new Date(`${SURVEY.pilot_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

type View = { kind: 'intro' } | { kind: 'q'; id: string } | { kind: 'end'; ending: Ending } | { kind: 'done'; again?: boolean }

const BACKDROP =
  'radial-gradient(40% 40% at 12% 18%, rgba(255,178,122,.5), transparent 70%), radial-gradient(45% 45% at 88% 82%, rgba(156,211,255,.55), transparent 70%), radial-gradient(35% 35% at 82% 12%, rgba(216,184,255,.5), transparent 70%), var(--bg-canvas)'

const fresh = (): Progress => ({ v: 1, answers: {}, at: null, started: Date.now(), seed: Math.floor(Math.random() * 2 ** 31), email: '', consent: false })

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The validation survey (docs/SURVEY.md) at /survey: an intro, one question per screen in four parts, the idea
 * (how Willow works, shown only after the questions about how people judge skincare today), and a thank-you.
 * Progress is saved on this device so a refresh carries on. Answers go to POST /v1/survey.
 */
export default function Survey() {
  const saved = useMemo(() => loadProgress(), [])
  const [p, setP] = useState<Progress>(() => saved ?? fresh())
  const [view, setView] = useState<View>(() => (!saved && wasDone() ? { kind: 'done', again: true } : { kind: 'intro' }))
  const [sending, setSending] = useState(false)
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd')
  const [error, setError] = useState<string | null>(null)
  const honeypot = useRef<HTMLInputElement>(null)
  const source = useMemo(() => sourceOf(window.location.search), [])

  useEffect(() => {
    if (view.kind === 'q') saveProgress(p)
  }, [p, view])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  const list = screens(p.answers)
  const current = view.kind === 'q' ? QUESTIONS.find((q) => q.id === view.id) ?? null : null
  const index = current ? list.findIndex((q) => q.id === current.id) : -1

  const go = (id: string | null, answers = p.answers) => {
    setError(null)
    const from = view.kind === 'q' ? QUESTIONS.findIndex((x) => x.id === view.id) : -1
    setDir(id && QUESTIONS.findIndex((x) => x.id === id) > from ? 'fwd' : 'back')
    setP((prev) => ({ ...prev, answers, at: id }))
    setView(id ? { kind: 'q', id } : { kind: 'intro' })
  }

  const begin = (resume: boolean) => {
    if (resume && p.at && QUESTIONS.some((q) => q.id === p.at)) return go(p.at)
    const next = { ...fresh(), seed: p.seed }
    setP(next)
    go(QUESTIONS[0].id, next.answers)
  }

  const send = async (answers: Answers, screened_out: Ending | null) => {
    setSending(true)
    setError(null)
    const emailShown = screens(answers).some((q) => q.kind === 'email')
    const email = emailShown && p.email.trim() ? p.email.trim() : null
    try {
      const res = await fetch(`${API_URL}/v1/survey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: SURVEY.version,
          answers,
          screened_out,
          email,
          email_consent: email ? p.consent : false,
          source,
          duration_s: Math.round((Date.now() - p.started) / 1000),
          website: honeypot.current?.value ?? '',
        }),
      })
      if (!res.ok && res.status !== 429) throw new Error(String(res.status))
      clearProgress()
      markDone()
      setView(screened_out ? { kind: 'end', ending: screened_out } : { kind: 'done' })
    } catch {
      setError('That didn’t go through. Check your connection and try again; your answers are saved on this device.')
    } finally {
      setSending(false)
    }
  }

  /** Move on from the current screen with these answers: an early ending, the next screen, or send. */
  const advance = (answers: Answers) => {
    if (!current) return
    const kept = prune(answers)
    const ending = endingFor(current, kept[current.id])
    if (ending === 'minor') {
      clearProgress()
      setP(fresh())
      return setView({ kind: 'end', ending })
    }
    if (ending === 'no_routine') return send({ age: kept.age, products_yesterday: kept.products_yesterday }, ending)
    const after = screens(kept)
    const at = after.findIndex((q) => q.id === current.id)
    const next = after[at + 1]
    if (next) return go(next.id, kept)
    setP((prev) => ({ ...prev, answers: kept }))
    send(stripInfo(kept), null)
  }

  const back = () => (index > 0 ? go(list[index - 1].id) : go(null))

  const setAnswer = (id: string, value: Answer | undefined) => {
    const answers = { ...p.answers }
    if (value === undefined) delete answers[id]
    else answers[id] = value
    setP((prev) => ({ ...prev, answers }))
    return answers
  }

  const partIndex = current ? SURVEY.parts.findIndex((x) => x.id === current.part) : -1

  return (
    <div className="relative min-h-dvh text-ink">
      <div aria-hidden className="pointer-events-none fixed inset-0" style={{ background: BACKDROP }}>
        <div className="absolute -top-[8%] -left-[10%] size-[46vmax] rounded-full opacity-70 blur-[48px]" style={{ background: 'radial-gradient(circle, rgba(255,150,100,.45), transparent 70%)', animation: 'wDrift 18s ease-in-out infinite alternate' }} />
        <div className="absolute top-[56%] left-[60%] size-[48vmax] rounded-full opacity-70 blur-[48px]" style={{ background: 'radial-gradient(circle, rgba(110,170,255,.42), transparent 70%)', animation: 'wDrift 21s ease-in-out -4s infinite alternate' }} />
      </div>
      {/* Never shown to people; a bot that fills every field fills this one too. */}
      <div aria-hidden className="pointer-events-none absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label>
          Website
          <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[640px] flex-col px-4 sm:px-6">
        <header className="flex min-h-[72px] items-center justify-between gap-3 pt-[max(12px,env(safe-area-inset-top))]">
          {current ? (
            <button type="button" onClick={back} aria-label="Back" className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-white/55 backdrop-blur-[12px] transition-colors hover:bg-white/85">
              <ArrowLeft size={18} strokeWidth={1.7} aria-hidden />
            </button>
          ) : (
            <a href="/" aria-label="Willow" className="flex items-center gap-2.5 text-ink no-underline">
              <LogoMark size={34} />
              <span className="text-[28px] font-light tracking-[-0.03em]">willow</span>
            </a>
          )}
          {current ? <Parts index={partIndex} /> : null}
        </header>

        {view.kind === 'intro' ? (
          <Intro resume={!!saved?.at && Object.keys(saved.answers).length > 0} onBegin={begin} />
        ) : view.kind === 'q' && current ? (
          <QuestionScreen
            key={current.id}
            q={current}
            p={p}
            dir={dir}
            last={index === list.length - 1}
            sending={sending}
            error={error}
            onAnswer={setAnswer}
            onContact={(email, consent) => setP((prev) => ({ ...prev, email, consent }))}
            onNext={advance}
          />
        ) : view.kind === 'end' ? (
          <Ended ending={view.ending} onRestart={() => go(null)} />
        ) : (
          <Done answers={p.answers} email={p.email} again={!!(view.kind === 'done' && view.again)} onRestart={() => { clearProgress(); setP(fresh()); go(null) }} />
        )}
      </div>
    </div>
  )
}

/** The info screen holds no answer, so it never travels. */
function stripInfo(answers: Answers): Answers {
  const info = new Set(QUESTIONS.filter((q) => q.kind === 'info' || q.kind === 'email').map((q) => q.id))
  return Object.fromEntries(Object.entries(answers).filter(([id]) => !info.has(id)))
}

function Parts({ index }: { index: number }) {
  const part = SURVEY.parts[index]
  return (
    <div className="flex min-w-0 flex-col items-end gap-1.5" aria-label={`Part ${index + 1} of ${SURVEY.parts.length}: ${part.label}`} role="status">
      <div aria-hidden className="flex gap-1">
        {SURVEY.parts.map((x, i) => (
          <span key={x.id} className="h-1 w-7 overflow-hidden rounded-pill bg-ink/15">
            <span className="sv-seg block h-full w-full rounded-pill bg-selected" style={{ transform: `scaleX(${i <= index ? 1 : 0})` }} />
          </span>
        ))}
      </div>
      <span aria-hidden className="truncate font-mono text-[11px] tracking-[.08em] text-ink-2">
        PART {index + 1} OF {SURVEY.parts.length} · {part.label.toUpperCase()}
      </span>
    </div>
  )
}

const primaryBtn = 'flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-[20px] bg-selected px-6 text-[16px] font-medium text-inverse transition-[background-color,opacity,scale] duration-200 hover:bg-[#2A2A2A] active:scale-[.985] disabled:opacity-40'
const glassCard = 'rounded-[28px] border border-white/70 bg-[rgba(250,250,248,.78)] shadow-[0_30px_70px_-40px_rgba(0,0,0,.3)] backdrop-blur-[24px]'

function Rise({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <div className={`sv-rise ${className}`} style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  )
}

function Intro({ resume, onBegin }: { resume: boolean; onBegin: (resume: boolean) => void }) {
  const rows = [
    { icon: Clock, text: 'About 4 minutes, one question at a time' },
    { icon: Leaf, text: 'No photos and no account' },
    { icon: EyeOff, text: 'Anonymous, unless you choose to leave an email' },
    { icon: Sprout, text: 'We’ll share what everyone said' },
  ]
  return (
    <main className="flex flex-1 flex-col justify-center pt-4 pb-[max(20px,env(safe-area-inset-bottom))]">
      <Rise>
        <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ A SHORT SURVEY FROM WILLOW</span>
        <h1 className="mt-3 mb-0 font-serif text-[clamp(40px,10vw,60px)] leading-[1.02] font-normal tracking-[-0.01em]">
          Does your skincare <em className="italic">actually</em> work?
        </h1>
        <p className="mt-4 mb-0 max-w-[52ch] text-[16px] leading-[1.5] text-ink-2">
          We’re Niwin and Harshini, two engineers building Willow. Before we build more, we’d love to hear how you decide whether a product is working for you.
        </p>
      </Rise>
      <Rise delay={120} className={`${glassCard} mt-6 px-5 py-2`}>
        <ul className="m-0 list-none p-0">
          {rows.map(({ icon: Icon, text }, i) => (
            <li key={text} className={`sv-rise flex items-center gap-3.5 py-3 text-[15px] ${i ? 'border-t border-ink/[.07]' : ''}`} style={{ animationDelay: `${220 + i * 70}ms` }}>
              <span aria-hidden className="grid size-9 flex-none place-items-center rounded-full bg-white/80 shadow-[inset_0_0_0_1px_rgba(18,18,18,.06)]">
                <Icon size={17} strokeWidth={1.6} />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </Rise>
      <Rise delay={520} className="mt-6 flex flex-col gap-2.5">
        {resume ? (
          <>
            <button type="button" className={primaryBtn} onClick={() => onBegin(true)}>
              Pick up where you left off <span aria-hidden className="sv-arrow">→</span>
            </button>
            <button type="button" className="min-h-11 text-[15px] text-ink-2 underline-offset-4 hover:underline" onClick={() => onBegin(false)}>
              Start again
            </button>
          </>
        ) : (
          <button type="button" className={primaryBtn} onClick={() => onBegin(false)}>
            Begin <span aria-hidden className="sv-arrow">→</span>
          </button>
        )}
        <p className="m-0 mt-1 text-center text-[13px] leading-[1.45] text-ink-2">For adults 18 and over. Your answers are used only for this research and never sold.</p>
      </Rise>
    </main>
  )
}

function QuestionScreen({
  q,
  p,
  dir,
  last,
  sending,
  error,
  onAnswer,
  onContact,
  onNext,
}: {
  q: Question
  p: Progress
  dir: 'fwd' | 'back'
  last: boolean
  sending: boolean
  error: string | null
  onAnswer: (id: string, value: Answer | undefined) => Answers
  onContact: (email: string, consent: boolean) => void
  onNext: (answers: Answers) => void
}) {
  const value = p.answers[q.id]
  const [full, setFull] = useState(false)
  const pointerAt = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const emailBad = q.kind === 'email' && p.email.trim() !== '' && (!EMAIL.test(p.email.trim()) || !p.consent)
  const has = q.kind === 'info' || q.kind === 'email' ? true : answered(value)
  const blocked = (q.required && !has) || emailBad || sending
  const skip = !q.required && !has && q.kind !== 'info'
  const emailEmpty = q.kind === 'email' && p.email.trim() === ''

  const pickSingle = (id: string) => {
    const answers = onAnswer(q.id, id)
    // A tap moves on by itself after a moment; keyboard choices (arrow keys) wait for Continue.
    if (Date.now() - pointerAt.current < 1200 && !reducedMotion()) {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => onNext(answers), AUTO_ADVANCE_MS)
    }
  }

  const label = sending ? 'Sending…' : last ? 'Send my answers' : q.kind === 'email' && emailEmpty ? 'Continue without email' : skip ? 'Skip' : 'Continue'

  return (
    <main className="flex flex-1 flex-col pb-[max(16px,env(safe-area-inset-bottom))]">
      <fieldset
        aria-labelledby={`q-${q.id}`}
        aria-describedby={q.help ? `h-${q.id}` : undefined}
        data-dir={dir}
        className="sv-screen m-0 min-w-0 flex-1 border-0 p-0 pt-[clamp(8px,4vh,40px)]"
        onPointerDown={() => {
          pointerAt.current = Date.now()
        }}
      >
        <h1 id={`q-${q.id}`} className="m-0 font-serif text-[clamp(28px,7.2vw,40px)] leading-[1.08] font-normal tracking-[-0.01em]">
          {q.title}
        </h1>
        {q.help ? (
          <p id={`h-${q.id}`} className="mt-2.5 mb-0 text-[15px] leading-[1.45] text-ink-2">
            {q.help}
          </p>
        ) : null}
        <div className="mt-6">
          {q.kind === 'single' || q.kind === 'scale' ? (
            <Choices q={q} seed={p.seed} type="radio" picked={typeof value === 'string' ? [value] : []} onPick={pickSingle} />
          ) : q.kind === 'multi' ? (
            <>
              <Choices
                q={q}
                seed={p.seed}
                type="checkbox"
                picked={Array.isArray(value) ? value : []}
                onPick={(id) => {
                  const r = toggle(q, Array.isArray(value) ? value : [], id)
                  setFull(r.full)
                  onAnswer(q.id, r.next.length ? r.next : undefined)
                }}
                full={!!q.max && Array.isArray(value) && value.length >= q.max}
              />
              <p role="status" className="mt-3 mb-0 min-h-5 text-[13px] text-ink-2">
                {q.max ? (
                  full ? (
                    <span key="full" className="sv-count">
                      That’s {q.max}. Remove one to choose another.
                    </span>
                  ) : (
                    <span key={Array.isArray(value) ? value.length : 0} className="sv-count">
                      {Array.isArray(value) ? value.length : 0} of {q.max} chosen
                    </span>
                  )
                ) : null}
              </p>
            </>
          ) : q.kind === 'text' ? (
            <label className="block">
              <span className="sr-only">{q.title}</span>
              <textarea
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onAnswer(q.id, e.target.value ? e.target.value : undefined)}
                maxLength={q.max_length ?? 1000}
                rows={5}
                placeholder={q.placeholder}
                className={`${glassCard} block w-full resize-none rounded-[22px] px-4 py-3.5 text-[16px] leading-[1.5] text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_2px_var(--action-selected)]`}
              />
            </label>
          ) : q.kind === 'info' ? (
            <Idea body={q.body ?? []} />
          ) : q.kind === 'email' ? (
            <Contact q={q} email={p.email} consent={p.consent} onChange={onContact} bad={emailBad} />
          ) : q.kind === 'country' ? (
            <CountryPick value={typeof value === 'string' ? value : ''} onPick={(c) => onAnswer(q.id, c || undefined)} />
          ) : null}
        </div>
      </fieldset>

      <div className="sticky bottom-0 -mx-4 mt-6 bg-gradient-to-t from-[var(--bg-canvas)] via-[color-mix(in_srgb,var(--bg-canvas)_80%,transparent)] to-transparent px-4 pt-6 pb-1 sm:-mx-6 sm:px-6">
        {error ? (
          <p role="alert" className="mt-0 mb-2.5 rounded-[16px] bg-white/80 px-4 py-3 text-[14px] leading-[1.45]">
            {error}
          </p>
        ) : null}
        <button type="button" className={primaryBtn} disabled={blocked} onClick={() => onNext(p.answers)}>
          {label} {sending ? null : <span aria-hidden className="sv-arrow">→</span>}
        </button>
      </div>
    </main>
  )
}

function Choices({ q, seed, type, picked, onPick, full }: { q: Question; seed: number; type: 'radio' | 'checkbox'; picked: string[]; onPick: (id: string) => void; full?: boolean }) {
  const opts = useMemo(() => ordered(q, seed), [q, seed])
  const scale = q.kind === 'scale'
  const graded = opts.filter((o) => !o.fixed)
  return (
    <div className="flex flex-col gap-2">
      {opts.map((o, i) => {
        const on = picked.includes(o.id)
        const dim = full && !on && type === 'checkbox' && !o.exclusive
        const step = scale && !o.fixed ? graded.indexOf(o) + 1 : 0
        return (
          <label
            key={o.id}
            style={{ animationDelay: `${80 + i * 35}ms` }}
            className={`sv-opt group relative flex min-h-[56px] cursor-pointer items-center gap-3.5 rounded-[20px] px-4 py-3 text-[16px] leading-[1.35] transition-[background-color,box-shadow,opacity,scale] duration-200 active:scale-[.99] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)] ${
              on ? 'bg-white shadow-[inset_0_0_0_2px_#121212,0_14px_30px_-22px_rgba(0,0,0,.45)]' : 'bg-white/60 shadow-[inset_0_0_0_1px_rgba(18,18,18,.08)] hover:bg-white/85'
            } ${dim ? 'opacity-55' : ''} ${o.fixed && scale && (i === 0 || !opts[i - 1].fixed) ? 'mt-2.5' : ''}`}
          >
            <input
              type={type}
              name={q.id}
              value={o.id}
              checked={on}
              aria-disabled={dim || undefined}
              onChange={() => onPick(o.id)}
              className="sr-only"
            />
            {/* a warm wash behind a picked choice, like light through a petal */}
            <span aria-hidden className={`pointer-events-none absolute inset-0 rounded-[20px] transition-opacity duration-300 ${on ? 'opacity-100' : 'opacity-0'}`} style={{ background: 'radial-gradient(120% 160% at 0% 50%, rgba(255,178,122,.2), rgba(216,184,255,.12) 45%, transparent 70%)' }} />
            <span aria-hidden className={`relative grid size-[22px] flex-none place-items-center border-[1.5px] transition-colors duration-200 ${type === 'radio' ? 'rounded-full' : 'rounded-[7px]'} ${on ? 'sv-check border-selected bg-selected text-inverse' : 'border-ink/25 bg-white/70'}`}>
              {on ? (
                <>
                  <span className={`sv-ring absolute inset-0 bg-selected ${type === 'radio' ? 'rounded-full' : 'rounded-[7px]'}`} />
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path className="sv-tick" pathLength={1} d="M5 12.5l4.2 4.2L19 7" />
                  </svg>
                </>
              ) : null}
            </span>
            <span className="relative min-w-0 flex-1">{o.label}</span>
            {step ? <Meter step={step} of={graded.length} on={on} /> : null}
          </label>
        )
      })}
    </div>
  )
}

/** A quiet five-dot gauge beside scale answers, so the order reads at a glance (decoration; the words carry the meaning). */
function Meter({ step, of, on }: { step: number; of: number; on: boolean }) {
  return (
    <span aria-hidden className="relative flex flex-none gap-[3px]">
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={`size-[6px] rounded-full transition-colors duration-200 ${i < step ? (on ? 'bg-selected' : 'bg-ink/35') : 'bg-ink/10'}`} />
      ))}
    </span>
  )
}

/** The idea screen: what Willow does, with the noise band drawn the way the app draws it. */
function Idea({ body }: { body: string[] }) {
  return (
    <div className={`${glassCard} px-5 pt-5 pb-4`}>
      <NoiseBand />
      <div className="mt-4 flex flex-col gap-3 text-[16px] leading-[1.55]">
        {body.map((line, i) => (
          <p key={i} className={`m-0 ${i === body.length - 1 ? 'text-[14px] text-ink-2' : ''}`}>
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}

function NoiseBand() {
  // Weekly readings: the first five wander inside the person's normal range, the last leaves it.
  const pts = [44, 52, 40, 49, 46, 18]
  const x = (i: number) => 22 + i * 52
  return (
    <figure className="m-0">
      <svg viewBox="0 0 320 96" className="block h-auto w-full" role="img" aria-label="Weekly readings inside a shaded normal range, then one reading clearly outside it, marked real change">
        <rect x="8" y="32" width="304" height="30" rx="15" fill="var(--signal-noise-band)" />
        <line x1="8" x2="312" y1="47" y2="47" stroke="var(--signal-noise-edge)" strokeDasharray="3 5" />
        <polyline className="sv-draw" pathLength={1} points={pts.map((y, i) => `${x(i)},${y}`).join(' ')} fill="none" stroke="var(--signal-noise)" strokeWidth="1.5" strokeLinejoin="round" />
        {pts.map((y, i) =>
          i === pts.length - 1 ? (
            <g key={i}>
              <circle className="sv-glow" cx={x(i)} cy={y} r="11" fill="var(--signal-change-glow)" opacity=".35" />
              <circle className="sv-dot" style={{ animationDelay: '1.35s' }} cx={x(i)} cy={y} r="5.5" fill="var(--signal-change)" />
            </g>
          ) : (
            <circle key={i} className="sv-dot" style={{ animationDelay: `${300 + i * 190}ms` }} cx={x(i)} cy={y} r="4" fill="#fff" stroke="var(--signal-noise)" strokeWidth="1.5" />
          ),
        )}
        <text x="14" y="82" fontSize="11" fill="var(--text-secondary)" fontFamily="Geist Mono, monospace" letterSpacing=".06em">
          YOUR NORMAL RANGE
        </text>
        <text x={x(pts.length - 1) - 16} y="22" fontSize="11" fill="var(--signal-change-ink)" textAnchor="end" fontFamily="Geist Mono, monospace" letterSpacing=".06em">
          REAL CHANGE
        </text>
      </svg>
    </figure>
  )
}

function Contact({ q, email, consent, onChange, bad }: { q: Question; email: string; consent: boolean; onChange: (email: string, consent: boolean) => void; bad: boolean }) {
  const invalid = email.trim() !== '' && !EMAIL.test(email.trim())
  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="mb-1.5 block text-[14px] text-ink-2">Email</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => onChange(e.target.value, consent)}
          placeholder="you@example.com"
          aria-invalid={invalid || undefined}
          className={`${glassCard} block min-h-[56px] w-full rounded-[20px] px-4 text-[16px] text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_2px_var(--action-selected)]`}
        />
      </label>
      {invalid ? <p className="m-0 text-[13px] text-ink-2">That doesn’t look like an email address yet.</p> : null}
      <label className="flex cursor-pointer items-start gap-3 rounded-[18px] bg-white/60 px-4 py-3.5 text-[15px] leading-[1.4] shadow-[inset_0_0_0_1px_rgba(18,18,18,.08)]">
        <input type="checkbox" checked={consent} onChange={(e) => onChange(email, e.target.checked)} className="m-0 mt-0.5 size-5 flex-none accent-[var(--action-selected)]" />
        <span>{q.consent}</span>
      </label>
      {bad && !invalid && !consent ? <p className="m-0 text-[13px] text-ink-2">Tick the box so we’re allowed to write to you, or clear the email to skip.</p> : null}
    </div>
  )
}

const CHEVRON = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#121212" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>')}")`

function CountryPick({ value, onPick }: { value: string; onPick: (code: string) => void }) {
  const { top, rest } = useMemo(() => countries(navigator.language || 'en'), [])
  return (
    <label className="block">
      <span className="sr-only">Country</span>
      <select
        value={value}
        onChange={(e) => onPick(e.target.value)}
        className={`${glassCard} block min-h-[56px] w-full appearance-none rounded-[20px] px-4 pr-11 text-[16px] text-ink outline-none focus:shadow-[0_0_0_2px_var(--action-selected)]`}
        style={{ backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 18px center', backgroundSize: 14 }}
      >
        <option value="">Choose a country</option>
        <optgroup label="Most answers so far">
          {top.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="All countries">
          {rest.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </optgroup>
        <option value="none">Prefer not to say</option>
      </select>
    </label>
  )
}

function Ended({ ending, onRestart }: { ending: Ending; onRestart: () => void }) {
  const minor = ending === 'minor'
  return (
    <main className="sv-rise flex flex-1 flex-col justify-center pb-[max(20px,env(safe-area-inset-bottom))]">
      <span className="sv-bloom self-start">
        <LogoMark size={56} />
      </span>
      <h1 className="mt-6 mb-0 font-serif text-[clamp(36px,9vw,52px)] leading-[1.05] font-normal">Thank you for stopping by.</h1>
      <p className="mt-4 mb-0 max-w-[50ch] text-[16px] leading-[1.5] text-ink-2">
        {minor
          ? 'This survey is for adults, so we haven’t kept any of your answers. Thanks for your interest in Willow.'
          : 'This survey is for people who use skincare day to day, so that’s all we need from you. Thank you for your time.'}
      </p>
      {minor ? (
        <button type="button" className="mt-6 min-h-11 self-start text-[15px] text-ink-2 underline underline-offset-4" onClick={onRestart}>
          Back to the start
        </button>
      ) : null}
    </main>
  )
}

/** A few petals in the logo's colours drift up from the mark and fade, once. */
const PETALS = [
  { x: 6, size: 10, color: '#FF8A6A', dx: '-34px', spin: '-80deg', delay: 300 },
  { x: 30, size: 8, color: '#F25FA8', dx: '18px', spin: '120deg', delay: 420 },
  { x: 48, size: 11, color: '#C9A8FF', dx: '46px', spin: '70deg', delay: 520 },
  { x: 18, size: 7, color: '#FFB27A', dx: '-12px', spin: '-140deg', delay: 680 },
  { x: 40, size: 9, color: '#9CD3FF', dx: '30px', spin: '160deg', delay: 820 },
  { x: 24, size: 6, color: '#86C5B0', dx: '-44px', spin: '-60deg', delay: 960 },
]
function Petals() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {PETALS.map((p, i) => (
        <span
          key={i}
          className="sv-petal"
          style={{ left: p.x, top: 22, width: p.size, height: p.size * 1.3, background: p.color, animationDelay: `${p.delay}ms`, ['--drift-x' as string]: p.dx, ['--spin' as string]: p.spin }}
        />
      ))}
    </span>
  )
}

function Done({ answers, email, again, onRestart }: { answers: Answers; email: string; again: boolean; onRestart: () => void }) {
  const [copied, setCopied] = useState(false)
  const pilot = answers.pilot === 'yes' || answers.pilot === 'maybe'
  const link = `${window.location.origin}/survey?src=share`
  const share = async () => {
    const data = { title: 'Does your skincare actually work?', text: 'A 4-minute survey from the people building Willow.', url: link }
    try {
      if (navigator.share) await navigator.share(data)
      else {
        await navigator.clipboard.writeText(link)
        setCopied(true)
      }
    } catch {
      // closed the share sheet: nothing to do
    }
  }
  return (
    <main className="flex flex-1 flex-col justify-center pb-[max(20px,env(safe-area-inset-bottom))]">
      <div className="relative self-start">
        {again ? null : <Petals />}
        <span className="sv-bloom relative">
          <LogoMark size={64} />
        </span>
      </div>
      <h1 className="sv-rise mt-6 mb-0 font-serif text-[clamp(44px,11vw,64px)] leading-[1.02] font-normal" style={{ animationDelay: '250ms' }}>
        Thank you.
      </h1>
      <p className="sv-rise mt-4 mb-0 max-w-[50ch] text-[17px] leading-[1.5] text-ink-2" style={{ animationDelay: '380ms' }}>
        {again ? 'You’ve already answered on this device. Thank you, it really helps.' : 'Every answer here shapes what we build next. We’ll share what everyone said once the survey closes.'}
      </p>
      {!again && pilot && email.trim() ? (
        <p className={`${glassCard} sv-rise mt-6 mb-0 px-5 py-4 text-[15px] leading-[1.5]`} style={{ animationDelay: '480ms' }}>
          We’ll email you before {PILOT_DAY} with everything you need for the pilot.
        </p>
      ) : null}
      <div className="sv-rise mt-7 flex flex-col gap-2.5" style={{ animationDelay: '560ms' }}>
        <button type="button" className={primaryBtn} onClick={share}>
          <Share2 size={18} strokeWidth={1.7} aria-hidden /> {copied ? 'Link copied' : 'Share the survey'}
        </button>
        <a href="/" className="flex min-h-11 items-center justify-center text-[15px] text-ink-2 underline-offset-4 hover:underline">
          See what Willow is
        </a>
        {again ? (
          <button type="button" className="min-h-11 text-[14px] text-ink-3 underline-offset-4 hover:underline" onClick={onRestart}>
            Someone else on this device? Start a new survey
          </button>
        ) : null}
      </div>
    </main>
  )
}
