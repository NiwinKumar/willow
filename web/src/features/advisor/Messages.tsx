import { ExternalLink } from 'lucide-react'
import { memo } from 'react'
import { toast } from 'sonner'

import { AITag } from '../../components/willow/AITag'
import type { Product } from '../../data/types'
import type { AdvisorReply } from '../../lib/api'
import { fmtDate, fmtPrice, plural } from '../../lib/format'
import { CategoryOrb } from '../routine/productUi'
import { metaLine } from '../routine/routineModel'
import { retry, type ChatMessage } from './chatStore'
import { AnswerOrb } from './Water'

/** "gemini-3.8-flash" -> "GEMINI 3.8 FLASH" for the provenance line. */
const modelCaps = (id: string) => id.replace(/-/g, ' ').toUpperCase()

/** Where an answer came from, from what the api says it did (checks, products, retrieval steps). */
function provenance(r: AdvisorReply): string {
  if (!r.checks) return 'WILLOW · NO ANSWER PASSED THE CHECKS'
  const catalog = r.products.length > 0 || r.retrieval.some((x) => /catalog|product/i.test(x))
  return [modelCaps(r.checks.model), 'YOUR RESULTS', 'YOUR ROUTINE', catalog ? 'CATALOG' : null].filter(Boolean).join(' · ')
}

function checkLine(r: AdvisorReply): string | null {
  if (!r.checks) return null
  const nums = r.checks.numbers_checked > 0 ? `✓ ${plural(r.checks.numbers_checked, 'number', 'numbers')} checked against your results and the catalog` : '✓ No numbers quoted'
  return r.checks.products_from_tools > 0 ? `${nums} · ${plural(r.checks.products_from_tools, 'product', 'products')} from the catalog` : nums
}

export const UserBubble = memo(function UserBubble({ m }: { m: Extract<ChatMessage, { role: 'user' }> }) {
  return (
    <div className="flex flex-col items-end gap-1">
      {m.context ? <span className="font-mono text-[10px] tracking-[.06em] text-ink-2">■ {m.context.toUpperCase()}</span> : null}
      <div className="max-w-[min(82%,560px)] rounded-[26px_26px_8px_26px] bg-selected px-3.5 py-2.5 text-[13px] leading-[1.45] text-inverse" style={{ animation: 'advSlide .35s cubic-bezier(.2,.7,.2,1) both' }}>
        {m.text}
      </div>
    </div>
  )
})

