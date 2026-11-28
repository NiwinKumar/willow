import { Copy, ExternalLink, Info, RotateCcw } from 'lucide-react'
import { memo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Disclaimer } from '../../components/willow/Disclaimer'
import type { MetricId, Product } from '../../data/types'
import type { AdvisorReply, AnswerBlock } from '../../lib/api'
import { NO_PRICE } from '../../lib/catalog'
import { fmtDate, fmtPrice, plural } from '../../lib/format'
import { SITE_LABEL } from '../../lib/metrics'
import { ProductImage } from '../routine/productUi'
import { metaLine } from '../routine/routineModel'
import { retry, type ChatMessage } from './chatStore'
import { Markup, type MarkupLinks } from './markup'
import { plainText } from './markupParse'
import { WispMark } from './Wisp'
import { Widget, shownPrice, type AnswerProduct, type WidgetLinks } from './widgets'
import { uiWord, type AnswerLabels } from '../../lib/language'
import { COMMISSION_NOTE, useStoreClick } from '../../lib/clicks'
import { useChecks, type ProductCheck } from '../../lib/safety'
import { CheckedChip } from '../../components/willow/CheckedChip'
import { ReactionEscalation } from './ReactionEscalation'
import { mentionsReaction } from '../../lib/reactions'
import { useGrow } from './motion'

