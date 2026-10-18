import { ChevronDown, Copy, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'

import { retailerBuyingList, type BuyingItem, type BuyingList as List } from '../../../../lib/api'
import { itemText, KIND_BADGE, listText } from '../../buying'
import { useRetailData } from '../../context'
import { sectionPath, useRetailState } from '../../state'
import { Badge, cohortKind, ErrorState, int, Panel, ProductCell, SkeletonPanel, ToolButton } from '../../ui'
import { useView } from '../../useView'

/*
 * Buying list (retailer workspace; api buying.py): the assortment gaps worth acting on, ranked by people who want
 * the goal x how big the gap is, each as a short brief a buyer can paste, with under-used products already in the
 * catalog to look at first. Gemini writes it as an agent (api buying_agent.py: which gaps, their order, the briefs,
 * the products and why), every number and word checked; while it works (and when it can't) the fixed-logic list is
 * shown and the page asks again. Every candidate carries "Not measured … yet" or "Too few users to measure yet".
 */

const POLL_MS = 5000
const POLLS = 24

/** Some packs print INCI in capitals ("NIACINAMIDE"): shown as Niacinamide. */
const inciCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s)

/** Open or folded, remembered per browser (a convenience only: storage may be blocked). */
const OPEN_KEY = 'willow.proof.buying.open'
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}
function saveOpen(v: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, v ? '1' : '0')
  } catch {
    /* storage blocked: it just won't be remembered */
  }
}

const copy = (text: string, what: string) =>
  void navigator.clipboard?.writeText(text).then(
    () => toast(`${what} copied`),
    () => toast.error('Couldn’t copy. Select the text instead.'),
  )

