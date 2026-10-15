import { ArrowUp, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useShell, type AdvisorSeed } from '../../components/shell/ShellContext'
import { useRoutine, useRoutineCheck } from '../../data/hooks'
import type { Product, Session } from '../../data/types'
import { useData } from '../../data/useData'
import { fmtDate } from '../../lib/format'
import { useAuth } from '../../lib/useAuth'
import { useDemoStatus } from '../../lib/useDemoStatus'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { verdictCounts } from '../../lib/verdict'
import { AvailableInOwnAccount } from '../routine/OwnAccountNotice'
import { ProductSheet } from '../routine/ProductSheet'
import { findingsOf } from '../routine/routineModel'
import './advisor.css'
import { ask, newChat, setTokenSource, stopWaiting, takeSeed, useChat } from './chatStore'
import { Answer, ErrorBubble, UserBubble } from './Messages'
import { AnswerOrb, Water } from './Water'

const usable = (s: Session) => s.status === 'done' && s.measured !== false && Boolean(s.result?.quality.passed)

/** The api counts questions per UTC day: the local time that day ends, e.g. "05:30". */
function resetTime(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * The advisor (design: Willow App Routine, view="advisor"), drawn inside the shell's glass panel: header
 * (close + "■ ADVISOR" + what it reads), the one chat, and the composer. Gemini answers from the person's
 * own sessions, routine and the catalog (api/app/advisor.py); every number is checked there.
 */
export default function AdvisorPanel({ seed, onClose }: { seed: AdvisorSeed | null; onClose: () => void }) {
  const data = useData()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative z-[3] flex min-h-[52px] flex-none items-center gap-2.5 px-3.5 pt-3">
        <button type="button" onClick={onClose} aria-label="Close advisor" title="Close · Esc" className="grid size-10 place-items-center rounded-[16px] bg-ink/5 transition-colors hover:bg-ink/10 squircle">
          <X size={16} strokeWidth={1.8} aria-hidden />
        </button>
        <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ ADVISOR</span>
        {data.mode === 'live' ? <ContextChip /> : null}
      </div>
      {data.mode === 'demo' ? (
        <div className="p-4">
          <AvailableInOwnAccount compact what="The advisor reads your own results and routine, so it and your routine" />
        </div>
      ) : (
        <Chat seed={seed} />
      )}
    </div>
  )
}

/** "What the advisor can see": what api/app/advisor.py really puts in its context, and today's usage. */
function ContextChip() {
  const chat = useChat()
  const data = useData()
  const routine = useRoutine()
  const [open, setOpen] = useState(false)
  const latest = [...data.all].reverse().find(usable)
  const products = (routine.data ?? []).filter((e) => !e.ended_at).length
  const dots = ['var(--aura-coral)', 'var(--willow-400)', 'var(--aura-violet)']
  return (
    <div className="relative ml-auto" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-10 items-center gap-2.5 rounded-pill bg-surface/80 px-3.5 text-[13px] shadow-[0_10px_30px_-18px_rgba(0,0,0,.3)] backdrop-blur-[14px]">
        <span aria-hidden className="flex pl-[3px]">
          {dots.map((c) => (
            <span key={c} className="-ml-[3px] size-2.5 rounded-full shadow-[0_0_0_2px_var(--bg-surface)]" style={{ background: c }} />
          ))}
        </span>
        {chat.remaining !== null ? (
          <span className="flex items-baseline gap-1.5">
            <span className="font-dot text-[15px] font-extrabold">{chat.remaining}</span>
            <span className="text-ink-2">left</span>
          </span>
        ) : (
          <span className="text-ink-2">What it reads</span>
        )}
      </button>
      {open ? (
        <div className="absolute top-full right-0 mt-2 flex w-[260px] flex-col gap-3 rounded-[24px] bg-surface/95 p-4 shadow-[0_24px_50px_-20px_rgba(0,0,0,.35),inset_0_0_0_1px_rgba(18,18,18,.05)] backdrop-blur-[18px]" style={{ animation: 'wRise .25s both' }}>
          <span className="font-mono text-[10.5px] tracking-[.08em] text-ink-2">■ ANSWERS USE</span>
          <ContextRows dots={dots} latest={latest} products={products} />
          <span className="flex flex-col gap-1 border-t border-ink/[.07] pt-2.5 text-[13px] text-[#3E3C38]">
            {chat.remaining !== null ? `${chat.remaining} question${chat.remaining === 1 ? '' : 's'} left today` : 'A daily question limit applies; the count shows after your first answer.'}
            <span className="text-ink-2">Resets daily at {resetTime()} your time.</span>
          </span>
          <span className="text-[12px] leading-[1.45] text-ink-2">The advisor can’t diagnose and won’t quote a number Willow didn’t measure.</span>
        </div>
      ) : null}
    </div>
  )
}