/** "gemini-3.8-flash" -> "Gemini 3.8 Flash" for the info popover. */
const modelName = (id: string) => id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** Hover time on a message, e.g. "14:05 · 13 Oct". */
function Stamp({ at, align }: { at: string; align: 'left' | 'right' }) {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  return (
    <time dateTime={at} className={`pointer-events-none px-1 text-[10.5px] text-ink-2 opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100 ${align === 'right' ? 'self-end' : 'self-start'}`}>
      {d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {fmtDate(at)}
    </time>
  )
}

export const UserBubble = memo(function UserBubble({ m }: { m: Extract<ChatMessage, { role: 'user' }> }) {
  return (
    <div className="group flex flex-col items-end gap-1">
      {m.context ? <span className="text-[12px] text-ink-2">From {m.context}</span> : null}
      <div className="flex max-w-[min(82%,560px)] flex-col gap-2.5 rounded-[26px_26px_8px_26px] bg-selected px-3.5 py-2.5 text-[13.5px] leading-[1.45] whitespace-pre-wrap text-inverse" style={{ animation: 'advSlide .42s cubic-bezier(.32,.72,0,1) both' }}>
        {m.photos?.length ? (
          <span className="flex flex-wrap justify-end gap-1.5">
            {m.photos.map((p) => (
              <img key={p.thumb} src={p.thumb} alt={`Attached photo: ${p.name}`} className="size-[120px] rounded-[18px] object-cover shadow-[inset_0_0_0_1px_rgba(255,255,255,.2)]" />
            ))}
          </span>
        ) : m.photoCount ? (
          <span className="text-[12px] text-inverse/70">
            {m.photoCount} product photo{m.photoCount === 1 ? '' : 's'} · not kept
          </span>
        ) : null}
        <span>{m.text}</span>
      </div>
      <Stamp at={m.at} align="right" />
    </div>
  )
})

/** "How this answer was made": what the api did and what its validator checked, in a popover. */
function HowMade({ r }: { r: AdvisorReply }) {
  const [open, setOpen] = useState(false)
  const c = r.checks
  const lines = [
    ...r.retrieval,
    ...(c
      ? [
          `Written by ${modelName(c.model)}`,
          c.numbers_checked > 0 ? `${plural(c.numbers_checked, 'number', 'numbers')} checked against your results and the catalog` : 'No numbers quoted',
          c.products_from_tools > 0 ? `${plural(c.products_from_tools, 'product', 'products')} from the catalog or your routine` : null,
        ]
      : [
          r.photos_refused
            ? 'The photo was not read: chat photos are for products only'
            : // refused in code before any model call (a medicine, a medical or guarantee claim): the retrieval line says which
              r.retrieval.some((x) => x.startsWith('Not sent to the model'))
              ? 'A fixed reply, written by Willow, not by the model'
              : 'No answer passed the checks, so a fixed reply is shown',
        ]),
  ].filter((x): x is string => Boolean(x))
  return (
    <span
      className="relative"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button type="button" aria-label="How this answer was made" aria-expanded={open} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={(e) => setOpen((o) => ((e.nativeEvent as PointerEvent).pointerType === 'mouse' ? true : !o))} className="hit44 grid size-7 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/5 hover:text-ink">
        <Info size={15} strokeWidth={1.7} aria-hidden />
      </button>
      {open ? (
        <span role="tooltip" className="absolute right-0 bottom-full z-10 mb-1.5 flex w-[280px] flex-col gap-1.5 rounded-[18px] bg-surface/95 p-3.5 text-left text-[12px] leading-[1.45] text-[#3E3C38] shadow-[0_24px_50px_-20px_rgba(0,0,0,.35),inset_0_0_0_1px_rgba(18,18,18,.06)] backdrop-blur-[18px]" style={{ animation: 'wRise .2s both' }}>
          <span className="text-[13px] text-ink">How this answer was made</span>
          {lines.map((x) => (
            <span key={x}>✓ {x}</span>
          ))}
        </span>
      ) : null}
    </span>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="hit44 grid size-7 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/5 hover:text-ink">
      {children}
    </button>
  )
}

function TextBlock({ b, links }: { b: AnswerBlock; links: MarkupLinks }) {
  if (b.type === 'answer') return <p className="m-0 text-[15.5px] leading-[1.5] text-pretty">{<Markup text={b.text} links={links} />}</p>
  if (b.type === 'note')
    return (
      <p className="m-0 border-l-2 border-sky/40 pl-2.5 text-[13px] leading-[1.5] text-ink-2">
        <Markup text={b.text} links={links} />
      </p>
    )
  if (b.type === 'bullets')
    return (
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {b.items.map((it) => (
          <li key={it} className="flex gap-2.5 text-[14px] leading-[1.45]">
            <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-sky" />
            <span>
              <Markup text={it} links={links} />
            </span>
          </li>
        ))}
      </ul>
    )
  return null
}

export type AnswerActions = {
  onAsk: (q: string) => void
  onProduct: (p: Product) => void
  onAdd: (p: Product) => void
  onMetric: (id: MetricId) => void
  go: (path: string) => void
  onRegenerate: () => void
}

/** The answer's plain text for the clipboard: markup turned into names. */
function copyText(blocks: AnswerBlock[], name: (id: string) => string | null, metricName?: (id: string) => string | null): string {
  return blocks
    .flatMap((b) => (b.type === 'answer' || b.type === 'note' ? [plainText(b.text, name, metricName)] : b.type === 'bullets' ? b.items.map((i) => `• ${plainText(i, name, metricName)}`) : []))
    .join('\n')
}

/**
 * The check a card shows for a product of this answer. When the routine check finds it in conflict with another
 * product of the same answer (reply.pairings, from the rule table), the card says "Check this" with that
 * reason first, never "No flags" beside a warning about the pair.
 */
function withPairing(check: ProductCheck | undefined, pairing: { issue: string; suggestion: string; with: string[] } | undefined): ProductCheck | undefined {
  if (!pairing) return check
  const flag = {
    rule: 'routine_pairing',
    level: 'check' as const,
    title: pairing.with.length ? `Check with ${pairing.with.join(' and ')}` : 'Check this pairing',
    detail: [pairing.issue, pairing.suggestion].filter(Boolean).join(' '),
    source: { label: 'Willow’s routine check (rule table)', url: null },
    grade: null,
  }
  const base = check ?? { status: 'check' as const, flags: [], regulatory: null }
  return { ...base, status: base.status === 'avoid' || base.status === 'not_sold' ? base.status : 'check', flags: [flag, ...base.flags] }
}

// Memoised: while an answer appears only the answer being revealed redraws.
export const Answer = memo(function Answer({ m, last, busy, capped, actions, question }: { m: Extract<ChatMessage, { role: 'willow' }>; last: boolean; busy: boolean; capped: boolean; actions: AnswerActions; /** The question this answers (reaction answers carry the fixed escalation words). */ question?: string }) {
  const r = m.reply
  const checks = useChecks(r.products.map((p) => p.product_id))
  const clickStore = useStoreClick('wisp')
  // The api may flag it (`escalation`); else the question's own words.
  const reaction = Boolean((r as AdvisorReply & { escalation?: unknown }).escalation) || mentionsReaction(question)
  const revealing = m.shown < m.blocks.length
  // A just-arrived answer: its bubble opens out of the thinking bubble and down to each new block (motion.ts),
  // with Wisp's mark holding still in its place; an answer from the history rises in as a whole.
  const [fresh] = useState(() => Date.now() - Date.parse(m.at) < 3000)
  const bubble = useRef<HTMLDivElement>(null)
  useGrow(bubble, `${m.shown}${revealing}`, fresh, '8px 28px 28px 28px')
  const byId = new Map(r.products.map((p) => [p.product_id, p]))
  const productName = (id: string) => byId.get(id)?.name ?? null
  // A translated answer names measurements, verdicts and card labels in its own language (api translate.py).
  const labels: AnswerLabels | null = r.labels ?? null
  const metricName = labels ? (id: string) => labels.metrics[id] ?? null : undefined
  const links: MarkupLinks = {
    productName,
    onProduct: (id) => {
      const p = byId.get(id)
      if (p) actions.onProduct(p)
    },
    onMetric: actions.onMetric,
    metricName,
  }
  const widgetLinks: WidgetLinks = { go: actions.go, onProduct: actions.onProduct, onAdd: actions.onAdd, product: (id) => byId.get(id) ?? null, labels }
  return (
    <div className="group flex w-full items-start gap-3" style={{ animation: fresh ? undefined : 'wRise .4s both' }} aria-busy={revealing}>
      <span className="-mt-0.5 -ml-1">
        <WispMark size={34} state={revealing ? 'speaking' : 'idle'} still={!revealing} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div ref={bubble} lang={r.lang} className="flex min-w-0 flex-col gap-3 rounded-[8px_28px_28px_28px] bg-surface px-4 pt-3.5 pb-2 shadow-[0_30px_60px_-44px_rgba(0,0,0,.35)]">
          {/* Screen readers get each block once, as it appears; the reveal is only visual. */}
          {m.blocks.slice(0, m.shown).map((b, i) => (
            <div key={i} style={{ animation: `advIn .5s cubic-bezier(.32,.72,0,1) ${fresh && i === 0 ? 120 : 60}ms both` }}>
              {b.type === 'widget' ? (
                <Widget spec={b.widget} links={widgetLinks} />
              ) : b.type === 'products' ? (
                <div className="flex flex-col gap-2">
                  {b.product_ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p)).map((p) => (
                    <ProductCard
                      key={p.product_id}
                      p={p}
                      currency={r.price_currency ?? null}
                      pairing={r.pairings?.[p.product_id]}
                      labels={labels}
                      check={withPairing(checks.checks[p.product_id], r.pairings?.[p.product_id])}
                      loading={checks.status === 'loading' && !r.pairings?.[p.product_id]}
                      profileComplete={checks.profileComplete}
                      onStore={(store) => clickStore(p.product_id, store)}
                      onOpen={() => actions.onProduct(p)}
                    />
                  ))}
                  {b.product_ids.some((id) => byId.get(id)?.stores.length) ? <span className="px-1 text-[11.5px] text-ink-2">{COMMISSION_NOTE}</span> : null}
                </div>
              ) : (
                <TextBlock b={b} links={links} />
              )}
            </div>
          ))}
          {!revealing && reaction ? <ReactionEscalation /> : null}
          {revealing ? <span aria-hidden className="h-3 w-16 rounded-full advShimmer" /> : null}
          {!revealing ? (
            <span className="-mr-1.5 flex items-center justify-end gap-0.5">
              <HowMade r={r} />
              {last && !busy && !capped ? (
                <IconButton label="Regenerate this answer" onClick={actions.onRegenerate}>
                  <RotateCcw size={14} strokeWidth={1.7} aria-hidden />
                </IconButton>
              ) : null}
              <IconButton
                label="Copy answer"
                onClick={() => {
                  void navigator.clipboard?.writeText(copyText(m.blocks, productName, metricName) || r.message).then(
                    () => toast('Copied'),
                    () => toast('Couldn’t copy here'),
                  )
                }}
              >
                <Copy size={14} strokeWidth={1.7} aria-hidden />
              </IconButton>
            </span>
          ) : null}
        </div>
        <Stamp at={m.at} align="left" />
      </div>
    </div>
  )
})

