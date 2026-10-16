import { Copy, ExternalLink, Info, RotateCcw } from 'lucide-react'
import { memo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Disclaimer } from '../../components/willow/Disclaimer'
import type { MetricId, Product } from '../../data/types'
import type { AdvisorReply, AnswerBlock } from '../../lib/api'
import { fmtDate, fmtPrice, plural } from '../../lib/format'
import { SITE_LABEL } from '../../lib/metrics'
import { purchaseLink } from '../../lib/partnerStore'
import { ProductImage } from '../routine/productUi'
import { metaLine } from '../routine/routineModel'
import { retry, type ChatMessage } from './chatStore'
import { Markup, type MarkupLinks } from './markup'
import { plainText } from './markupParse'
import { AnswerOrb } from './Water'
import { Widget, type WidgetLinks } from './widgets'

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
      {m.context ? <span className="font-mono text-[10px] tracking-[.06em] text-ink-2">■ {m.context.toUpperCase()}</span> : null}
      <div className="flex max-w-[min(82%,560px)] flex-col gap-2.5 rounded-[26px_26px_8px_26px] bg-selected px-3.5 py-2.5 text-[13.5px] leading-[1.45] whitespace-pre-wrap text-inverse" style={{ animation: 'advSlide .35s cubic-bezier(.2,.7,.2,1) both' }}>
        {m.photos?.length ? (
          <span className="flex flex-wrap justify-end gap-1.5">
            {m.photos.map((p) => (
              <img key={p.thumb} src={p.thumb} alt={`Attached photo: ${p.name}`} className="size-[120px] rounded-[18px] object-cover shadow-[inset_0_0_0_1px_rgba(255,255,255,.2)]" />
            ))}
          </span>
        ) : m.photoCount ? (
          <span className="font-mono text-[10px] tracking-[.06em] text-inverse/70">
            ■ {m.photoCount} PRODUCT PHOTO{m.photoCount === 1 ? '' : 'S'} · NOT KEPT
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
      : [r.photos_refused ? 'The photo was not read: chat photos are for products only' : 'No answer passed the checks, so a fixed reply is shown']),
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
          <span className="font-mono text-[10px] tracking-[.06em] text-ink-2">■ HOW THIS ANSWER WAS MADE</span>
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
function copyText(blocks: AnswerBlock[], name: (id: string) => string | null): string {
  return blocks
    .flatMap((b) => (b.type === 'answer' || b.type === 'note' ? [plainText(b.text, name)] : b.type === 'bullets' ? b.items.map((i) => `• ${plainText(i, name)}`) : []))
    .join('\n')
}

// Memoised: while an answer appears only the answer being revealed redraws.
export const Answer = memo(function Answer({ m, last, busy, capped, actions }: { m: Extract<ChatMessage, { role: 'willow' }>; last: boolean; busy: boolean; capped: boolean; actions: AnswerActions }) {
  const r = m.reply
  const revealing = m.shown < m.blocks.length
  const byId = new Map(r.products.map((p) => [p.product_id, p]))
  const productName = (id: string) => byId.get(id)?.name ?? null
  const links: MarkupLinks = {
    productName,
    onProduct: (id) => {
      const p = byId.get(id)
      if (p) actions.onProduct(p)
    },
    onMetric: actions.onMetric,
  }
  const widgetLinks: WidgetLinks = { go: actions.go, onProduct: actions.onProduct, onAdd: actions.onAdd, product: (id) => byId.get(id) ?? null }
  return (
    <div className="group flex w-full items-start gap-3" style={{ animation: 'wRise .4s both' }} aria-busy={revealing}>
      <span className="mt-1.5">
        <AnswerOrb />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-col gap-3 rounded-[8px_28px_28px_28px] bg-surface px-4 pt-3.5 pb-2 shadow-[0_30px_60px_-44px_rgba(0,0,0,.35)]">
          {/* Screen readers get each block once, as it appears; the reveal is only visual. */}
          {m.blocks.slice(0, m.shown).map((b, i) => (
            <div key={i} style={{ animation: 'advIn .55s cubic-bezier(.2,.7,.2,1) both' }}>
              {b.type === 'widget' ? (
                <Widget spec={b.widget} links={widgetLinks} />
              ) : b.type === 'products' ? (
                <div className="flex flex-col gap-2">
                  {b.product_ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p)).map((p) => (
                    <ProductCard key={p.product_id} p={p} onOpen={() => actions.onProduct(p)} />
                  ))}
                </div>
              ) : (
                <TextBlock b={b} links={links} />
              )}
            </div>
          ))}
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
                  void navigator.clipboard?.writeText(copyText(m.blocks, productName) || r.message).then(
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
        {!revealing && last && r.follow_up_suggestions.length ? (
          <span className="flex flex-wrap gap-1.5 pt-1.5">
            {r.follow_up_suggestions.map((f, i) => (
              <button key={f} type="button" disabled={busy || capped} onClick={() => actions.onAsk(f)} className="min-h-10 rounded-pill border border-ink/12 bg-white/90 px-3.5 text-left text-[13px] transition-colors hover:bg-sunken" style={{ animation: `wRise .4s ${i * 80}ms both` }}>
                {f}
              </button>
            ))}
          </span>
        ) : null}
        <Stamp at={m.at} align="left" />
      </div>
    </div>
  )
})

