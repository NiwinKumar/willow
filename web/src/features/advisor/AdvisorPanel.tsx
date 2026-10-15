import { ArrowUp, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useShell, type AdvisorSeed } from '../../components/shell/ShellContext'
import { useRoutine, useRoutineCheck } from '../../data/hooks'
import type { Product, Session } from '../../data/types'
import { useData } from '../../data/useData'
import { fmtDate } from '../../lib/format'
import { useAuth } from '../../lib/useAuth'
import { useDemoStatus } from '../../lib/useDemoStatus'
import type { AdvisorStage } from '../../lib/api'
import { toJpegBase64 } from '../../lib/image'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { verdictCounts } from '../../lib/verdict'
import { AvailableInOwnAccount } from '../routine/OwnAccountNotice'
import { ProductSheet } from '../routine/ProductSheet'
import { findingsOf } from '../routine/routineModel'
import './advisor.css'
import { ask, newChat, setTokenSource, stopWaiting, takeSeed, useChat, type Attachment } from './chatStore'
import { Answer, ErrorBubble, StandardCard, UserBubble } from './Messages'
import { AnswerOrb, Water } from './Water'

const usable = (s: Session) => s.status === 'done' && s.measured !== false && Boolean(s.result?.quality.passed)

/** The api counts questions per UTC day: the local time that day ends, e.g. "05:30" (the api's resets_at when known). */
function resetTime(resetsAt?: string): string {
  const d = new Date()
  const at = resetsAt ? new Date(resetsAt) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
  return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
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
        <button type="button" onClick={onClose} aria-label="Close advisor" title="Close · Esc" className="hit44 grid size-10 place-items-center rounded-[16px] bg-ink/5 transition-colors hover:bg-ink/10 squircle">
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
    <div
      className="relative ml-auto"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
      onKeyDown={(e) => {
        // Esc closes this popover first (not the whole advisor panel behind it).
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      {/* Hover opens it for a mouse; a tap (which also fires enter) or a key toggles it. */}
      <button type="button" onClick={(e) => setOpen((o) => ((e.nativeEvent as PointerEvent).pointerType === 'mouse' ? true : !o))} aria-expanded={open} className="hit44 flex min-h-10 items-center gap-2.5 rounded-pill bg-surface/80 px-3.5 text-[13px] shadow-[0_10px_30px_-18px_rgba(0,0,0,.3)] backdrop-blur-[14px]">
        <span aria-hidden className="flex pl-[3px]">
          {dots.map((c) => (
            <span key={c} className="-ml-[3px] size-2.5 rounded-full shadow-[0_0_0_2px_var(--bg-surface)]" style={{ background: c }} />
          ))}
        </span>
        {chat.aiDown ? (
          <span className="flex items-baseline gap-1.5">
            <span className="font-dot text-[15px] font-extrabold">—</span>
            <span className="text-ink-2">AI off</span>
          </span>
        ) : chat.remaining !== null ? (
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
            <UsageDots />
            {chat.aiDown ? 'AI off right now · standard explanations' : chat.remaining !== null ? `${chat.remaining} question${chat.remaining === 1 ? '' : 's'} left today` : 'A daily question limit applies.'}
            <span className="text-ink-2">Resets daily at {resetTime(chat.usage?.resets_at)} your time.</span>
          </span>
          <span className="text-[12px] leading-[1.45] text-ink-2">The advisor can’t diagnose and won’t quote a number Willow didn’t measure.</span>
        </div>
      ) : null}
    </div>
  )
}

/** One dot per question in today's cap (GET /v1/me/usage): used ones grey, the ones left blue. The text beside it says the count. */
function UsageDots() {
  const { usage, remaining } = useChat()
  if (!usage) return null
  const left = remaining ?? usage.remaining
  return (
    <span aria-hidden className="mb-1 flex flex-wrap gap-[3px]">
      {Array.from({ length: usage.cap }, (_, i) => (
        <span key={i} className="size-1.5 rounded-full" style={{ background: i < usage.cap - left ? 'var(--signal-noise)' : 'var(--aura-sky)' }} />
      ))}
    </span>
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
  const { getIdToken, user } = useAuth()
  const uid = user?.uid ?? null
  const starters = useStarters()
  const scroller = useRef<HTMLDivElement>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const busy = chat.phase !== 'idle'
  const capped = chat.capMessage !== null
  const started = chat.messages.length > 0

  // Another person on this tab (Google switch, sign-out then sign-in) never sees the last one's chat.
  useEffect(() => setTokenSource(getIdToken, uid), [getIdToken, uid])
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
  const status = chat.phase === 'thinking' ? 'Thinking…' : chat.phase === 'revealing' ? 'Answering…' : chat.aiDown ? 'AI unavailable · standard explanations' : 'Grounded in your results, routine and catalog'

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
          <button type="button" onClick={newChat} disabled={busy} className="hit44 min-h-9 rounded-pill border border-ink/12 bg-surface px-4 text-[13px]">
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
            {chat.history === 'loading' ? (
              <span role="status" className="text-[12px] text-ink-2">
                Loading your earlier conversation…
              </span>
            ) : chat.history === 'error' ? (
              <span role="status" className="text-[12px] text-ink-2">
                Your earlier conversation couldn’t be loaded just now.
              </span>
            ) : null}
          </div>
        )}
        <div aria-live="polite" className="flex flex-col gap-3">
          {chat.messages.map((m) =>
            m.role === 'user' ? (
              <UserBubble key={m.id} m={m} />
            ) : m.role === 'willow' ? (
              <Answer key={m.id} m={m} last={m === lastAnswer && m === last} busy={busy} capped={capped} onAsk={ask} onProduct={setProduct} />
            ) : m.role === 'error' ? (
              <ErrorBubble key={m.id} m={m} busy={busy} />
            ) : m.role === 'standard' ? (
              <StandardCard key={m.id} m={m} busy={busy || capped} />
            ) : (
              <p key={m.id} className="text-[12px] text-ink-2">
                ■ {m.text}
              </p>
            ),
          )}
          {chat.phase === 'thinking' ? <Thinking since={chat.thinkingSince} stages={chat.stages} /> : null}
          {capped ? (
            <div role="status" className="flex items-center gap-2.5 rounded-[18px] bg-cta px-3.5 py-3">
              <span className="font-dot text-[32px]">{chat.usage ? String(chat.usage.cap).padStart(2, '0') : '00'}</span>
              <span className="text-[13.5px] leading-[1.45]">
                {chat.capMessage} The advisor resets daily at {resetTime(chat.usage?.resets_at)} your time. Results, routine and the compatibility check still work.
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

/** The api's real steps (POST /v1/advisor/chat/stream), in order. Never advanced on a timer. */
const STEPS = ['Reading your results and routine', 'Asking Gemini', 'Writing an answer', 'Checking every number'] as const

function stepOf(stages: AdvisorStage[]): number {
  const last = stages.at(-1)
  if (!last) return -1
  if (last.event === 'reading_context') return 0
  if (last.event === 'asking_gemini') return last.step === 'tools' ? 1 : 2
  return 3
}

function Thinking({ since, stages }: { since: number | null; stages: AdvisorStage[] }) {
  const [long, setLong] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setLong(true), Math.max(0, 30_000 - (Date.now() - (since ?? Date.now()))))
    return () => window.clearTimeout(t)
  }, [since])
  const step = stepOf(stages)
  const photos = stages.find((s): s is Extract<AdvisorStage, { step: 'tools' }> => s.event === 'asking_gemini' && s.step === 'tools')?.photos ?? 0
  const found = stages.find((s): s is Extract<AdvisorStage, { step: 'reply' }> => s.event === 'asking_gemini' && s.step === 'reply')?.retrieval ?? []
  const label =
    step < 0
      ? 'Reading your results, routine and the catalog. This takes 10 to 30 seconds.'
      : step === 1 && photos
        ? `Asking Gemini to read your ${photos === 1 ? 'photo' : `${photos} photos`} and search the catalog…`
        : step === 1
          ? 'Asking Gemini, which may search the catalog and check your routine…'
          : `${STEPS[step]}…`
  return (
    <div role="status" className="flex items-start gap-3" style={{ animation: 'wRise .3s both' }}>
      <AnswerOrb breathing />
      <div className="flex flex-col gap-2 rounded-[8px_24px_24px_24px] bg-surface px-3 py-2.5">
        <span className="flex items-center gap-3">
          <span aria-hidden className="flex gap-1">
            {[0, 0.15, 0.3].map((d) => (
              <span key={d} className="size-[7px] rounded-full bg-sky" style={{ animation: `advBounce 1.1s ${d}s infinite` }} />
            ))}
          </span>
          <span className="text-[13px] text-[#3E3C38]">{long ? 'Still working. Some answers take up to a minute.' : label}</span>
        </span>
        {step >= 0 ? (
          <ol aria-label="Steps" className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 font-mono text-[10.5px] tracking-[.04em]">
            {STEPS.map((s, i) => (
              <li key={s} className={i <= step ? 'text-ink' : 'text-ink-2'}>
                <span aria-hidden>{i < step ? '✓' : i === step ? '◌' : '○'} </span>
                {s}
                <span className="sr-only">{i < step ? ' (done)' : i === step ? ' (now)' : ''}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {found.length ? (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px] text-ink-2">
            {found.map((x) => (
              <li key={x}>✓ {x}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void }
const SpeechRecognitionCtor = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const MAX_B64 = 8_000_000 // api ChatImage.data_base64 max_length
const MAX_PHOTOS = 3
const MAX_FILE = 15e6 // the design's limit for the original file (it is downscaled before sending)

/** A product or label photo, downscaled to JPEG on this device (HEIC opens on Safari). Never a skin capture. */
async function toAttachment(file: File): Promise<Attachment> {
  let img = await toJpegBase64(file)
  if (img.data_base64.length > MAX_B64) img = await toJpegBase64(file, 1100, 0.75)
  if (img.data_base64.length > MAX_B64) throw new Error('This photo is too large to send.')
  return { ...img, name: file.name || 'photo.jpg', meta: `${(file.size / 1e6).toFixed(1)} MB · photo`, thumb: URL.createObjectURL(file) }
}

function Composer({ busy, thinking, capped }: { busy: boolean; thinking: boolean; capped: boolean }) {
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const [attach, setAttach] = useState<Attachment[]>([])
  const [reading, setReading] = useState(false)
  const rec = useRef<Recognition | null>(null)

  const addFiles = async (files: File[]) => {
    const photos = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (photos.length < files.length) toast('Only photos can be attached')
    const fit = photos.filter((f) => f.size <= MAX_FILE)
    if (fit.length < photos.length) toast('Photos over 15 MB can’t be attached')
    const room = MAX_PHOTOS - attach.length
    if (fit.length > room) toast(`Up to ${MAX_PHOTOS} photos per question`)
    if (room <= 0 || !fit.length) return
    setReading(true)
    const added: Attachment[] = []
    for (const f of fit.slice(0, room)) {
      try {
        added.push(await toAttachment(f))
      } catch (e) {
        toast(e instanceof Error ? e.message : 'This photo could not be opened.')
      }
    }
    setReading(false)
    setAttach((a) => [...a, ...added].slice(0, MAX_PHOTOS))
  }
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
    if ((!draft.trim() && !attach.length) || busy || capped || reading) return
    rec.current?.stop()
    ask(draft, undefined, attach)
    setDraft('')
    setAttach([])
  }

  return (
    <div className="flex w-full max-w-[756px] flex-col gap-1">
      {attach.length || reading ? (
        <div className="flex flex-col gap-1.5 px-1.5">
          <div className="flex flex-wrap gap-2">
            {attach.map((a, i) => (
              <span key={a.thumb} className="flex items-center gap-2.5 rounded-[20px] bg-white/90 p-1.5 shadow-[0_10px_24px_-14px_rgba(0,0,0,.35)]" style={{ animation: 'wRise .3s both' }}>
                <img src={a.thumb} alt="" className="size-11 rounded-[14px] object-cover" />
                <span className="flex max-w-[160px] flex-col gap-px">
                  <span className="truncate text-[12px]">{a.name}</span>
                  <span className="font-mono text-[10px] text-ink-2">{a.meta}</span>
                </span>
                <button type="button" onClick={() => setAttach((xs) => xs.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`} className="hit44 grid size-8 place-items-center rounded-full bg-sunken text-[12px]">
                  <X size={12} strokeWidth={2} aria-hidden />
                </button>
              </span>
            ))}
            {reading ? <span className="self-center text-[12px] text-ink-2">Preparing the photo…</span> : null}
          </div>
          <span className="text-[11.5px] text-ink-2">Product and label photos only, never faces or skin. They are sent with this question and not kept.</span>
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="flex items-center gap-2 rounded-pill border border-white/90 bg-white/[.82] p-1.5 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus shadow-[0_20px_40px_-24px_rgba(0,0,0,.35)] backdrop-blur-[20px]"
      >
        <label title="Attach a photo of a product or its label (product photos only)" className="hit44 relative ml-1 grid size-[30px] flex-none cursor-pointer place-items-center rounded-full bg-sunken text-[15px] transition-colors hover:bg-ink/10 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-focus has-[input:disabled]:cursor-default has-[input:disabled]:opacity-50">
          <input
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            aria-label="Attach a product photo (up to 3; product photos only)"
            disabled={capped || attach.length >= MAX_PHOTOS || reading}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              void addFiles(files)
            }}
            className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
          />
          <span aria-hidden>+</span>
        </label>
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
            className="hit44 grid size-[38px] flex-none place-items-center rounded-full transition-colors"
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
          <button type="button" onClick={stopWaiting} aria-label="Stop waiting for this answer" title="Stop waiting (the question still counts)" className="hit44 grid size-[38px] flex-none place-items-center rounded-full bg-selected">
            <span aria-hidden className="size-3.5 rounded-[3px] bg-white" />
          </button>
        ) : (
          <button type="submit" aria-label="Send" disabled={(!draft.trim() && !attach.length) || busy || capped || reading}className="hit44 grid size-[38px] flex-none place-items-center rounded-full text-inverse transition-transform active:scale-[.92]" style={{ background: 'radial-gradient(circle at 35% 30%, var(--aura-ice), var(--aura-sky) 50%, #1B1F7A)' }}>
            <ArrowUp size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
      </form>
      {left < 100 ? <span className="px-4 text-right text-[11px] text-ink-2">{left} characters left</span> : null}
    </div>
  )
}
