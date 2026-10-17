import type { ReactNode } from 'react'

import { AGREE_CELLS, agreeMissing, splitTags, verdictParts, verdictSummary } from '../feel'
import type { Feel, FeelTag, FeelVerdict, ProductDetail } from '../types'
import { Badge, int, MIN_GROUP, Panel, pct } from '../ui'

/*
 * "How it feels" on the product page: what people using it say (self-reported), beside the measurements and
 * never part of them (not in the tier, the evidence pack or any claim). The three answers as one stacked bar,
 * the look-and-feel tags people liked and didn't, and how what they felt lines up with what was measured.
 * Brief cards link here with #feel.
 */

// Leaf is "working" (the one positive answer); the other two are neutral greys, told apart by order, word
// and shade. Status colours (amber, red) are not used: "Not for me" is an answer, not an error.
const SWATCH: Record<FeelVerdict, string> = {
  working: 'bg-proof-leaf',
  unsure: 'bg-pf-base/60',
  not_for_me: 'bg-pf-base',
}

export function FeelPanel({ x }: { x: ProductDetail }) {
  const f = x.feel ?? null
  return (
    <div id="feel" className="scroll-mt-32">
      <Panel
        title="How it feels"
        id="feel-h"
        meta={<Badge tone="outline">Self-reported</Badge>}
        description={f ? `What ${int(f.n)} people using it said, two weeks in or later.` : undefined}
        footnote={f ? f.note : undefined}
      >
        {f ? <Body f={f} x={x} /> : <p className="m-0 text-proof-body text-ink-2">Fewer than {MIN_GROUP} people have said how it feels yet.</p>}
      </Panel>
    </div>
  )
}

function Body({ f, x }: { f: Feel; x: ProductDetail }) {
  const { liked, notLiked } = splitTags(f.tags)
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
        <Verdicts f={f} />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <TagList title="Liked" tags={liked} empty={`No tag reaches ${MIN_GROUP} people yet.`} />
          <TagList title="Not liked" tags={notLiked} empty={`No tag reaches ${MIN_GROUP} people yet.`} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 border-t border-line pt-5 lg:col-span-7 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-proof-body font-medium text-ink">Felt vs measured</h3>
          {f.agree ? (
            <p className="m-0 text-proof-small text-ink-2 tnum">
              {int(f.agree.n)} people at week 8 who answered: did they say it’s working, and was a visible change measured?
            </p>
          ) : null}
        </div>
        {f.agree ? <Agree a={f.agree} /> : <p className="m-0 text-proof-small text-ink-2">{agreeMissing(x.product)}</p>}
      </div>
    </div>
  )
}

/** One stacked bar (leaf = working) and a legend that carries every share and the n in words. */
function Verdicts({ f }: { f: Feel }) {
  const parts = verdictParts(f)
  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="sr-only">{verdictSummary(f)}</figcaption>
      <div aria-hidden className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-pill">
        {parts
          .filter((p) => p.width > 0)
          .map((p) => (
            <span key={p.id} className={`block h-full ${SWATCH[p.id]}`} style={{ width: `${p.width}%` }} />
          ))}
      </div>
      <ul aria-hidden className="m-0 flex list-none flex-col gap-1.5 p-0">
        {parts.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-proof-body">
            <span className={`size-2.5 shrink-0 rounded-[3px] ${SWATCH[p.id]}`} />
            <span className="min-w-0 flex-1 truncate text-ink">{p.label}</span>
            <span className={`tnum ${p.id === 'working' ? 'font-semibold text-ink' : 'text-ink'}`}>{p.text}</span>
          </li>
        ))}
        <li className="flex justify-end text-proof-label text-ink-2 tnum">n={int(f.n)}</li>
      </ul>
    </figure>
  )
}

function TagList({ title, tags, empty }: { title: string; tags: FeelTag[]; empty: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="m-0 text-proof-body font-medium text-ink">{title}</h3>
      {tags.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {tags.map((t) => (
            <li key={t.tag} className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line last:border-b-0">
              <span className="truncate text-proof-body text-ink" title={t.label}>
                {t.label}
              </span>
              <span className="text-right text-proof-body text-ink tnum">{pct(t.share)}</span>
              <span className="w-12 text-right text-proof-label text-ink-2 tnum">
                <span aria-hidden>n={int(t.n)}</span>
                <span className="sr-only">, {int(t.n)} people</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-proof-small text-ink-2">{empty}</p>
      )}
    </div>
  )
}

/** The 2×2: columns "said it's working" yes / no, rows "visible change" yes / no; one sentence per cell. */
function Agree({ a }: { a: NonNullable<Feel['agree']> }) {
  const axis = 'hidden text-proof-label text-ink-2 sm:block'
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)]">
      <span aria-hidden className={axis} />
      <span aria-hidden className={axis}>
        Said it’s working
      </span>
      <span aria-hidden className={axis}>
        Didn’t say it’s working
      </span>
      {AGREE_CELLS.map((c, i) => (
        <AgreeRowHead key={`h-${c.key}`} show={i % 2 === 0} measured={c.measured}>
          <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-baseline gap-3 rounded-ctl border border-line px-3.5 py-3 sm:flex sm:flex-col sm:items-start sm:gap-1">
            <span className="text-[20px] font-semibold leading-7 tracking-[-0.02em] text-ink tnum sm:text-proof-kpi">{pct(a[c.key])}</span>
            <span className="text-proof-small text-ink-2">{c.sentence}</span>
          </div>
        </AgreeRowHead>
      ))}
    </div>
  )
}

/** A cell, preceded by its row's axis label at the start of each row (sm and up). */
function AgreeRowHead({ show, measured, children }: { show: boolean; measured: boolean; children: ReactNode }) {
  return (
    <>
      {show ? (
        <span aria-hidden className="hidden self-center text-proof-label text-ink-2 sm:block">
          {measured ? 'Visible change' : 'No visible change yet'}
        </span>
      ) : null}
      {children}
    </>
  )
}