/**
 * A product the advisor named (from reply.products: real catalog listings), with one purchase link: the
 * retail partner's page (lib/partnerStore), else the brand's own site; the price read off that page when the
 * catalog has one.
 */
function ProductCard({ p, onOpen }: { p: Product; onOpen: () => void }) {
  const buy = purchaseLink(p.stores)
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-[17px] bg-sunken p-3" style={{ animation: 'wRise .45s both' }}>
      <button type="button" onClick={onOpen} aria-label={`Product details: ${p.name}`} className="shrink-0 rounded-full transition-transform hover:scale-105">
        <ProductImage product={p} size={44} />
      </button>
      <button type="button" onClick={onOpen} className="flex min-w-[170px] flex-1 flex-col gap-0.5 text-left">
        <span className="text-[12px] text-ink-2">{metaLine(p.brand, p.category, p.size)}</span>
        <span className="text-[13px]">{p.name}</span>
        <span className="text-[12px] text-ink-2">
          {fmtPrice(p.price)} · price checked {fmtDate(p.last_verified, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </button>
      {buy ? (
        <a
          href={buy.url}
          target="_blank"
          rel="noopener noreferrer"
          title={buy.price ? `Price on the store's page, checked ${fmtDate(buy.price.checked)}` : undefined}
          aria-label={`Buy at ${buy.store}${buy.price ? `, ${fmtPrice(buy.price)}, checked ${fmtDate(buy.price.checked)}` : ''}, opens in new tab`}
          className="hit44 inline-flex min-h-9 items-center gap-1 rounded-pill bg-white px-2.5 text-[12px] no-underline"
        >
          Buy at {buy.store}
          {buy.price ? <span className="tnum text-ink-2">{fmtPrice(buy.price)}</span> : null}
          <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
        </a>
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
      <span className="mt-1.5">
        <AnswerOrb />
      </span>
      <div role="status" className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-[8px_32px_32px_32px] bg-surface p-4 shadow-[0_30px_60px_-44px_rgba(0,0,0,.35)]">
        <span className="font-mono text-[10px] leading-[1.5] tracking-[.05em] text-ink-2">STANDARD EXPLANATION · AI UNAVAILABLE · NO NEW ANALYSIS</span>
        {s ? (
          <>
            <p className="m-0 text-[14.5px] leading-[1.55] text-pretty">
              The AI advisor is unavailable right now, so here is the standard summary of your latest {(SITE_LABEL[s.site] ?? 'check-in').toLowerCase()} check-in, from {fmtDate(s.created_at, { day: 'numeric', month: 'short' })}. Product questions will work again when the advisor is back.
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
          <p className="m-0 text-[14.5px] leading-[1.55] text-pretty">The AI advisor is unavailable right now, and there is no measured check-in yet to summarise. Your results, routine and the compatibility check still work.</p>
        )}
        <button type="button" disabled={busy} onClick={() => retry(m.id)} className="hit44 min-h-9 self-start rounded-pill bg-selected px-[18px] text-[13px] text-inverse">
          Ask the advisor again
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