/** A store's own price, shown only in the answer's currency (one currency per answer; never a second one beside it). */
const storePrice = (s: Product['stores'][number], currency: string | null) => (s.price && (!currency || s.price.currency === currency) ? s.price : null)

/** A product the advisor named (from reply.products: real catalog listings). Stores are links, with the price read off each store's page when the catalog has one. */
function ProductCard({ p, check, loading, profileComplete, currency, pairing, labels, onStore, onOpen }: {
  p: AnswerProduct
  check: ProductCheck | undefined
  loading: boolean
  profileComplete: boolean | null
  /** The answer's one currency: the card's price and its store prices are shown in it only. */
  currency: string | null
  pairing?: { issue: string; suggestion: string; with: string[] }
  labels: AnswerLabels | null
  onStore: (store: string) => void
  onOpen: () => void
}) {
  // One figure: the price the answer was given for this product (the lowest checked one in the person's currency).
  const price = shownPrice(p)
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-[17px] bg-sunken p-3" style={{ animation: 'wRise .45s both' }}>
      <button type="button" onClick={onOpen} aria-label={`Product details: ${p.name}`} className="shrink-0 rounded-full transition-transform hover:scale-105">
        <ProductImage product={p} size={44} />
      </button>
      <button type="button" onClick={onOpen} className="flex min-w-[170px] flex-1 flex-col gap-0.5 text-left">
        <span className="text-[12px] text-ink-2">{metaLine(p.brand, p.category, p.size)}</span>
        <span className="text-[13px]">{p.name}</span>
        <span className="text-[12px] text-ink-2">
          {price ? `${fmtPrice(price)} · price checked ${fmtDate(p.last_verified, { day: 'numeric', month: 'short', year: 'numeric' })}` : currency && p.price ? `No price checked in ${currency}` : NO_PRICE}
        </span>
        {pairing ? <span className="text-[12px] leading-[1.4] text-caution">{pairing.issue}</span> : null}
      </button>
      <CheckedChip check={check} loading={loading} profileComplete={profileComplete} short wordsFor={labels ? (status) => (status === 'clear' ? uiWord(labels, 'no_flags', '') : status === 'check' ? uiWord(labels, 'check_this', '') : null) : undefined} />
      {p.stores.length ? (
        <span className="flex flex-wrap gap-1.5">
          {p.stores.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onStore(s.store)}
              onAuxClick={() => onStore(s.store)}
              title={storePrice(s, currency) ? `Price on the store's page, checked ${fmtDate(s.price!.checked)}` : undefined}
              aria-label={`${s.store}${storePrice(s, currency) ? `, ${fmtPrice(s.price)}, checked ${fmtDate(s.price!.checked)}` : ''}, opens in new tab`}
              className="hit44 inline-flex min-h-9 items-center gap-1 rounded-pill bg-white px-2.5 text-[12px] no-underline"
            >
              {s.store}
              {storePrice(s, currency) ? <span className="tnum text-ink-2">{fmtPrice(s.price)}</span> : null}
              <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
            </a>
          ))}
        </span>
      ) : null}
    </div>
  )
}

