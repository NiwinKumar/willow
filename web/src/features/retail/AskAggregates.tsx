import { useEffect, useRef, useState } from 'react'

import { ApiError, api, type RetailerAnswer } from '../../lib/api'
import { useAuth } from '../../lib/useAuth'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { SimBadge } from './Sections'
import { chartSources, cohortKind, lookupLabel, MIN_GROUP, type Insights } from './data'

/** Questions the aggregates can answer (needs, outcomes, gaps, conflicts, lift). */
const SUGGESTIONS = ['Which products work best for dark spots?', 'Where are we missing affordable options?', 'Which routine problems are most common?', 'How do outcomes compare with non-users?']

const BAR_COLOURS = ['var(--aura-pink)', 'var(--aura-coral)', 'var(--willow-400)', 'var(--aura-sky)', 'var(--aura-violet)', 'var(--aura-apricot)', 'var(--aura-ice)', 'var(--aura-lilac)']

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
    if (e.status === 429) return { title: e.code === 'busy' ? 'BUSY TODAY' : 'DAILY LIMIT', message: e.message }
    if (e.status === 401 || e.status === 403) return { title: 'NOT SIGNED IN', message: 'Asking needs a guest sign-in, which did not work. Reload the page and try again.' }
    if (e.status === 503) return { title: 'SERVICE UNAVAILABLE', message: `${e.message} The dashboard above is unaffected.` }
    return { title: 'NO ANSWER', message: e.message || 'Could not get an answer. Try again.' }
  }
  return { title: 'NO ANSWER', message: 'Could not reach Willow. Check the connection and try again.' }
}