function ContextRows({ dots, latest, products }: { dots: string[]; latest: Session | undefined; products: number }) {
  // Only fetched while the popover is open: the catalog size comes from the api, never a fixed number.
  const { status } = useDemoStatus()
  const rows = [
    latest ? `Your check-ins · latest ${fmtDate(latest.created_at)}` : 'Your check-ins · none measured yet',
    `Routine · ${products} product${products === 1 ? '' : 's'}`,
    status ? `Catalog · ${status.catalog.products} products` : 'Product catalog',
  ]
  return rows.map((label, i) => (
    <span key={label} className="flex items-center gap-2.5 text-[14px]">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: dots[i] }} />
      {label}
    </span>
  ))
}

/** Starter questions from the person's own data (no numbers in them), else plain generic ones. */
function useStarters(): string[] {
  const data = useData()
  const routine = useRoutine()
  const check = useRoutineCheck(routine.data)
  return useMemo(() => {
    const out: string[] = []
    const face = data.series('face_full')?.sessions.filter(usable).at(-1)
    if (face && !face.is_baseline) out.push(verdictCounts(face).changed > 0 ? `What changed in my ${fmtDate(face.created_at)} face check-in?` : `What does my ${fmtDate(face.created_at)} face check-in show?`)
    const findings = check.data && routine.data ? findingsOf(check.data, routine.data) : []
    const conflict = findings.find((f) => f.kind === 'Conflict')
    const gap = findings.find((f) => f.kind === 'Gap')
    if (conflict) out.push(conflict.question)
    if (gap) out.push(gap.question)
    if (!conflict && (routine.data ?? []).filter((e) => !e.ended_at).length >= 2) out.push('Is my routine OK together?')
    out.push('How should I take my next photos?')
    if (out.length < 3) out.push('What can you help me with?')
    return out.slice(0, 4)
  }, [data, routine.data, check.data])
}

