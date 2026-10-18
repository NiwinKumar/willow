import { ArrowUp, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ApiError, api, type RetailerAnswer } from '../../lib/api'
import { useAuth } from '../../lib/useAuth'
import { useMediaQuery } from '../../lib/useMediaQuery'
import type { Filters, Insights } from './types'
import { cohortKind, MIN_GROUP } from './ui'

/** Starters: each one is answerable from the aggregates (the last is refused: no individuals). */
const SUGGESTIONS = ['Which redness products work in the budget tier?', 'Where is demand growing fastest?', 'How do outcomes compare with non-users?', 'Which products do people say are working, and is it measured?', 'Which users changed the most?']

/** The api checks 3 to 300 characters (retailer_routes.py AskRequest); the form does too, so no 422. */
const MIN_Q = 3
const MAX_Q = 300

type Turn = { id: number; q: string; reply?: RetailerAnswer; error?: { title: string; message: string } }

const UNIT: Record<NonNullable<RetailerAnswer['chart']>['unit'], (v: number) => string> = {
  percent: (v) => `${v < 0 ? '−' : ''}${Math.abs(v)}%`,
  count: (v) => String(v),
  weeks: (v) => `${v} wk`,
}

function errorOf(e: unknown): Turn['error'] {
  if (e instanceof ApiError) {
    if (e.status === 429) return { title: e.code === 'busy' ? 'Busy today' : 'Daily limit reached', message: e.message }
    if (e.status === 401 || e.status === 403) return { title: 'Not signed in', message: 'Asking needs a guest sign-in, which did not work. Reload the page and try again.' }
    if (e.status === 503) return { title: 'Service unavailable', message: `${e.message} The dashboard is unaffected.` }
    return { title: 'No answer', message: e.message || 'Could not get an answer. Try again.' }
  }
  return { title: 'No answer', message: 'Could not reach Willow. Check the connection and try again.' }
}

/**
 * "Ask the aggregates", inside the Ask side panel: Gemini answers from the same aggregates and filters as the
 * screen, and the api checks every number against them (GEMINI_SPEC section 6). Guest sign-in on first ask.
 */