/** "Ask the aggregates": Gemini answers from the same aggregates as the page, and the api checks every number. */
export function AskAggregates({ d }: { d: Insights }) {
  const { user, continueAsGuest, getIdToken } = useAuth()
  const [thread, setThread] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  // Only the newest answer reveals word by word; it finishes before follow-ups appear.
  const [revealing, setRevealing] = useState<number | null>(null)
  const nextId = useRef(0)

  useEffect(() => {
    if (!busy) return
    // Two Gemini attempts can take up to about a minute; say so instead of a fake progress label.
    const t = window.setTimeout(() => setSlow(true), 12_000)
    return () => {
      window.clearTimeout(t)
      setSlow(false)
    }
  }, [busy])

  const ask = async (text: string) => {
    const q = text.trim()
    if (q.length < MIN_Q || busy || revealing !== null) return
    const id = nextId.current++
    setThread((t) => [...t, { id, q }])
    setDraft('')
    setBusy(true)
    try {
      if (!user) await continueAsGuest()
      const reply = await api.retailerAsk(await getIdToken(), q)
      setThread((t) => t.map((m) => (m.id === id ? { ...m, reply } : m)))
      setRevealing(id)
    } catch (e) {
      setThread((t) => t.map((m) => (m.id === id ? { ...m, error: errorOf(e) } : m)))
    } finally {
      setBusy(false)
    }
  }

  const last = thread.at(-1)
  const canSend = draft.trim().length >= MIN_Q && !busy && revealing === null
  return (
    <section
      id="ask"
      aria-labelledby="ask-h"
      className="retail-anchor relative flex flex-col gap-[18px] overflow-hidden rounded-[44px] p-[clamp(22px,3.4vw,40px)]"
      style={{ background: 'radial-gradient(70% 70% at 50% 110%, #2B6BFF 0%, #0F2A8A 35%, #050816 75%)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08), inset 0 -40px 80px rgba(80,140,255,.35)' }}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="ask-h" className="m-0 text-[clamp(30px,4vw,52px)] font-light leading-none tracking-[-0.03em]">Ask the aggregates</h2>
        <span className="max-w-[420px] text-[14px] leading-normal text-[#C9CFFF]">
          Gemini answers from the aggregates on this page only, with suppression applied. Any number it writes that is not in them is rejected. Individual people can’t be looked up.
        </span>
      </div>

      <div aria-live="polite" className="flex flex-col gap-4">
        {thread.map((m) => (
          <div key={m.id} className="flex flex-col gap-4">
            <div className="max-w-[min(80%,560px)] self-end rounded-[24px_24px_8px_24px] bg-white px-[18px] py-3 text-[15px] text-[#121212] animate-[wRise_.35s_both]">{m.q}</div>
            {m.reply ? (
              <Answer d={d} reply={m.reply} reveal={revealing === m.id} onRevealed={() => setRevealing((r) => (r === m.id ? null : r))} followUps={m === last} onAsk={ask} disabled={busy || revealing !== null} />
            ) : m.error ? (
              <ErrorAnswer error={m.error} />
            ) : null}
          </div>
        ))}
        {busy ? (
          <div role="status" className="flex items-center gap-3 self-start rounded-pill bg-glass px-[18px] py-3.5">
            <span aria-hidden className="flex gap-1">
              {[0, 0.15, 0.3].map((delay) => (
                <span key={delay} className="size-[7px] rounded-full bg-ice animate-[wBounce_1.1s_infinite]" style={{ animationDelay: `${delay}s` }} />
              ))}
            </span>
            <span className="text-[14px] text-[#C9CFFF]">{slow ? 'Still reading: an answer can take up to a minute.' : 'Reading the aggregates…'}</span>
          </div>
        ) : null}
      </div>

      {thread.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((t, i) => (
            <button key={t} type="button" onClick={() => void ask(t)} className="min-h-[46px] rounded-pill border border-white/20 bg-white/[.06] px-[18px] text-[14px] text-white transition-[background] duration-200 animate-[wRise_.4s_both] hover:bg-white/[.14]" style={{ animationDelay: `${i * 70}ms` }}>
              {t}
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(draft)
        }}
        className="flex gap-2 rounded-pill border border-white/[.18] bg-white/10 p-1.5 [-webkit-backdrop-filter:blur(16px)] [backdrop-filter:blur(16px)]"
      >
        <label htmlFor="retail-ask" className="sr-only">Question about the aggregates</label>
        <input
          id="retail-ask"
          type="text"
          autoComplete="off"
          value={draft}
          maxLength={MAX_Q}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Which redness products work in the budget tier?"
          className="min-h-[52px] min-w-0 flex-1 border-0 bg-transparent px-[18px] text-[16px] text-white outline-none placeholder:text-[#8E93C0]"
        />
        <button type="submit" aria-label="Ask" disabled={!canSend} className="grid size-[52px] flex-none place-items-center rounded-full border-0 bg-white text-[20px] text-[#121212]">
          ↑
        </button>
      </form>
      <span className="text-[12px] text-[#9CA5E0]">Each question is answered on its own; follow-ups don’t see the earlier answer. Up to 20 questions a day.</span>
    </section>
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
    // The full answer has already arrived; this only paces how it appears (50 ms a word, as designed).
    const t = window.setInterval(() => setShown((n) => n + 1), 50)
    return () => window.clearInterval(t)
  }, [done])

  const kind = cohortKind(d.cohort)
  const checked = reply.checks
  const chart = reply.chart
  const tag = checked ? `GEMINI · GROUNDED IN AGGREGATES · ${kind === 'real' ? 'REAL' : kind === 'mixed' ? 'MIXED' : 'SIMULATED'}` : 'NO NUMBERS RETURNED'
  const sources = chartSources(d, chart)
  const prov = checked
    ? `SOURCE ${sources.length ? sources.join(' · ') : 'retailer aggregates'} · n≥${MIN_GROUP} · VALIDATOR: ${checked.numbers_checked} ${checked.numbers_checked === 1 ? 'number' : 'numbers'} found in the aggregates ✓${checked.rejected_attempts ? ` · ${checked.rejected_attempts} ${checked.rejected_attempts === 1 ? 'draft' : 'drafts'} rejected first` : ''} · ${checked.model.toUpperCase()}`
    : 'VALIDATOR: no draft used only numbers from the aggregates · no numbers returned'
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-3.5 animate-[wRise_.4s_both]" aria-busy={!done}>
      <div className="flex flex-col gap-3 rounded-[32px] border border-white/[.12] bg-glass p-[22px] [-webkit-backdrop-filter:blur(14px)] [backdrop-filter:blur(14px)]">
        <span className="font-mono text-[11px] tracking-[.04em] text-[#9CA5E0]">{tag}</span>
        <p className="m-0 text-[18px] font-light leading-normal">
          <span className="sr-only">{reply.answer}</span>
          <span aria-hidden>
            {words.slice(0, shown).map((w, i) => (
              <span key={i} className="animate-[wWord_.5s_ease-out_both]">{w} </span>
            ))}
            {!done ? <span className="inline-block h-[18px] w-[9px] rounded-[4px] bg-ice align-[-3px] animate-[wBlink_1s_steps(2)_infinite]" /> : null}
          </span>
        </p>
        {done ? (
          <>
            <span className="font-mono text-[11px] leading-relaxed tracking-[.03em] text-[#9CA5E0] animate-[wRise_.35s_both]">{prov}</span>
            {followUps && reply.follow_ups.length ? (
              <span className="flex flex-wrap gap-1.5 animate-[wRise_.4s_both]">
                {reply.follow_ups.map((f) => (
                  <button key={f} type="button" disabled={disabled} onClick={() => onAsk(f)} className="min-h-[42px] rounded-pill border border-white/[.22] bg-white/[.06] px-3.5 text-left text-[13px] text-white">
                    {f}
                  </button>
                ))}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      {chart && done ? (
        <AnswerChart d={d} chart={chart} />
      ) : !checked && done ? (
        <div className="flex flex-col justify-center gap-2 rounded-[32px] border border-dashed border-white/20 bg-black/60 p-[22px] animate-[wRise_.45s_both]">
          <span className="font-dot text-[40px] text-ink-3">—</span>
          <span className="text-[14px] leading-normal text-ink-2">No chart: the answer could not be checked against the aggregates, so no number is shown.</span>
        </div>
      ) : null}
    </div>
  )
}

function AnswerChart({ d, chart }: { d: Insights; chart: NonNullable<RetailerAnswer['chart']> }) {
  const max = Math.max(...chart.bars.map((b) => Math.abs(b.value)), 1)
  // Per-bar n is not in the answer; percent bars look their label up in the aggregates (every label must be one of them).
  const bars = chart.bars.map((b) => ({ ...b, n: chart.unit === 'percent' ? (lookupLabel(d, b.label)?.n ?? null) : null }))
  const axis = chart.unit === 'percent' ? `% OF PEOPLE${bars.some((b) => b.n !== null) ? ' · n PER BAR' : ''} · 0–${max}%` : chart.unit === 'weeks' ? `WEEKS · 0–${max}` : `COUNT · 0–${max}`
  const alt = `${chart.title}: ${bars.map((b) => `${b.label} ${UNIT[chart.unit](b.value)}${b.n !== null ? `, n=${b.n}` : ''}`).join('; ')}`
  return (
    <div role="img" aria-label={alt} className="flex flex-col gap-3 rounded-[32px] bg-[#050505] p-[22px] animate-[wRise_.45s_both]">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] text-ink-2">{chart.title}</span>
        <SimBadge d={d} />
      </span>
      <div className="flex flex-col gap-2.5">
        {bars.map((b, i) => (
          <div key={`${b.label}-${i}`} className="flex flex-col gap-[5px]">
            <span className="flex justify-between gap-2.5 text-[13px]">
              <span className="min-w-0">{b.label}</span>
              <span className="whitespace-nowrap font-mono">{UNIT[chart.unit](b.value)}{b.n !== null ? ` · n=${b.n}` : ''}</span>
            </span>
            <span className="block h-[26px] origin-left rounded-pill animate-[wGrowX_.8s_cubic-bezier(.2,.7,.2,1)_both]" style={{ width: `${(Math.abs(b.value) / max) * 100}%`, background: BAR_COLOURS[i % BAR_COLOURS.length], animationDelay: `${i * 90}ms` }} />
          </div>
        ))}
      </div>
      <span className="font-mono text-[11px] text-ink-2">{axis}</span>
    </div>
  )
}

function ErrorAnswer({ error }: { error: NonNullable<Turn['error']> }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-3.5 animate-[wRise_.4s_both]">
      <div role="alert" className="flex flex-col gap-3 rounded-[32px] border border-white/[.12] bg-glass p-[22px]">
        <span className="font-mono text-[11px] tracking-[.04em] text-[#9CA5E0]">{error.title} · NO NUMBERS RETURNED</span>
        <p className="m-0 text-[18px] font-light leading-normal">{error.message}</p>
      </div>
    </div>
  )
}
