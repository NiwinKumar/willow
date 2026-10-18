import { ArrowDown, ArrowUp, Check, Maximize2, Minimize2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useShell, type AdvisorSeed } from '../../components/shell/ShellContext'
import { useRoutine, useRoutineCheck } from '../../data/hooks'
import type { MetricId, Product, Session } from '../../data/types'
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
import { ask, newChat, regenerate, setTokenSource, stopWaiting, takeSeed, useChat, type Attachment } from './chatStore'
import { Answer, ErrorBubble, StandardCard, UserBubble, type AnswerActions } from './Messages'
import { useComposing, WispMark, wispState } from './Wisp'

const usable = (s: Session) => s.status === 'done' && s.measured !== false && Boolean(s.result?.quality.passed)

/** The api counts questions per UTC day: the local time that day ends, e.g. "05:30" (the api's resets_at when known). */
function resetTime(resetsAt?: string): string {
  const d = new Date()
  const at = resetsAt ? new Date(resetsAt) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
  return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/**
 * The advisor (design: Willow App Routine, view="advisor"), drawn inside the shell's glass panel: header
 * (close, expand, what it reads), the one chat, and the composer. Gemini answers from the person's
 * own sessions, routine and the catalog (api/app/advisor.py); every number is checked there.
 */
export default function AdvisorPanel({ seed, onClose, full = false, onToggleFull }: { seed: AdvisorSeed | null; onClose: () => void; full?: boolean; onToggleFull?: () => void }) {
  const data = useData()
  const phone = useMediaQuery('(max-width: 639px)')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`relative z-[3] flex min-h-[52px] flex-none items-center gap-2.5 px-3.5 pt-3 ${full ? 'mx-auto w-full max-w-[960px]' : ''}`}>
        <button type="button" onClick={onClose} aria-label="Close Wisp" title="Close · Esc" className="hit44 grid size-10 place-items-center rounded-[16px] bg-ink/5 transition-colors hover:bg-ink/10 squircle">
          <X size={16} strokeWidth={1.8} aria-hidden />
        </button>
        {onToggleFull && !phone ? (
          <button type="button" onClick={onToggleFull} aria-pressed={full} title={full ? 'Collapse to the side panel · Esc' : 'Expand to full screen'} className="hit44 inline-flex min-h-10 items-center gap-1.5 rounded-[16px] bg-ink/5 px-3 text-[12.5px] transition-colors hover:bg-ink/10 squircle">
            {full ? <Minimize2 size={14} strokeWidth={1.8} aria-hidden /> : <Maximize2 size={14} strokeWidth={1.8} aria-hidden />}
            {full ? 'Collapse' : 'Expand'}
          </button>
        ) : null}
        {data.mode === 'live' ? <ContextChip /> : null}
      </div>
      {data.mode === 'demo' ? (
        <div className="p-4">
          <AvailableInOwnAccount compact what="Wisp reads your own results and routine, so it and your routine" />
        </div>
      ) : (
        <Chat seed={seed} full={full} onExitFull={full ? onToggleFull : undefined} />
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
          <span className="text-[12px] leading-[1.45] text-ink-2">Wisp can’t diagnose and won’t quote a number Willow didn’t measure.</span>
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

function Chat({ seed, full, onExitFull }: { seed: AdvisorSeed | null; full: boolean; onExitFull?: () => void }) {
  const chat = useChat()
  const shell = useShell()
  const data = useData()
  const navigate = useNavigate()
  const wide = useMediaQuery('(min-width: 900px)')
  const { getIdToken, user } = useAuth()
  const uid = user?.uid ?? null
  const starters = useStarters()
  const scroller = useRef<HTMLDivElement>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [atEnd, setAtEnd] = useState(true)
  const lastTop = useRef(0)
  const busy = chat.phase !== 'idle'
  const capped = chat.capMessage !== null
  const started = chat.messages.length > 0

  // Another person on this tab (Google switch, sign-out then sign-in) never sees the last one's chat.
  useEffect(() => setTokenSource(getIdToken, uid), [getIdToken, uid])
  // A question from elsewhere in the app (Routine, Results): asked once per seed.
  useEffect(() => {
    if (seed && takeSeed(seed)) ask(seed.text, seed.context)
  }, [seed])

  // Follow the conversation while the person is at the latest message; scrolled up, they keep their place
  // and a "Latest" button appears.
  const last = chat.messages.at(-1)
  const progress = last?.role === 'willow' ? last.shown : 0
  const toEnd = (smooth = true) => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' })
  }
  useEffect(() => {
    if (atEnd) toEnd()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow new content only
  }, [chat.messages.length, chat.phase, progress, chat.stages.length])
  // Content that grows after it is drawn (packshots, widgets, a history loaded while closed) keeps the
  // person at the end when they were there.
  const atEndRef = useRef(atEnd)
  atEndRef.current = atEnd
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (atEndRef.current) el.scrollTop = el.scrollHeight
    })
    for (const c of Array.from(el.children)) ro.observe(c)
    return () => ro.disconnect()
  }, [chat.messages.length, started])
  // a new question always brings the conversation to the end
  useEffect(() => {
    if (last?.role === 'user') {
      setAtEnd(true)
      toEnd()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a question is added
  }, [last?.id])

  // Leaving the panel for a full screen: on a phone (or from full screen) the page must be seen.
  const go = (path: string) => {
    navigate(path)
    if (full) onExitFull?.()
    else if (!wide) shell.closeAdvisor()
  }
  const onAdd = (p: Product) => {
    setProduct(null)
    navigate('/routine', { state: { addProduct: p } })
    if (full) onExitFull?.()
    else if (!wide) shell.closeAdvisor()
  }
  const onMetric = (id: MetricId) => {
    const s = [...data.all].reverse().find((x) => usable(x) && x.result?.metrics.some((m) => m.id === id))
    go(s ? `/result/${s.id}?metric=${id}` : `/progress?metric=${id}`)
  }
  const actions: AnswerActions = { onAsk: (q) => ask(q), onProduct: setProduct, onAdd, onMetric, go, onRegenerate: regenerate }

  const lastAnswer = [...chat.messages].reverse().find((m) => m.role === 'willow')
  const status = chat.phase === 'thinking' ? 'Working on it…' : chat.phase === 'revealing' ? 'Answering…' : chat.aiDown ? 'AI unavailable · standard explanations' : 'Grounded in your results, routine and catalog'
  const column = full ? 'mx-auto w-full max-w-[760px]' : 'w-full'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pt-2">
      {started ? (
        <div className={`flex items-center gap-2.5 py-1 ${column}`}>
          <span className="flex-none">
            <WispMark size={40} state={wispState(chat.phase)} />
          </span>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-[15px]">Wisp</span>
            <span className="text-[12px] text-ink-2" aria-live="polite">
              {status}
            </span>
          </div>
          <button type="button" onClick={newChat} disabled={busy} className="hit44 min-h-9 rounded-pill border border-ink/12 bg-surface px-4 text-[13px]">
            New chat
          </button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={(e) => {
            // Only the person scrolling up leaves the end (content growing or a smooth follow never does).
            const el = e.currentTarget
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48
            if (near) setAtEnd(true)
            else if (el.scrollTop < lastTop.current - 2) setAtEnd(false)
            lastTop.current = el.scrollTop
          }}
          className={`no-scrollbar -mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-[3px] pt-1 pb-3 ${started ? 'justify-start' : 'justify-center'}`}
          style={{ maskImage: 'linear-gradient(180deg, transparent 0, #000 14px, #000 calc(100% - 18px), transparent 100%)' }}
        >
          {started ? null : (
            <div className="flex flex-col items-center gap-3 text-center" style={{ animation: 'wRise .5s both' }}>
              <EmptyWisp />
              <h2 className="font-serif text-[26px] leading-none font-normal">Ask about your results</h2>
              <p className="max-w-[440px] leading-[1.5] text-ink-2">Answers use your measured results, your routine and the product catalog. Wisp can’t diagnose, and won’t quote a number Willow didn’t measure.</p>
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
          <div aria-live="polite" className={`flex flex-col gap-3 ${column}`}>
            {chat.messages.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} m={m} />
              ) : m.role === 'willow' ? (
                <Answer key={m.id} m={m} last={m === lastAnswer && m === last} busy={busy} capped={capped} actions={actions} />
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
            {chat.phase === 'thinking' ? <Thinking stages={chat.stages} /> : null}
            {capped ? (
              <div role="status" className="flex items-center gap-2.5 rounded-[18px] bg-cta px-3.5 py-3">
                <span className="font-dot text-[32px]">{chat.usage ? String(chat.usage.cap).padStart(2, '0') : '00'}</span>
                <span className="text-[13.5px] leading-[1.45]">
                  {chat.capMessage} Wisp resets daily at {resetTime(chat.usage?.resets_at)} your time. Results, routine and the compatibility check still work.
                </span>
              </div>
            ) : null}
          </div>
        </div>
        {!atEnd && started ? (
          // Centred by the wrapper, not a translate: the rise animation owns `translate` and would undo it.
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <button
              type="button"
              onClick={() => {
                setAtEnd(true)
                toEnd()
              }}
              className="pointer-events-auto inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-selected px-3.5 text-[12.5px] text-inverse shadow-[0_12px_30px_-12px_rgba(0,0,0,.45)]"
              style={{ animation: 'wRise .25s both' }}
            >
              <ArrowDown size={13} strokeWidth={2} aria-hidden /> Latest
            </button>
          </div>
        ) : null}
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

      <ProductSheet target={product ? { product } : null} onClose={() => setProduct(null)} onAdd={onAdd} />
    </div>
  )
}

/** A live step in plain words, from the api's events (POST /v1/advisor/chat/stream). Never on a timer. */
function stepWords(s: AdvisorStage): string {
  if (s.event === 'reading_context') return 'Reading your check-ins'
  if (s.event === 'checking_numbers') return 'Checking the numbers'
  if (s.step === 'tools') return s.photos ? `Reading your photo${s.photos === 1 ? '' : 's'}` : 'Thinking it through'
  if (s.step === 'tool') return s.tool === 'check_routine' ? 'Checking your routine' : 'Looking at the catalog'
  return 'Writing the answer'
}

function Thinking({ stages }: { stages: AdvisorStage[] }) {
  // consecutive repeats collapse (two catalog searches are one step)
  const steps = stages.map(stepWords).filter((w, i, a) => w !== a[i - 1])
  const now = steps.at(-1) ?? 'Reading your check-ins'
  const done = steps.slice(0, -1)
  return (
    <div role="status" className="flex items-start gap-3" style={{ animation: 'wRise .3s both' }}>
      <WispMark size={34} state="thinking" />
      <div className="flex min-w-[220px] flex-col gap-1.5 rounded-[8px_24px_24px_24px] bg-surface px-3.5 py-3">
        {done.map((w) => (
          <span key={w} className="flex items-center gap-2 text-[12.5px] text-ink-2" style={{ animation: 'advIn .35s both' }}>
            <Check size={13} strokeWidth={2} className="text-willow-700" aria-hidden />
            {w}
          </span>
        ))}
        <span key={now} className="flex items-center gap-2.5" style={{ animation: 'advIn .35s both' }}>
          <span aria-hidden className="flex gap-1">
            {[0, 0.15, 0.3].map((d) => (
              <span key={d} className="size-[6px] rounded-full bg-sky" style={{ animation: `advBounce 1.1s ${d}s infinite` }} />
            ))}
          </span>
          <span className="advSheenText text-[13.5px]">{now}</span>
        </span>
      </div>
    </div>
  )
}

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void }
const SpeechRecognitionCtor = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Which model answers: a small sparkle mark (drawn here, not the trademarked logo file), named for screen
 * readers. One model, so no picker.
 */
function GeminiMark() {
  return (
    <span role="img" aria-label="Gemini" title="Answers are written by Gemini and checked by Willow" className="mb-[13px] flex-none text-sky">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
        <defs>
          <linearGradient id="gemini-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--aura-sky)" />
            <stop offset="1" stopColor="var(--aura-violet, #8B6CFF)" />
          </linearGradient>
        </defs>
        <path d="M12 2c.5 4.9 3.1 7.5 10 10-6.9 2.5-9.5 5.1-10 10-.5-4.9-3.1-7.5-10-10 6.9-2.5 9.5-5.1 10-10Z" fill="url(#gemini-mark)" />
      </svg>
    </span>
  )
}

const MAX_B64 = 8_000_000 // api ChatImage.data_base64 max_length
const MAX_PHOTOS = 3
const MAX_FILE = 15e6 // the design's limit for the original file (it is downscaled before sending)

/** A product or label photo, downscaled to JPEG on this device (HEIC opens on Safari). Never a skin capture. */
async function toAttachment(file: File): Promise<Attachment> {
  let img = await toJpegBase64(file)
  if (img.data_base64.length > MAX_B64) img = await toJpegBase64(file, 1100, 0.75)
  if (img.data_base64.length > MAX_B64) throw new Error('This photo is too large to send.')
  return { ...img, name: file.name || 'photo.jpg', meta: `${file.size < 1e6 ? `${Math.max(1, Math.round(file.size / 1e3))} KB` : `${(file.size / 1e6).toFixed(1)} MB`} · photo`, thumb: URL.createObjectURL(file) }
}

function Composer({ busy, thinking, capped }: { busy: boolean; thinking: boolean; capped: boolean }) {
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const [attach, setAttach] = useState<Attachment[]>([])
  const [reading, setReading] = useState(false)
  const rec = useRef<Recognition | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  // grow with the question, up to about seven lines (then it scrolls)
  useEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    // empty: one line (a long placeholder must not grow it)
    el.style.height = draft ? `${Math.min(el.scrollHeight, 160)}px` : '46px'
  }, [draft])

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
        className="flex items-end gap-2 rounded-[28px] border border-white/90 bg-white/[.82] p-1.5 shadow-[0_20px_40px_-24px_rgba(0,0,0,.35)] backdrop-blur-[20px]"
      >
        <label title="Attach a photo of a product or its label (product photos only)" className="hit44 relative mb-2 ml-1 grid size-[30px] flex-none cursor-pointer place-items-center rounded-full bg-sunken text-[15px] transition-colors hover:bg-ink/10 has-[input:disabled]:cursor-default has-[input:disabled]:opacity-50">
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
        <textarea
          ref={field}
          id="ask-input"
          rows={1}
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter starts a new line (an IME composing text keeps its Enter)
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          readOnly={listening}
          disabled={capped}
          maxLength={1000}
          aria-describedby="ask-keys"
          placeholder={listening ? 'Listening… speak your question' : capped ? `Daily limit reached · resets at ${resetTime()}` : thinking ? 'Waiting for the answer…' : 'Ask about a result, product or ingredient'}
          className="max-h-[160px] min-h-[46px] min-w-0 flex-1 resize-none bg-transparent px-2 py-[13px] text-[16px] leading-[20px] outline-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap sm:text-[14px]"
        />
        <span id="ask-keys" className="sr-only">
          Enter sends, Shift and Enter starts a new line.
        </span>
        <GeminiMark />
        {canDictate ? (
          <button
            type="button"
            onClick={toggleMic}
            aria-pressed={listening}
            aria-label={listening ? 'Stop dictation' : 'Dictate'}
            title={listening ? 'Stop dictation' : 'Dictate'}
            disabled={capped}
            className="hit44 mb-1 grid size-[38px] flex-none place-items-center rounded-full transition-colors"
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
          <button type="button" onClick={stopWaiting} aria-label="Stop waiting for this answer" title="Stop waiting (the question still counts)" className="hit44 mb-1 grid size-[38px] flex-none place-items-center rounded-full bg-selected">
            <span aria-hidden className="size-3.5 rounded-[3px] bg-white" />
          </button>
        ) : (
          <button type="submit" aria-label="Send" disabled={(!draft.trim() && !attach.length) || busy || capped || reading}className="hit44 mb-1 grid size-[38px] flex-none place-items-center rounded-full text-inverse transition-transform active:scale-[.92]" style={{ background: 'radial-gradient(circle at 35% 30%, var(--aura-ice), var(--aura-sky) 50%, #1B1F7A)' }}>
            <ArrowUp size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
      </form>
      {left < 100 ? <span className="px-4 text-right text-[11px] text-ink-2">{left} characters left</span> : null}
    </div>
  )
}

/** Wisp on the empty chat: idle, and listening while the person writes a question. */
function EmptyWisp() {
  const composing = useComposing()
  return <WispMark size={112} state={composing ? 'listening' : 'idle'} />
}