function Chat({ seed }: { seed: AdvisorSeed | null }) {
  const chat = useChat()
  const shell = useShell()
  const navigate = useNavigate()
  const wide = useMediaQuery('(min-width: 900px)')
  const { getIdToken } = useAuth()
  const starters = useStarters()
  const scroller = useRef<HTMLDivElement>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const busy = chat.phase !== 'idle'
  const capped = chat.capMessage !== null
  const started = chat.messages.length > 0

  useEffect(() => setTokenSource(getIdToken), [getIdToken])
  // A question from elsewhere in the app (Routine, Results): asked once per seed.
  useEffect(() => {
    if (seed && takeSeed(seed)) ask(seed.text, seed.context)
  }, [seed])

  // Follow the conversation: new messages, and every dozen words while an answer appears.
  const last = chat.messages.at(-1)
  const progress = last?.role === 'willow' ? Math.floor(last.shown / 12) : 0
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [chat.messages.length, chat.phase, progress])

  const lastAnswer = [...chat.messages].reverse().find((m) => m.role === 'willow')
  const status = chat.phase === 'thinking' ? 'Thinking…' : chat.phase === 'revealing' ? 'Answering…' : 'Grounded in your results, routine and catalog'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pt-2">
      {started ? (
        <div className="flex items-center gap-2.5 py-1">
          <div className="relative h-[34px] w-7 flex-none">
            <Water small busy={busy} />
          </div>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-[15px]">Advisor</span>
            <span className="text-[12px] text-ink-2" aria-live="polite">
              {status}
            </span>
          </div>
          <button type="button" onClick={newChat} disabled={busy} className="min-h-9 rounded-pill border border-ink/12 bg-surface px-4 text-[13px]">
            New chat
          </button>
        </div>
      ) : null}

      <div
        ref={scroller}
        className={`no-scrollbar -mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-[3px] pt-1 pb-3 ${started ? 'justify-start' : 'justify-center'}`}
        style={{ maskImage: 'linear-gradient(180deg, transparent 0, #000 14px, #000 calc(100% - 18px), transparent 100%)' }}
      >
        {started ? null : (
          <div className="flex flex-col items-center gap-3 text-center" style={{ animation: 'wRise .5s both' }}>
            <div className="relative h-[min(29vw,110px,12vh)] w-[min(24vw,92px,10vh)]">
              <Water busy={false} />
            </div>
            <h2 className="font-serif text-[26px] leading-none font-normal">Ask about your results</h2>
            <p className="max-w-[440px] leading-[1.5] text-ink-2">Answers use your measured results, your routine and the product catalog. The advisor can’t diagnose, and it won’t quote a number Willow didn’t measure.</p>
          </div>
        )}
        <div aria-live="polite" className="flex flex-col gap-3">
          {chat.messages.map((m) =>
            m.role === 'user' ? (
              <UserBubble key={m.id} m={m} />
            ) : m.role === 'willow' ? (
              <Answer key={m.id} m={m} last={m === lastAnswer && m === last} busy={busy} capped={capped} onAsk={(q) => ask(q)} onProduct={setProduct} />
            ) : m.role === 'error' ? (
              <ErrorBubble key={m.id} m={m} busy={busy} />
            ) : (
              <p key={m.id} className="text-[12px] text-signal-ink">
                ■ {m.text}
              </p>
            ),
          )}
          {chat.phase === 'thinking' ? <Thinking since={chat.thinkingSince} /> : null}
          {capped ? (
            <div role="status" className="flex items-center gap-2.5 rounded-[18px] bg-cta px-3.5 py-3">
              <span className="font-dot text-[32px]">00</span>
              <span className="text-[13.5px] leading-[1.45]">
                {chat.capMessage} The advisor resets daily at {resetTime()} your time. Results, routine and the compatibility check still work.
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative z-[2] flex flex-none flex-col items-center gap-2.5 pt-1" style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}>
        {!started && !capped ? (
          <div className="flex flex-wrap justify-center gap-2">
            {starters.map((t, i) => (
              <button key={t} type="button" onClick={() => ask(t)} className="min-h-11 rounded-pill border border-ink/[.08] bg-surface/90 px-[18px] text-[13px] backdrop-blur-[12px] transition-transform hover:-translate-y-0.5" style={{ animation: `wRise .45s ${i * 70}ms both` }}>
                {t}
              </button>
            ))}
          </div>
        ) : null}
        <Composer busy={busy} thinking={chat.phase === 'thinking'} capped={capped} />
      </div>

      <ProductSheet
        target={product ? { product } : null}
        onClose={() => setProduct(null)}
        onAdd={(p) => {
          setProduct(null)
          navigate('/routine', { state: { addProduct: p } })
          // On a phone the panel covers the page: close it so the add sheet is seen.
          if (!wide) shell.closeAdvisor()
        }}
      />
    </div>
  )
}