// Memoised: while an answer appears (a store update every ~42 ms) only the answer being revealed redraws.
export const Answer = memo(function Answer({ m, last, busy, capped, onAsk, onProduct }: { m: Extract<ChatMessage, { role: 'willow' }>; last: boolean; busy: boolean; capped: boolean; onAsk: (q: string) => void; onProduct: (p: Product) => void }) {
  const r = m.reply
  const revealing = m.shown < m.words.length
  const check = checkLine(r)
  return (
    <div className="flex w-full items-start gap-3" style={{ animation: 'wRise .4s both' }} aria-busy={revealing}>
      <span className="mt-1.5">
        <AnswerOrb />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-[8px_32px_32px_32px] bg-surface p-4 shadow-[0_30px_60px_-44px_rgba(0,0,0,.35)]">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] leading-[1.5] tracking-[.05em] text-ink-2">{provenance(r)}</span>
          {r.checks ? <AITag className="!min-h-5 !px-2 !text-[10px]" /> : null}
        </span>
        {/* The visible words appear one by one; screen readers get the whole answer once, from the sr-only copy below. */}
        <p aria-hidden className="text-[14.5px] leading-[1.55] text-pretty">
          {m.words.slice(0, m.shown).map((w, i) => (
            <span key={i} style={{ animation: 'wWord .5s ease-out both' }}>
              {w}{' '}
            </span>
          ))}
          {revealing ? <span aria-hidden className="inline-block h-[18px] w-[9px] rounded-[4px] bg-sky align-[-3px]" style={{ animation: 'wBlink 1s steps(2) infinite' }} /> : null}
        </p>
        {!revealing && r.products.length ? (
          <div className="flex flex-col gap-2">
            {r.products.map((p) => (
              <ProductCard key={p.product_id} p={p} onOpen={() => onProduct(p)} />
            ))}
            <span className="text-[11.5px] text-ink-2">From Willow’s catalog: ingredients, one checked price and store links. No reviews, no ads, no commissions.</span>
          </div>
        ) : null}
        {!revealing ? (
          <div className="flex flex-col gap-3" style={{ animation: 'wRise .4s both' }}>
            <span className="flex flex-wrap items-center justify-between gap-2.5">
              {/* Without checks the api's own fallback already says how to ask; don't repeat it. */}
              {check ? <span className="text-[12px] text-willow-700">{check}</span> : <span />}
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(r.message).then(
                    () => toast('Answer copied'),
                    () => toast('Couldn’t copy here'),
                  )
                }}
                className="hit44 min-h-[30px] rounded-pill bg-sunken px-3 text-[12px]"
              >
                Copy
              </button>
            </span>
            {r.retrieval.length ? (
              <details className="text-[12px] text-ink-2">
                <summary className="cursor-pointer py-1">How this answer was made</summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {r.retrieval.map((x) => (
                    <li key={x}>✓ {x}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {last && r.follow_up_suggestions.length ? (
              <span className="flex flex-wrap gap-1.5">
                {r.follow_up_suggestions.map((f, i) => (
                  <button key={f} type="button" disabled={busy || capped} onClick={() => onAsk(f)} className="min-h-11 rounded-pill border border-ink/12 bg-white px-3.5 text-left text-[13px] transition-colors hover:bg-sunken" style={{ animation: `wRise .4s ${i * 80}ms both` }}>
                    {f}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {!revealing ? <span className="sr-only">{r.message}</span> : null}
    </div>
  )
})

/** A product the advisor named (from reply.products: real catalog listings). Stores are links only. */
function ProductCard({ p, onOpen }: { p: Product; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-[17px] bg-sunken p-3" style={{ animation: 'wRise .45s both' }}>
      <button type="button" onClick={onOpen} aria-label={`Product details: ${p.name}`} className="shrink-0 rounded-full transition-transform hover:scale-105">
        <CategoryOrb category={p.category} size={34} />
      </button>
      <button type="button" onClick={onOpen} className="flex min-w-[170px] flex-1 flex-col gap-0.5 text-left">
        <span className="text-[12px] text-ink-2">{metaLine(p.brand, p.category, p.size)}</span>
        <span className="text-[13px]">{p.name}</span>
        <span className="text-[12px] text-ink-2">
          {fmtPrice(p.price)} · price checked {fmtDate(p.last_verified, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </button>
      {p.stores.length ? (
        <span className="flex flex-wrap gap-1.5">
          {p.stores.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`${s.store}, opens in new tab`} className="hit44 inline-flex min-h-9 items-center gap-1 rounded-pill bg-white px-2.5 text-[12px] no-underline">
              {s.store} <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
            </a>
          ))}
        </span>
      ) : null}
    </div>
  )
}

export function ErrorBubble({ m, busy }: { m: Extract<ChatMessage, { role: 'error' }>; busy: boolean }) {
  return (
    <div role="alert" className="flex items-start gap-3" style={{ animation: 'wRise .4s both' }}>
      <span aria-hidden className="mt-1.5 grid size-[26px] shrink-0 place-items-center rounded-full bg-coral text-[13.5px] text-inverse">
        !
      </span>
      <div className="flex flex-1 flex-col gap-2.5 rounded-[8px_28px_28px_28px] bg-surface px-3.5 py-3">
        <span className="text-[13px]">{m.title}</span>
        <span className="text-[13px] text-ink-2">{m.body}</span>
        {m.question ? (
          <button type="button" disabled={busy} onClick={() => retry(m.id)} className="hit44 min-h-9 self-start rounded-pill bg-selected px-[18px] text-[13px] text-inverse">
            Try again
          </button>
        ) : null}
      </div>
    </div>
  )
}
