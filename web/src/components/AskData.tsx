import { ArrowUp } from 'lucide-react'
import { useState } from 'react'

import { ApiError, api, type RetailerAnswer } from '../lib/api'
import { useAuth } from '../lib/useAuth'

const STARTERS = ['Which products work best for dark spots?', 'Where are we missing affordable options?', 'Which routine problems are most common?']

const UNIT: Record<NonNullable<RetailerAnswer['chart']>['unit'], (v: number) => string> = {
  percent: (v) => `${v}%`,
  count: (v) => String(v),
  weeks: (v) => `${v} wk`,
}

/** "Ask this data": Gemini answers from the same aggregates as the tabs below, with one optional chart; every number is checked by the api. */
export function AskData() {
  const { user, continueAsGuest, getIdToken } = useAuth()
  const [q, setQ] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<RetailerAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ask = async (question: string) => {
    if (!question.trim() || busy) return
    setBusy(true)
    setAsked(question)
    setQ('')
    setError(null)
    try {
      if (!user) await continueAsGuest()
      setReply(await api.retailerAsk(await getIdToken(), question))
    } catch (e) {
      setReply(null)
      setError(e instanceof ApiError ? e.message : 'Could not get an answer. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const chart = reply?.chart
  const max = chart ? Math.max(...chart.bars.map((b) => Math.abs(b.value)), 1) : 1
  return (
    <section aria-labelledby="ask-data" className="mt-4 rounded-(--radius-tile) border border-border bg-surface p-4">
      <h2 id="ask-data" className="text-[15px] font-semibold">Ask this data</h2>
      <p className="text-[13px] text-text-2">Gemini answers from the aggregates below. Any number it writes that is not in them is rejected.</p>
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(q)
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="For example: which brands keep people using them?" aria-label="Question about the retailer data" className="min-h-11 flex-1 rounded-(--radius-control) border border-border bg-bg px-3 text-[16px]" />
        <button type="submit" aria-label="Ask" disabled={!q.trim() || busy} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-(--radius-control) bg-text text-surface disabled:opacity-40">
          <ArrowUp size={18} aria-hidden />
        </button>
      </form>
      {!asked ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <button key={s} type="button" onClick={() => void ask(s)} className="min-h-11 rounded-full border border-border bg-bg px-3 text-[13px] hover:bg-surface-2">
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {asked ? (
        <div className="mt-4 border-t border-border pt-3" aria-live="polite">
          <p className="text-[13px] font-medium text-text-2">{asked}</p>
          {busy ? <p className="mt-2 text-[15px] text-text-3">Reading the aggregates…</p> : null}
          {error ? <p className="mt-2 text-[15px] text-danger">{error}</p> : null}
          {reply && !busy ? (
            <>
              <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed">{reply.answer}</p>
              {chart ? (
                <figure className="mt-3 max-w-[40rem]">
                  <figcaption className="text-[13px] font-semibold">{chart.title}</figcaption>
                  <ul className="mt-2 space-y-1.5">
                    {chart.bars.map((b) => (
                      <li key={b.label} className="grid grid-cols-[minmax(0,14rem)_1fr_3.5rem] items-center gap-2 text-[13px]">
                        <span className="truncate text-text-2" title={b.label}>{b.label}</span>
                        <span className="h-3 rounded-sm bg-surface-2" aria-hidden>
                          <span className="block h-3 rounded-sm bg-signal-500" style={{ width: `${(Math.abs(b.value) / max) * 100}%` }} />
                        </span>
                        <span className="text-right font-mono">{UNIT[chart.unit](b.value)}</span>
                      </li>
                    ))}
                  </ul>
                </figure>
              ) : null}
              {reply.checks ? (
                <p className="mt-3 text-[12px] text-text-3">
                  {reply.checks.numbers_checked} {reply.checks.numbers_checked === 1 ? 'number' : 'numbers'} checked against the aggregates{reply.checks.rejected_attempts ? `, ${reply.checks.rejected_attempts} draft rejected first` : ''} · {reply.checks.model}
                </p>
              ) : null}
              {reply.follow_ups.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {reply.follow_ups.map((f) => (
                    <button key={f} type="button" onClick={() => void ask(f)} className="min-h-11 rounded-full border border-border bg-bg px-3 text-[13px] hover:bg-surface-2">
                      {f}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