function Thinking({ since }: { since: number | null }) {
  const [long, setLong] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setLong(true), Math.max(0, 30_000 - (Date.now() - (since ?? Date.now()))))
    return () => window.clearTimeout(t)
  }, [since])
  return (
    <div role="status" className="flex items-center gap-3" style={{ animation: 'wRise .3s both' }}>
      <AnswerOrb breathing />
      <div className="flex items-center gap-3 rounded-[8px_24px_24px_24px] bg-surface px-3 py-2.5">
        <span aria-hidden className="flex gap-1">
          {[0, 0.15, 0.3].map((d) => (
            <span key={d} className="size-[7px] rounded-full bg-sky" style={{ animation: `advBounce 1.1s ${d}s infinite` }} />
          ))}
        </span>
        <span className="text-[13px] text-[#3E3C38]">{long ? 'Still working. Some answers take up to a minute.' : 'Reading your results, routine and the catalog. This takes 10 to 30 seconds.'}</span>
      </div>
    </div>
  )
}

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void }
const SpeechRecognitionCtor = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function Composer({ busy, thinking, capped }: { busy: boolean; thinking: boolean; capped: boolean }) {
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const rec = useRef<Recognition | null>(null)
  const canDictate = useMemo(() => SpeechRecognitionCtor() !== null, [])
  const left = 1000 - draft.length

  const toggleMic = () => {
    if (listening) {
      rec.current?.stop()
      return
    }
    const Ctor = SpeechRecognitionCtor()
    if (!Ctor) return
    const r = new Ctor()
    r.lang = navigator.language || 'en-IN'
    r.interimResults = true
    r.onresult = (e) => setDraft(Array.from(e.results, (x) => x[0].transcript).join(' ').slice(0, 1000))
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    rec.current = r
    setListening(true)
    r.start()
  }

  const send = () => {
    if (!draft.trim() || busy || capped) return
    rec.current?.stop()
    ask(draft)
    setDraft('')
  }

  return (
    <div className="flex w-full max-w-[756px] flex-col gap-1">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="flex items-center gap-2 rounded-pill border border-white/90 bg-white/[.82] p-1.5 shadow-[0_20px_40px_-24px_rgba(0,0,0,.35)] backdrop-blur-[20px]"
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <input
          id="ask-input"
          type="text"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          readOnly={listening}
          disabled={capped}
          maxLength={1000}
          placeholder={listening ? 'Listening… speak your question' : capped ? `Daily limit reached · resets at ${resetTime()}` : thinking ? 'Waiting for the answer…' : 'Ask about a result, product or ingredient'}
          className="min-h-[46px] min-w-0 flex-1 bg-transparent px-[18px] text-[16px] outline-none sm:text-[14px]"
        />
        {canDictate ? (
          <button
            type="button"
            onClick={toggleMic}
            aria-pressed={listening}
            aria-label={listening ? 'Stop dictation' : 'Dictate'}
            title={listening ? 'Stop dictation' : 'Dictate'}
            disabled={capped}
            className="grid size-[38px] flex-none place-items-center rounded-full transition-colors"
            style={{ background: listening ? 'var(--aura-coral)' : 'var(--bg-sunken)', color: listening ? '#fff' : 'var(--text-primary)', boxShadow: listening ? '0 0 0 6px rgba(255,107,74,.25)' : 'none' }}
          >
            <span aria-hidden className="flex h-[18px] items-center gap-[2.5px]">
              {[8, 16, 11, 6].map((h, i) => (
                <span key={i} className="w-[3px] rounded-[3px] bg-current" style={{ height: h, animation: listening ? `advBar ${0.6 + (i % 3) * 0.15}s ease-in-out ${i * 0.08}s infinite` : undefined }} />
              ))}
            </span>
          </button>
        ) : null}
        {thinking ? (
          <button type="button" onClick={stopWaiting} aria-label="Stop waiting for this answer" title="Stop waiting (the question still counts)" className="grid size-[38px] flex-none place-items-center rounded-full bg-selected">
            <span aria-hidden className="size-3.5 rounded-[3px] bg-white" />
          </button>
        ) : (
          <button type="submit" aria-label="Send" disabled={!draft.trim() || busy || capped} className="grid size-[38px] flex-none place-items-center rounded-full text-inverse transition-transform active:scale-[.92]" style={{ background: 'radial-gradient(circle at 35% 30%, var(--aura-ice), var(--aura-sky) 50%, #1B1F7A)' }}>
            <ArrowUp size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
      </form>
      {left < 100 ? <span className="px-4 text-right text-[11px] text-ink-2">{left} characters left</span> : null}
    </div>
  )
}