export function BuyingList() {
  const { filters, insights } = useRetailData()
  const q = useView<List>(`buying|${filters.cohort}|${filters.range}`, () => retailerBuyingList(filters))
  // Gemini's list replaces the fixed one when it is ready: ask again quietly while it is pending.
  const [newer, setNewer] = useState<{ key: string; list: List } | null>(null)
  const viewKey = `${filters.cohort}|${filters.range}`
  const pending = (newer?.key === viewKey ? newer.list : q.data)?.pending === true
  useEffect(() => {
    if (!pending) return
    let alive = true
    let left = POLLS
    const tick = () => {
      if (!alive || left-- <= 0) return
      retailerBuyingList(filters).then(
        (l) => {
          if (!alive) return
          if (l.pending) window.setTimeout(tick, POLL_MS)
          else setNewer({ key: viewKey, list: l })
        },
        () => alive && window.setTimeout(tick, POLL_MS),
      )
    }
    const t = window.setTimeout(tick, POLL_MS)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [pending, viewKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const d = insights.status === 'ready' || insights.status === 'empty' ? insights.d : null
  // Folded by default (it is long); a #buying link opens it.
  const { hash } = useLocation()
  const [open, setOpenState] = useState(() => hash === '#buying' || readOpen())
  const setOpen = (v: boolean) => {
    setOpenState(v)
    saveOpen(v)
  }
  const cohortLabel: string = d ? ({ real: 'consented users', mixed: 'mixed cohort', simulated: 'simulated cohort' } as const)[cohortKind(d.cohort)] : 'Willow cohort'

  if (q.status === 'loading')
    return (
      <div role="status" aria-label="Loading the buying list" aria-busy="true">
        <SkeletonPanel height={320} />
      </div>
    )
  if (q.status === 'failed' || !q.data)
    return (
      <section id="buying">
        <ErrorState title="The buying list didn’t load" body="The aggregates it is built from didn’t answer. No brief is shown rather than a guessed one." onRetry={q.retry} />
      </section>
    )
  const list = newer?.key === viewKey ? newer.list : q.data
  return (
    <section id="buying">
      <Panel
        title="Buying list"
        id="proof-buying-h"
        meta={
          list.source === 'gemini' ? (
            <Badge tone="outline" title="Gemini chose the gaps and their order, wrote the briefs and picked the products; every number, word and product was checked against the aggregates and the catalog.">
              <Sparkles size={12} strokeWidth={1.7} aria-hidden /> Written by Gemini
            </Badge>
          ) : list.pending ? (
            <Badge tone="gray" title="Showing the fixed-logic list until Gemini's is ready.">
              <Sparkles size={12} strokeWidth={1.7} aria-hidden className="animate-pulse" /> Gemini is writing it…
            </Badge>
          ) : null
        }
        description={
          open || !list.items.length ? (
            list.source === 'gemini' && list.summary ? (
              list.summary
            ) : (
              'The gaps worth acting on, ranked by how many people want the goal and how big the gap is, with under-used products already in the catalog to look at first.'
            )
          ) : (
            <>
              <strong>
                {list.items.length} {list.items.length === 1 ? 'gap' : 'gaps'}
              </strong>{' '}
              worth acting on. First: {list.items[0].title.toLowerCase()} ({list.items[0].demand.toLocaleString('en-GB')} people).
            </>
          )
        }
        actions={
          list.items.length ? (
            <>
              {open ? (
                <ToolButton onClick={() => copy(listText(list, cohortLabel), 'Buying list')}>
                  <Copy size={14} strokeWidth={1.7} aria-hidden />
                  Copy all briefs
                </ToolButton>
              ) : null}
              <ToolButton onClick={() => setOpen(!open)} label={open ? 'Hide the buying list' : 'Show the buying list'}>
                <span aria-hidden className="contents">
                  <ChevronDown size={14} strokeWidth={1.8} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                  {open ? 'Hide' : 'Show list'}
                </span>
              </ToolButton>
            </>
          ) : null
        }
        footnote={open ? list.caveat : undefined}
        flush
      >
        {!open && list.items.length ? null : list.items.length ? (
          <ol className="m-0 list-none p-0">
            {list.items.map((it, i) => (
              <Item key={it.id} it={it} n={i + 1} />
            ))}
          </ol>
        ) : (
          <p className="m-0 px-5 pb-5 text-proof-small text-ink-2">No gap stands out: every goal has a measured option in every price tier, close to its best tier.</p>
        )}
      </Panel>
    </section>
  )
}

function Item({ it, n }: { it: BuyingItem; n: number }) {
  const { carry } = useRetailState()
  const k = KIND_BADGE[it.kind]
  return (
    <li className="flex flex-col gap-3 border-t border-line px-5 py-4">
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border border-line text-proof-label font-medium text-ink-2 tnum">
            {n}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-proof-body font-medium text-ink">{it.title}</h3>
              <Badge tone={k.tone}>{k.word}</Badge>
              <Badge tone="gray">{it.price ? `${it.tier_label} · ${it.price}` : 'Every price tier'}</Badge>
            </div>
            <p className="m-0 text-proof-small text-ink-2">{it.brief}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 pl-9 sm:pl-0">
          <span className="text-proof-small text-ink-2 tnum">{int(it.demand)} people</span>
          <ToolButton onClick={() => copy(itemText(it), 'Brief')} label={`Copy the brief: ${it.title}`}>
            <Copy size={14} strokeWidth={1.7} aria-hidden />
          </ToolButton>
        </div>
      </div>
      {it.candidates.length ? (
        <div className="flex flex-col gap-2 pl-9">
          <span className="text-proof-label font-medium text-ink-2">Look at first · already in the catalog</span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {it.candidates.map((c) => (
              <li key={c.product_id} className="flex flex-col gap-1.5 rounded-card border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ProductCell p={{ product: c.product, brand: c.brand, category: c.category, image_url: c.image_url }} to={`${sectionPath('products', c.product_id)}${carry}`} />
                  <span className="flex flex-wrap items-center gap-1.5">
                    {c.ingredient ? <Badge tone="outline">{inciCase(c.ingredient)}</Badge> : null}
                    <Badge tone="amber">{c.label}</Badge>
                  </span>
                </div>
                <p className="m-0 text-proof-small text-ink-2">{c.why}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="m-0 pl-9 text-proof-small text-ink-2">Nothing in the catalog fits yet: this one needs a new product.</p>
      )}
    </li>
  )
}