/**
 * "AI unavailable · standard explanation" (design: the advisor's fallback answer): the latest measured
 * session's pre-written explanation, built by code from Willow's own measurements (sent by the api with
 * the 502). Nothing new is analysed and Gemini is not involved; the question can be asked again later.
 */
export function StandardCard({ m, busy }: { m: Extract<ChatMessage, { role: 'standard' }>; busy: boolean }) {
  const s = m.standard
  return (
    <div className="flex w-full items-start gap-3" style={{ animation: 'wRise .4s both' }}>
      <span className="-mt-0.5 -ml-1">
        <WispMark size={34} still />
      </span>
      <div role="status" className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-[8px_32px_32px_32px] bg-surface p-4 shadow-[0_30px_60px_-44px_rgba(0,0,0,.35)]">
        <span className="font-mono text-[10px] leading-[1.5] tracking-[.05em] text-ink-2">STANDARD EXPLANATION · AI UNAVAILABLE · NO NEW ANALYSIS</span>
        {s ? (
          <>
            <p className="m-0 text-[14.5px] leading-[1.55] text-pretty">
              Wisp is unavailable right now, so here is the standard summary of your latest {(SITE_LABEL[s.site] ?? 'check-in').toLowerCase()} check-in, from {fmtDate(s.created_at, { day: 'numeric', month: 'short' })}. Product questions will work again when the advisor is back.
            </p>
            <span className="text-[15px]">{s.explanation.headline}</span>
            {s.explanation.items.length ? (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13.5px] leading-[1.5] text-[#3E3C38]">
                {s.explanation.items.map((it) => (
                  <li key={it.metric_id}>{it.summary}</li>
                ))}
              </ul>
            ) : null}
            {s.explanation.next_steps.map((t) => (
              <span key={t} className="text-[13px] text-ink-2">
                → {t}
              </span>
            ))}
            <span className="text-[12px] text-willow-700">✓ Pre-written summary of measured results</span>
            <Disclaimer />
          </>
        ) : (
          <p className="m-0 text-[14.5px] leading-[1.55] text-pretty">Wisp is unavailable right now, and there is no measured check-in yet to summarise. Your results, routine and the compatibility check still work.</p>
        )}
        <button type="button" disabled={busy} onClick={() => retry(m.id)} className="hit44 min-h-9 self-start rounded-pill bg-selected px-[18px] text-[13px] text-inverse">
          Ask Wisp again
        </button>
      </div>
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