export function AskAggregates({ d, filters }: { d: Insights | null; filters: Filters }) {
  const { user, continueAsGuest, getIdToken } = useAuth()
  const [thread, setThread] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  // Only the newest answer reveals word by word; it finishes before follow-ups appear.
  const [revealing, setRevealing] = useState<number | null>(null)
  const nextId = useRef(0)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!busy) return
    // Two Gemini attempts can take up to about a minute; say so instead of a fake progress label.
    const t = window.setTimeout(() => setSlow(true), 12_000)
    return () => {
      window.clearTimeout(t)
      setSlow(false)
    }
  }, [busy])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [thread.length, busy])

  const ask = async (text: string) => {
    const q = text.trim()
    if (q.length < MIN_Q || busy || revealing !== null || !d) return
    const id = nextId.current++
    setThread((t) => [...t, { id, q }])
    setDraft('')
    setBusy(true)
    try {
      if (!user) await continueAsGuest()
      const reply = await api.retailerAsk(await getIdToken(), q, filters)
      setThread((t) => t.map((m) => (m.id === id ? { ...m, reply } : m)))
      setRevealing(id)
    } catch (e) {
      setThread((t) => t.map((m) => (m.id === id ? { ...m, error: errorOf(e) } : m)))
    } finally {
      setBusy(false)
    }
  }

  const last = thread.at(-1)
  const canSend = draft.trim().length >= MIN_Q && !busy && revealing === null && Boolean(d)
  return (
    <div className="flex h-full flex-col gap-4">
      <p className="m-0 text-proof-body text-ink-2">
        Gemini answers from the aggregates on screen only (same filters), with suppression applied. Any number it writes that is not in them is rejected. Individual people can’t be looked up.
      </p>

      <div aria-live="polite" className="flex flex-col gap-4">
        {thread.map((m) => (
          <div key={m.id} className="flex flex-col gap-3">
            <div className="max-w-[88%] self-end rounded-[14px_14px_4px_14px] bg-selected px-3.5 py-2 text-proof-body text-inverse">{m.q}</div>
            {m.reply && d ? (
              <Answer d={d} reply={m.reply} reveal={revealing === m.id} onRevealed={() => setRevealing((r) => (r === m.id ? null : r))} followUps={m === last} onAsk={ask} disabled={busy || revealing !== null} />
            ) : m.error ? (
              <div role="alert" className="flex flex-col gap-1 rounded-card border border-line bg-pf-bg2 p-3.5">
                <span className="text-proof-small font-medium text-ink">{m.error.title} · no numbers returned</span>
                <span className="text-proof-body text-ink-2">{m.error.message}</span>
              </div>
            ) : null}
          </div>
        ))}
        {busy ? (
          <div role="status" className="flex items-center gap-2.5 self-start rounded-pill bg-sunken px-3.5 py-2">
            <span aria-hidden className="flex gap-1">
              {[0, 0.15, 0.3].map((delay) => (
                <span key={delay} className="size-1.5 rounded-full bg-ink-2 animate-[wBounce_1.1s_infinite]" style={{ animationDelay: `${delay}s` }} />
              ))}
            </span>
            <span className="text-proof-small text-ink-2">{slow ? 'Still reading: an answer can take up to a minute.' : 'Reading the aggregates…'}</span>
          </div>
        ) : null}
        <div ref={end} />
      </div>

      {thread.length === 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-proof-small font-medium text-ink-2">Try asking</span>
          {SUGGESTIONS.map((t) => (
            <button key={t} type="button" disabled={!d} onClick={() => void ask(t)} className="min-h-9 rounded-ctl border border-line px-3 py-1.5 text-left text-proof-body text-ink transition-colors hover:bg-pf-hover">
              {t}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void ask(draft)
          }}
          className="flex items-center gap-1.5 rounded-ctl border border-line-strong bg-surface p-1"
        >
          <label htmlFor="retail-ask" className="sr-only">
            Question about the aggregates
          </label>
          <input
            id="retail-ask"
            type="text"
            autoComplete="off"
            value={draft}
            maxLength={MAX_Q}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={d ? 'Ask about these aggregates' : 'Waiting for the aggregates…'}
            className="h-9 min-w-0 flex-1 border-0 bg-transparent px-2.5 text-[16px] text-ink outline-none placeholder:text-ink-2 sm:text-proof-body"
          />
          <button type="submit" aria-label="Ask" disabled={!canSend} className="grid size-8 flex-none place-items-center rounded-ctl border-0 bg-selected text-inverse disabled:opacity-40">
            <ArrowUp size={16} strokeWidth={1.8} aria-hidden />
          </button>
        </form>
        <span className="text-proof-label text-ink-3">Each question is answered on its own; follow-ups don’t see the earlier answer. Up to 20 questions a day.</span>
      </div>
    </div>
  )
}

function Answer({ d, reply, reveal, onRevealed, followUps, onAsk, disabled }: { d: Insights; reply: RetailerAnswer; reveal: boolean; onRevealed: () => void; followUps: boolean; onAsk: (q: string) => void; disabled: boolean }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const words = reply.answer.split(/\s+/).filter(Boolean)
  const [shown, setShown] = useState(reveal && !reduced ? 0 : words.length)
  const done = shown >= words.length
  const revealed = useRef(onRevealed)
  useEffect(() => {
    revealed.current = onRevealed
  })
  useEffect(() => {
    if (done) {
      revealed.current()
      return
    }
    // The full answer has already arrived; this only paces how it appears (30 ms a word, docs/DESIGN.md).
    const t = window.setInterval(() => setShown((n) => n + 1), 30)
    return () => window.clearInterval(t)
  }, [done])

  const kind = cohortKind(d.cohort)
  const checked = reply.checks
  const refused = reply.refused ?? !checked
  const chart = refused ? null : reply.chart
  const sources = reply.source ?? []
  const prov = !checked
    ? 'Validator: no draft used only numbers from the aggregates · no numbers returned'
    : refused
      ? `Policy · aggregates only · n≥${MIN_GROUP} · ${checked.model}`
      : `Source ${sources.length ? sources.join(', ') : 'retailer aggregates'} · n≥${MIN_GROUP} · ${checked.numbers_checked} ${checked.numbers_checked === 1 ? 'number' : 'numbers'} checked against the aggregates${checked.rejected_attempts ? ` · ${checked.rejected_attempts} ${checked.rejected_attempts === 1 ? 'draft' : 'drafts'} rejected first` : ''} · ${checked.model}`
  return (
    <div className="flex flex-col gap-3" aria-busy={!done}>
      <div className="flex flex-col gap-2 rounded-card border border-line bg-pf-bg2 p-3.5">
        <span className="flex items-center gap-1.5 text-proof-small font-medium text-ink-2">
          <Sparkles size={13} strokeWidth={1.7} aria-hidden className="text-proof-leaf" />
          {refused ? 'No numbers returned' : `Gemini, from the ${kind === 'real' ? 'real-people' : kind} aggregates`}
        </span>
        <p className="m-0 text-proof-answer text-ink">
          <span className="sr-only">{reply.answer}</span>
          <span aria-hidden>
            {words.slice(0, shown).map((w, i) => (
              <span key={i} className="animate-[wWord_.4s_ease-out_both]">
                {w}{' '}
              </span>
            ))}
          </span>
        </p>
        {done ? <span className="text-proof-label text-ink-3">{prov}</span> : null}
      </div>
      {chart && done ? <AnswerChart chart={chart} /> : null}
      {done && followUps && reply.follow_ups.length ? (
        <div className="flex flex-wrap gap-1.5">
          {reply.follow_ups.map((f) => (
            <button key={f} type="button" disabled={disabled} onClick={() => onAsk(f)} className="min-h-8 rounded-ctl border border-line px-2.5 py-1 text-left text-proof-small text-ink hover:bg-pf-hover">
              {f}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AnswerChart({ chart }: { chart: NonNullable<RetailerAnswer['chart']> }) {
  const max = Math.max(...chart.bars.map((b) => Math.abs(b.value)), 1)
  const bars = chart.bars.map((b) => ({ ...b, n: chart.unit === 'percent' ? (b.n ?? null) : null }))
  const axis = chart.unit === 'percent' ? `% of people${bars.some((b) => b.n !== null) ? ' · n per bar' : ''} · 0–${max}%` : chart.unit === 'weeks' ? `Weeks · 0–${max}` : `Count · 0–${max}`
  const alt = `${chart.title}: ${bars.map((b) => `${b.label} ${UNIT[chart.unit](b.value)}${b.n !== null ? `, n=${b.n}` : ''}`).join('; ')}`
  return (
    <div role="img" aria-label={alt} className="flex flex-col gap-2.5 rounded-card border border-line p-3.5">
      <span className="text-proof-small font-medium text-ink">{chart.title}</span>
      {bars.map((b, i) => (
        <div key={`${b.label}-${i}`} className="flex flex-col gap-1">
          <span className="flex justify-between gap-2.5 text-proof-small">
            <span className="min-w-0 text-ink">{b.label}</span>
            <span className="whitespace-nowrap text-ink tnum">
              {UNIT[chart.unit](b.value)}
              {b.n !== null ? <span className="text-ink-2"> · n={b.n}</span> : null}
            </span>
          </span>
          <span className="block h-1.5 rounded-pill bg-sunken">
            <span className="block h-full origin-left rounded-pill bg-ink-2 animate-[wGrowX_.6s_var(--ease-standard)_both]" style={{ width: `${(Math.abs(b.value) / max) * 100}%` }} />
          </span>
        </div>
      ))}
      <span className="text-proof-label text-ink-3">{axis}</span>
    </div>
  )
}
