import { ChevronDown, Download, Sparkles, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ApiError, deleteShelfStock, retailerShelf, uploadShelfStock, type ShelfCategory, type ShelfView } from '../../../../lib/api'
import { useAuth } from '../../../../lib/useAuth'
import { useRetailData } from '../../context'
import { flagsFor, KIND_TONE, templateCsv } from '../../shelf'
import { sectionPath, useRetailState } from '../../state'
import { Badge, Button, ErrorState, int, Panel, pct, ProductCell, SkeletonPanel, ToolButton } from '../../ui'

/*
 * Shelf vs results (retailer workspace, Market -> Categories; api shelf.py): per category, each measured product's
 * share of use (how much of the category's Willow users use it), or the retailer's own stock when they upload a
 * CSV, against its share of the visible changes. Gemini flags what to act on (api shelf_agent.py, checked); while
 * it works, and when it can't, the fixed flags show and the page asks again. Folded to one line by default.
 */

const POLL_MS = 5000
const POLLS = 24
const OPEN_KEY = 'willow.proof.shelf.open'

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
    /* storage blocked: not remembered */
  }
}

export function ShelfResults({ category }: { category: string }) {
  const { user, loading, continueAsGuest, getIdToken } = useAuth()
  const { filters } = useRetailData()
  const { carry } = useRetailState()
  const [view, setView] = useState<{ key: string; v: ShelfView } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [open, setOpenState] = useState(() => window.location.hash === '#shelf' || readOpen())
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const key = `${filters.cohort}|${filters.range}|${user?.uid ?? ''}`
  const [attempt, setAttempt] = useState(0)

  // The upload belongs to an account: a guest one is made on arrival (as Campaigns does).
  useEffect(() => {
    if (!loading && !user) continueAsGuest().catch(() => setFailed(key))
  }, [loading, user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return
    let alive = true
    let left = POLLS
    const load = (quiet: boolean) =>
      getIdToken()
        .then((t) => retailerShelf(t, filters))
        .then(
          (v) => {
            if (!alive) return
            setView({ key, v })
            setFailed(null)
            if (v.pending && left-- > 0) window.setTimeout(() => void load(true), POLL_MS)
          },
          () => alive && !quiet && setFailed(key),
        )
    void load(false)
    return () => {
      alive = false
    }
  }, [key, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  const setOpen = (v: boolean) => {
    setOpenState(v)
    saveOpen(v)
  }
  const refresh = () => setAttempt((a) => a + 1)

  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 190_000) return toast.error('Keep the file under 190 KB (500 rows).')
    setBusy(true)
    try {
      const out = await uploadShelfStock(await getIdToken(), f.name, await f.text())
      const s = out.stock
      toast(`Stock file read · ${s.matched} products matched${s.unmatched.length ? `, ${s.unmatched.length} not found` : ''}`)
      refresh()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Couldn’t read that file. Try again.')
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  const removeStock = async () => {
    setBusy(true)
    try {
      await deleteShelfStock(await getIdToken())
      toast('Stock file removed · back to share of use')
      refresh()
    } catch {
      toast.error('Couldn’t remove it. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const v = view?.key === key ? view.v : null
  if (!v) {
    if (failed === key)
      return (
        <section id="shelf">
          <ErrorState title="Shelf check didn’t load" body="The aggregates it is built from didn’t answer. No flag is shown rather than a guessed one." onRetry={refresh} />
        </section>
      )
    return (
      <div role="status" aria-label="Loading shelf check" aria-busy="true">
        <SkeletonPanel height={120} />
      </div>
    )
  }

  const cat = v.categories.find((c) => c.category === category) ?? null
  const flags = flagsFor(v.flags, category)
  const here = v.flags.filter((f) => f.category === category).length
  const basisWord = v.stock ? 'your stock' : 'share of use'

  return (
    <section id="shelf">
      <Panel
        title="Shelf check: what works vs what’s stocked"
        id="proof-shelf-h"
        meta={
          v.source === 'gemini' ? (
            <Badge tone="outline" title="Gemini chose and explained the flags; every flag's direction and number was checked against the shares.">
              <Sparkles size={12} strokeWidth={1.7} aria-hidden /> Flagged by Gemini
            </Badge>
          ) : v.pending ? (
            <Badge tone="gray" title="Showing the fixed flags until Gemini's are ready.">
              <Sparkles size={12} strokeWidth={1.7} aria-hidden className="animate-pulse" /> Gemini is checking…
            </Badge>
          ) : null
        }
        description={
          open ? (
            v.source === 'gemini' && v.summary ? v.summary : 'Each product’s share of the shelf against its share of the visible changes, with what to act on.'
          ) : (
            <>
              <strong>{v.flags.length} {v.flags.length === 1 ? 'product' : 'products'}</strong> to look at
              {here ? `, ${here} in ${cat?.label.toLowerCase() ?? 'this category'}` : ''}. Shelf = {basisWord}.
            </>
          )
        }
        actions={
          <ToolButton onClick={() => setOpen(!open)} label={open ? 'Hide shelf check' : 'Show shelf check'}>
            <span aria-hidden className="contents">
              <ChevronDown size={14} strokeWidth={1.8} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
              {open ? 'Hide' : 'Show'}
            </span>
          </ToolButton>
        }
        footnote={open ? v.note : undefined}
        flush
      >
        {open ? (
          <div className="flex flex-col">
            <StockBar v={v} cat={cat} busy={busy} onPick={() => file.current?.click()} onRemove={() => void removeStock()} />
            <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Upload a stock or facings CSV" onChange={(e) => void onFile(e.target.files?.[0])} />
            {flags.length ? (
              <ol className="m-0 list-none p-0">
                {flags.map((f) => (
                  <li key={`${f.product_id}:${f.kind}`} className="flex flex-col gap-1.5 border-t border-line px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={KIND_TONE[f.kind]}>{f.label}</Badge>
                      <span className="text-proof-label text-ink-3">{f.category_label}</span>
                    </div>
                    <span className="text-proof-body font-medium text-ink">{f.title}</span>
                    <ProductCell p={{ product: f.product, brand: f.brand, category: f.category, image_url: f.image_url }} to={`${sectionPath('products', f.product_id)}${carry}`} size={28} />
                    <p className="m-0 text-proof-small text-ink-2">{f.reason}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="m-0 border-t border-line px-5 py-4 text-proof-small text-ink-2">Shelf and results are in step: no product is far off its share.</p>
            )}
            {cat ? <Shares cat={cat} /> : null}
          </div>
        ) : null}
      </Panel>
    </section>
  )
}

function StockBar({ v, cat, busy, onPick, onRemove }: { v: ShelfView; cat: ShelfCategory | null; busy: boolean; onPick: () => void; onRemove: () => void }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([templateCsv(v.categories)], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'willow-shelf-template.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-pf-bg2 px-5 py-3">
      <span className="text-proof-small text-ink-2">
        {v.stock ? (
          <>
            Using <strong className="font-medium text-ink">{v.stock.filename}</strong> ({int(v.stock.matched)} products{v.stock.unmatched.length ? `, ${v.stock.unmatched.length} not found` : ''})
            {cat?.agreement !== null && cat?.agreement !== undefined ? <> · in {cat.label.toLowerCase()}, your stock and Willow use agree {pct(cat.agreement)}</> : null}.
          </>
        ) : (
          <>Shelf is share of use: Willow has no stock data. Upload your facings or stock to use your real shelf.</>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Button size="sm" kind="ghost" onClick={download}>
          <Download size={14} strokeWidth={1.7} aria-hidden /> Template
        </Button>
        <Button size="sm" onClick={onPick} disabled={busy}>
          <Upload size={14} strokeWidth={1.7} aria-hidden /> {v.stock ? 'Replace file' : 'Upload stock CSV'}
        </Button>
        {v.stock ? (
          <Button size="sm" kind="ghost" onClick={onRemove} disabled={busy} label="Remove the stock file">
            <Trash2 size={14} strokeWidth={1.7} aria-hidden />
          </Button>
        ) : null}
      </span>
    </div>
  )
}

/** One category's products: shelf (use or stock) and results as paired bars, the gap in points. */
function Shares({ cat }: { cat: ShelfCategory }) {
  const max = Math.max(...cat.products.flatMap((p) => [p.shelf_share, p.results_share]), 0.01)
  return (
    <div className="flex flex-col gap-2 border-t border-line px-5 py-4">
      <span className="text-proof-small font-medium text-ink">
        {cat.label}: {cat.basis === 'stock' ? 'your stock' : 'share of use'} vs share of visible changes
      </span>
      <span className="flex items-center gap-4 text-proof-label text-ink-2" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-full bg-line-strong" /> Shelf
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-full bg-proof-leaf" /> Results
        </span>
      </span>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {cat.products.map((p) => (
          <li key={p.product_id} className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_64px] sm:gap-3">
            <span className="truncate text-proof-small text-ink" title={`${p.brand} ${p.product}`}>
              {p.brand} {p.product}
            </span>
            <span className="flex flex-col gap-1" aria-label={`Shelf ${pct(p.shelf_share)} (${p.basis === 'stock' ? 'stock' : 'use'}), results ${pct(p.results_share)}`}>
              <span className="h-2 rounded-full bg-line-strong" style={{ width: `${(p.shelf_share / max) * 100}%` }} />
              <span className="h-2 rounded-full bg-proof-leaf" style={{ width: `${(p.results_share / max) * 100}%` }} />
            </span>
            <span className={`text-right text-proof-small tnum ${p.gap <= -0.05 ? 'text-pf-amber' : p.gap >= 0.05 ? 'text-proof-leaf' : 'text-ink-2'}`}>
              {p.gap >= 0 ? '+' : '−'}
              {Math.round(Math.abs(p.gap) * 100)} pts
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
