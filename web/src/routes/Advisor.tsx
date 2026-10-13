import { ArrowUp, ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Chip } from '../components/Chip'
import { ProductImage } from '../components/ProductImage'
import type { Product } from '../data/types'
import { useData } from '../data/useData'
import { fmtPrice, imageCredit } from '../lib/format'
import { METRIC_META } from '../lib/metrics'
import { CONCERN_LABEL } from '../mock/catalog'
import { STARTERS, answer, productById, type Turn } from '../mock/advisor'

export function Advisor() {
  const data = useData()
  const [params] = useSearchParams()
  const sessions = useMemo(() => data.series('face_full')?.sessions ?? [], [data])
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [left, setLeft] = useState(20)
  const endRef = useRef<HTMLDivElement>(null)
  const askedPre = useRef(false)
  const q = data.mode === 'demo' ? '?demo=1' : ''

  const ask = (text: string) => {
    if (!text.trim() || thinking) return
    if (left <= 0) {
      toast('That is 20 questions for today. Back tomorrow.')
      return
    }
    setTurns((t) => [...t, { role: 'user', text }])
    setInput('')
    setThinking(true)
    setLeft((n) => n - 1)
    window.setTimeout(() => {
      setTurns((t) => [...t, answer(text, sessions)])
      setThinking(false)
    }, 900)
  }

  useEffect(() => {
    const pre = params.get('q')
    if (pre && !askedPre.current) {
      askedPre.current = true
      ask(pre)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, thinking])

  const last = turns[turns.length - 1]
  const chips = last?.role === 'willow' && last.follow_ups?.length ? last.follow_ups : STARTERS

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-56px)] w-full max-w-[1120px] flex-col px-5 sm:px-8 lg:grid lg:grid-cols-[minmax(0,680px)_1fr] lg:gap-8">
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mt-2 rounded-(--radius-tile) bg-surface-2 px-3 py-2 text-[13px] text-text-2">
          I can explain your measurements, check your routine and find products from a facts-only catalog. I can't diagnose skin conditions or replace a dermatologist.
        </p>
        <div className="flex-1 space-y-5 py-4" aria-live="polite">
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[80%] rounded-(--radius-tile) bg-text px-3 py-2 text-[15px] text-surface">{t.text}</p>
              </div>
            ) : (
              <div key={i} className="max-w-[44rem]">
                {t.retrieval?.length ? (
                  <details className="mb-1 text-[12px] text-text-3">
                    <summary className="cursor-pointer">{t.retrieval[0]}{t.retrieval.length > 1 ? ` · +${t.retrieval.length - 1}` : ''}</summary>
                    <ul className="mt-1 list-disc pl-4">{t.retrieval.map((r) => <li key={r}>{r}</li>)}</ul>
                  </details>
                ) : null}
                <p className="text-[15px] leading-relaxed">{withNumberChips(t, q)}</p>
                {t.product_ids?.length ? (
                  <div className="mt-3 space-y-2">
                    {t.product_ids.map((id) => productById(id)).filter((p): p is Product => Boolean(p)).map((p) => <ProductCard key={p.product_id} p={p} />)}
                    <p className="text-[12px] text-text-3">Products come from our catalog of ingredients, prices and store links. No reviews, no ads, no commissions. Stores are listed by your region, then alphabetically.</p>
                  </div>
                ) : null}
              </div>
            ),
          )}
          {thinking ? <p className="text-[15px] text-text-3">Writing…</p> : null}
          {turns.length === 0 ? (
            <div className="pt-8 text-[15px] text-text-2">
              <p>Ask about a result, a product or your routine.</p>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
        <div className="sticky bottom-0 bg-bg pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
          <div className="mb-2 flex flex-wrap gap-2">
            {chips.slice(0, 4).map((c) => (
              <button key={c} type="button" onClick={() => ask(c)} className="min-h-9 rounded-full border border-border bg-surface px-3 text-[13px] hover:bg-surface-2 active:scale-[0.98]">
                {c}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              ask(input)
            }}
            className="flex items-center gap-2"
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Willow" aria-label="Ask Willow" className="min-h-11 flex-1 rounded-(--radius-control) border border-border bg-surface px-3 text-[16px]" />
            <button type="submit" aria-label="Send" disabled={!input.trim() || thinking} className="inline-flex h-11 w-11 items-center justify-center rounded-(--radius-control) bg-text text-surface disabled:opacity-40">
              <ArrowUp size={18} aria-hidden />
            </button>
          </form>
          {left <= 5 ? <p className="mt-1 text-[12px] text-text-3">{left} questions left today</p> : null}
        </div>
      </div>
      <aside className="hidden lg:block lg:pt-4">
        <h2 className="text-[13px] font-semibold text-text-2">Your numbers used in this chat</h2>
        <ul className="mt-2 space-y-1 text-[13px]">
          {Array.from(new Set(turns.flatMap((t) => t.numbers?.map((n) => n.metric) ?? []))).map((m) => (
            <li key={m}>
              <Link to={`/s/face_full${q}${q ? '&' : '?'}m=${m}&layer=1`} className="text-willow-700 underline-offset-2 hover:underline">{METRIC_META[m as keyof typeof METRIC_META].label}</Link>
            </li>
          ))}
          {turns.length === 0 ? <li className="text-text-3">Nothing yet.</li> : null}
        </ul>
        {data.mode === 'demo' ? <p className="mt-6 text-[12px] text-text-3">Demo: answers are prepared from the sample data; Gemini connects in M4 with the same validation.</p> : null}
      </aside>
    </div>
  )
}

/** Numbers that came from the metrics payload render as chips linking to their metric; anything else stays plain text. */
function withNumberChips(t: Turn, q: string) {
  if (!t.numbers?.length) return t.text
  const parts: (string | React.ReactElement)[] = []
  let rest = t.text
  const seen = new Set<string>()
  for (const n of t.numbers) {
    if (seen.has(n.token)) continue
    seen.add(n.token)
    const idx = rest.indexOf(n.token)
    if (idx < 0) continue
    parts.push(rest.slice(0, idx))
    parts.push(
      <Link key={`${n.metric}-${n.token}`} to={`/s/face_full${q}${q ? '&' : '?'}m=${n.metric}&layer=1`} className="mx-0.5 inline-flex items-baseline gap-1 rounded-(--radius-chip) bg-signal-100 px-1 font-mono text-[14px] text-signal-700" title={`${METRIC_META[n.metric as keyof typeof METRIC_META].label}: from your results`}>
        {n.token}<span className="font-sans text-[11px]">your results</span>
      </Link>,
    )
    rest = rest.slice(idx + n.token.length)
  }
  parts.push(rest)
  return parts
}

function ProductCard({ p }: { p: Product }) {
  const [inci, setInci] = useState(false)
  const credit = imageCredit(p)
  const actives = p.key_actives.slice(0, 3)
  const more = p.key_actives.length - actives.length
  return (
    <div className="rounded-(--radius-tile) border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <ProductImage product={p} size={76} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-text-2">{p.brand}</p>
          <p className="text-[15px] font-semibold leading-snug">{p.name}</p>
          <p className="mt-1 text-[13px] text-text-2">
            <span className="font-mono text-[15px] text-text">{fmtPrice(p.price)}</span> · {p.size}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[13px] text-text-2">For {p.concerns.map((c) => CONCERN_LABEL[c]).join(', ')}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {actives.map((a) => (
          <Chip key={a.name} tone="neutral" className="max-w-full truncate">
            {a.name}
            {a.pct !== null ? ` ${a.pct}%` : ''}
          </Chip>
        ))}
        {more > 0 ? <Chip tone="neutral">+{more} more</Chip> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {p.stores.map((s) => (
          <a key={s.store} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-(--radius-control) border border-border px-3 text-[13px] hover:bg-surface-2">
            {s.store} <ExternalLink size={12} aria-hidden />
          </a>
        ))}
        <button type="button" onClick={() => setInci((v) => !v)} aria-expanded={inci} className="min-h-9 px-2 text-[13px] text-text-2 underline-offset-2 hover:underline">Ingredients</button>
      </div>
      {inci ? <p className="mt-2 text-[12px] text-text-2">{p.inci.join(', ')}</p> : null}
      <p className="mt-2 text-[11px] text-text-3">
        Price as of {p.last_verified}
        {credit ? ` · Image: ${credit}` : ''}
      </p>
    </div>
  )
}
