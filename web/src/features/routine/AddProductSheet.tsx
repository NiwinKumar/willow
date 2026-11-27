import { Camera, ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Chip'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { AITag } from '../../components/willow/AITag'
import { useOwner, useProductRequests } from '../../data/hooks'
import type { Product } from '../../data/types'
import { ApiError, api, localDay, type ProductRequest } from '../../lib/api'
import { CONCERN_LABEL, categoryLabel, hasFullFacts } from '../../lib/catalog'
import { fmtPrice, plural } from '../../lib/format'
import { marketFromLocale, marketOf, priceFor } from '../../lib/market'
import { packImage } from '../../lib/image'
import { setQueryData } from '../../lib/query'
import { sampleLabelFile } from '../../lib/sampleLabel'
import { useAuth } from '../../lib/useAuth'
import './routine.css'
import { ProductImage } from './productUi'
import { activeLabel } from './routineModel'
import { RoutineSheet } from './RoutineSheet'
import { failureText, useRoutineWrites } from './writes'
import { useChecks, type ProductCheck } from '../../lib/safety'
import { strongActives } from './actives'
import { CheckForMe, CheckReasons, ProductChecked } from './checked'
import { InAisleCheck } from './InAisleCheck'
import { notAdvisedLine } from './names'
import { StartSlowCard } from './StartSlowCard'
import { TestSheet, TestThisButton, type TestTarget } from './TestSheet'

/** What the confirm step saves: always a catalog product (found by search, or matched from a pack photo). */
type Draft = { product: Product; source: 'catalog' | 'label_scan' }

export type AddPreset = { mode?: 'search' | 'request'; slot?: 'am' | 'pm'; category?: string; q?: string; product?: Product }

type When = 'am' | 'pm' | 'both'
const WHEN: { value: When; label: string }[] = [
  { value: 'am', label: 'Morning' },
  { value: 'pm', label: 'Evening' },
  { value: 'both', label: 'Both' },
]
// A new product starts in the slot it usually belongs to; the person can change it before saving.
const defaultWhen = (category: string): When => (category === 'sunscreen' ? 'am' : category === 'cleanser' || category === 'moisturizer' ? 'both' : 'pm')
const slotsOf = (w: When): ('am' | 'pm')[] => (w === 'both' ? ['am', 'pm'] : [w])

/**
 * "Add a product" bottom sheet (design: Willow App Routine, addOpen; it rises from the bottom at every width):
 * search the catalog, then confirm when you use it and since when. A product the catalog does not have yet is
 * requested instead: Willow checks it and adds it with its real ingredients, so everything in a routine comes
 * from the catalog.
 */
type Step = 'pick' | 'confirm' | 'started'
const TITLE: Record<Step, string> = { pick: 'Add a product', confirm: 'Confirm details', started: 'Added' }

export function AddProductSheet({ open, preset, inRoutine, onClose }: { open: boolean; preset: AddPreset | null; inRoutine: Set<string>; onClose: () => void }) {
  const [step, setStep] = useState<Step>('pick')
  // Each opening starts where its preset says (a product from the advisor goes straight to confirm).
  const [opened, setOpened] = useState(false)
  if (open !== opened) {
    setOpened(open)
    if (open) setStep(preset?.product ? 'confirm' : 'pick')
  }
  return (
    <RoutineSheet open={open} onClose={onClose} kind="bottom" fixedHeight title={TITLE[step]} onBack={step === 'confirm' && !preset?.product ? () => setStep('pick') : undefined}>
      {open ? <AddFlow preset={preset ?? {}} inRoutine={inRoutine} onClose={onClose} step={step} setStep={setStep} /> : null}
    </RoutineSheet>
  )
}

function AddFlow({ preset, inRoutine, onClose, step, setStep }: { preset: AddPreset; inRoutine: Set<string>; onClose: () => void; step: Step; setStep: (s: Step) => void }) {
  const writes = useRoutineWrites()
  const [mode, setMode] = useState<'search' | 'request'>(preset.mode ?? 'search')
  // what was typed into search, handed to the request form when the catalog has nothing
  const [asked, setAsked] = useState('')
  const [draft, setDraft] = useState<Draft | null>(preset.product ? { product: preset.product, source: 'catalog' } : null)
  const [when, setWhen] = useState<When>(preset.slot ?? (preset.product ? defaultWhen(preset.product.category) : 'am'))
  const [startedAt, setStartedAt] = useState(localDay)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testing, setTesting] = useState<TestTarget | null>(null)
  const [started, setStarted] = useState<string | null>(null)

  const pick = (product: Product, source: Draft['source'] = 'catalog') => {
    setDraft({ product, source })
    setWhen(preset.slot ?? defaultWhen(product.category))
    setSaveError(null)
    setStep('confirm')
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await writes.add({ product_id: draft.product.product_id, slots: slotsOf(when), started_at: startedAt, source: draft.source })
      // A strong active: patch test, start slow and sunscreen before the sheet closes.
      if (strongActives(draft.product.key_actives).length) {
        setStarted(saved?.id ?? null)
        setStep('started')
      } else onClose()
    } catch (e) {
      setSaveError(failureText(e, "Couldn't save. Your details are still here; try again."))
    } finally {
      setSaving(false)
    }
  }

  const switcher = (
    <SegmentedControl
      label="How to add"
      className="shrink-0 self-start"
      options={[
        { value: 'search', label: 'Search catalog' },
        { value: 'request', label: 'Request a product' },
      ]}
      value={mode}
      onChange={setMode}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      {step === 'pick' ? (
        mode === 'search' ? (
          <CatalogSearch
            switcher={switcher}
            initial={preset}
            inRoutine={inRoutine}
            onPick={(p) => pick(p)}
            onTest={(p) => setTesting({ product_id: p.product_id, name: p.name })}
            onRequest={(q) => {
              setAsked(q)
              setMode('request')
            }}
          />
        ) : (
          <>
            {switcher}
            <RequestProduct asked={asked} inRoutine={inRoutine} onPick={pick} />
          </>
        )
      ) : step === 'started' && draft ? (
        <div className="flex flex-col gap-3">
          <StartSlowCard name={draft.product.name} actives={strongActives(draft.product.key_actives)} onTest={() => setTesting({ entry_id: started ?? undefined, product_id: draft.product.product_id, name: draft.product.name })} />
          <button type="button" onClick={onClose} className="min-h-[54px] rounded-[24px] bg-selected text-[16px] text-inverse transition-[scale] duration-200 ease-standard active:scale-[.985]">
            Got it
          </button>
        </div>
      ) : draft ? (
        <Confirm draft={draft} when={when} setWhen={setWhen} startedAt={startedAt} setStartedAt={setStartedAt} saving={saving} saveError={saveError} onSave={() => void save()} />
      ) : null}
      <TestSheet target={testing} onClose={() => setTesting(null)} />
    </div>
  )
}

function CatalogSearch({ switcher, initial, inRoutine, onPick, onTest, onRequest }: { switcher: ReactNode; initial: AddPreset; inRoutine: Set<string>; onPick: (p: Product) => void; onTest: (p: Product) => void; onRequest: (q: string) => void }) {
  const { getIdToken } = useAuth()
  const [query, setQuery] = useState(initial.q ?? '')
  const [category, setCategory] = useState(initial.category ?? '')
  // several concerns: products made for all of them
  const [concerns, setConcerns] = useState<string[]>([])
  const [answer, setAnswer] = useState<{ key: string; status: 'ready' | 'error'; products: Product[]; total: number; size: number | null; market?: string | null } | null>(null)
  const [retry, setRetry] = useState(0)
  const seq = useRef(0)
  const q = query.trim()

  // Debounced, latest query wins. An empty query lists the catalog nearest to where the person shops first (their saved
  // market, else the browser's guess), then by brand; a query lists the best matches first, nearest among equals.
  const key = JSON.stringify([q, category, concerns, retry])
  useEffect(() => {
    const mine = ++seq.current
    const t = window.setTimeout(async () => {
      try {
        const res = await api.catalogSearch(await getIdToken(), { q: q.slice(0, 100) || undefined, category: category || undefined, concern: concerns, limit: 200, market: marketFromLocale() })
        if (mine === seq.current) setAnswer({ key, status: 'ready', products: res.products, total: res.total ?? res.products.length, size: res.catalog_size ?? null, market: res.market })
      } catch {
        if (mine === seq.current) setAnswer((s) => ({ key, status: 'error', products: s?.products ?? [], total: s?.total ?? 0, size: s?.size ?? null }))
      }
    }, 300)
    return () => window.clearTimeout(t)
  }, [key, q, category, concerns, getIdToken])
  // Until the answer for these words arrives, the last list stays (dimmed) under "Searching…".
  const state = { status: answer?.key === key ? answer.status : 'loading', products: answer?.products ?? [] }
  // Products already in the routine go to the end, so they never sit between the ones to choose from.
  const listed = [...state.products.filter((p) => !inRoutine.has(p.product_id)), ...state.products.filter((p) => inRoutine.has(p.product_id))]
  // Search items carry their check when the person has a safety profile; the rest are asked for (first 80 shown).
  const carried = (p: Product) => (p as Product & { check?: ProductCheck | null }).check ?? undefined
  const checks = useChecks(listed.slice(0, 80).filter((p) => !carried(p)).map((p) => p.product_id))

  // Prices in the person's currency when a store lists one (never converted), else the catalog's reference price.
  const currency = answer?.market ? marketOf(answer.market).currency : null
  const n = state.products.length
  const total = answer?.total ?? n
  const filtered = Boolean(q || category || concerns.length)
  const count = state.status === 'loading' ? 'Searching…' : state.status === 'error' ? '' : !filtered ? (answer?.size ? plural(answer.size, 'product', 'products') : '') : q ? `${plural(total, 'result', 'results')} for “${q}”` : `${plural(total, 'match', 'matches')}`
  const toggle = (id: string) => setConcerns((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        {switcher}
        <label className="relative min-w-[min(100%,240px)] flex-1">
          <span className="sr-only">Search the catalog</span>
          <Search aria-hidden size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
            placeholder="Product, brand or key ingredient"
            className="min-h-11 w-full rounded-pill bg-canvas pr-4 pl-11 text-[16px] text-ink outline-none"
          />
        </label>
      </div>
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Filter by concern (pick any)">
        {category ? (
          <Chip tone="ink" onToggle={() => setCategory('')} selected>
            {categoryLabel(category)} <X size={13} aria-hidden />
            <span className="sr-only">(clear filter)</span>
          </Chip>
        ) : null}
        {Object.entries(CONCERN_LABEL).map(([id, label]) => (
          <Chip key={id} onToggle={() => toggle(id)} selected={concerns.includes(id)}>
            {label}
          </Chip>
        ))}
        {concerns.length > 1 ? (
          <button type="button" onClick={() => setConcerns([])} className="min-h-10 shrink-0 px-2 text-[13px] text-ink-2 underline underline-offset-4">
            Clear
          </button>
        ) : null}
      </div>
      {concerns.length > 1 ? <span className="-mt-1 text-[13px] text-ink-2">Showing products made for all {concerns.length}.</span> : null}
      {/* One quiet line: how many products (the switcher and the field already say "search"), and the profile ask. */}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 text-[13px]">
        <span className="text-ink-2 tabular-nums" aria-live="polite">
          {count === 'Searching…' ? <span className="motion-safe:animate-[wBlink_1.2s_ease-in-out_infinite]">{count}</span> : count}
        </span>
        <CheckForMe />
      </div>

      {state.status === 'loading' && n === 0 ? (
        <div aria-busy aria-label="Searching" className="flex flex-col gap-2">
          {[0, 1, 2].map((k) => (
            <div key={k} className="flex items-center gap-3.5 rounded-[24px] bg-sunken p-3">
              <span className="skeleton block size-[50px] rounded-full" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="skeleton block h-2.5 w-[35%]" />
                <span className="skeleton block h-[15px] w-[70%]" />
              </span>
            </div>
          ))}
        </div>
      ) : state.status === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2.5 rounded-md bg-cta px-[18px] py-4">
          <span>{navigator.onLine ? "Catalog search isn't responding." : "You're offline, so the catalog can't be searched."}</span>
          <Button variant="ink" size="sm" onClick={() => setRetry((r) => r + 1)}>
            Retry
          </Button>
        </div>
      ) : n === 0 ? (
        <div className="flex flex-col items-start gap-2.5 rounded-md bg-sunken p-[18px]">
          <span className="leading-[1.5]">{q ? `Nothing in the catalog matches “${q}” yet.` : 'Nothing in the catalog matches these filters.'}</span>
          {q ? (
            <Button variant="ink" size="sm" onClick={() => onRequest(q)}>
              Request it
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className={`flex flex-col gap-2 transition-opacity ${state.status === 'loading' ? 'opacity-60' : ''}`}>
          {listed.map((p, i) => {
            const has = inRoutine.has(p.product_id)
            return (
              <li key={p.product_id} className="flex items-stretch gap-1 rounded-[24px] bg-sunken transition-colors has-[>button:hover]:bg-muted" style={{ animation: `wRise .35s ${Math.min(i, 10) * 40}ms both` }}>
                <button type="button" disabled={has} onClick={() => onPick(p)} className="flex min-w-0 flex-1 items-center gap-3.5 rounded-[24px] p-3 text-left disabled:opacity-70">
                  <ProductImage product={p} size={50} decorative />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] text-ink-2">
                      {p.brand} · {categoryLabel(p.category)}
                    </span>
                    <span className="text-[16px] leading-snug">{p.name}</span>
                    <ProductChecked check={carried(p) ?? checks.checks[p.product_id]} loading={checks.status === 'loading' && i < 80} profileComplete={checks.profileComplete} inDialog />
                  </span>
                </button>
                <span className="flex shrink-0 flex-col items-end justify-between gap-2 py-3 pr-3">
                  <span className="text-right text-[14px] whitespace-nowrap">{has ? '✓ In routine' : fmtPrice(priceFor(p, currency))}</span>
                  <TestThisButton onClick={() => onTest(p)} label="Test it" name={p.name} />
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {n > 0 ? (
        <button type="button" onClick={() => onRequest(q)} className="min-h-11 self-start text-[14px] text-ink-2 underline underline-offset-4">
          Not here? Request it
        </button>
      ) : null}
    </div>
  )
}

/**
 * Ask Willow to add a product the catalog lacks: a photo of the pack, or its brand and name. Gemini reads the
 * photo first; when that finds a catalog product, it is offered right away instead of a request.
 */
function RequestProduct({ asked, inRoutine, onPick }: { asked: string; inRoutine: Set<string>; onPick: (p: Product, source: Draft['source']) => void }) {
  const { getIdToken } = useAuth()
  const uid = useOwner()
  const requests = useProductRequests()
  const [brand, setBrand] = useState('')
  const [name, setName] = useState(asked)
  const [photo, setPhoto] = useState<{ mime_type: 'image/jpeg'; data_base64: string } | null>(null)
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState<string | null>(null)
  const [found, setFound] = useState<Product | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<ProductRequest | null>(null)

  const choose = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setFound(null)
    setReadNote(null)
    let img
    try {
      img = await packImage(file)
    } catch {
      setError('That photo could not be opened. Try another photo of the pack.')
      return
    }
    setPhoto(img)
    // Gemini reads the pack so the form fills itself in; if it finds the product, the catalog already has it.
    setReading(true)
    try {
      const token = await getIdToken()
      const res = await api.labelScan(token, [img])
      if (res.match) {
        setFound(await api.catalogProduct(token, res.match.product_id))
        return
      }
      if (res.scan.brand) setBrand(res.scan.brand)
      if (res.scan.product_name) setName(res.scan.product_name)
      setReadNote(res.scan.brand || res.scan.product_name ? 'Read from your photo. Check the brand and name.' : 'We couldn’t read the name from the photo. Type it below, or send the photo as it is.')
    } catch {
      setReadNote('We couldn’t read the photo just now. Type the name below, or send the photo as it is.')
    } finally {
      setReading(false)
    }
  }

  const ready = Boolean(photo) || Boolean(brand.trim() && name.trim())
  const send = async () => {
    if (!ready || sending) return
    setSending(true)
    setError(null)
    try {
      // a product the catalog knows only by name: the request (and the photo) is for its full facts
      const facts = found && !hasFullFacts(found) ? { product_id: found.product_id } : {}
      const made = await api.requestProduct(await getIdToken(), { brand: brand.trim(), name: name.trim(), ...facts, ...(photo ? { photo } : {}) })
      setSent(made)
      setQueryData<ProductRequest[]>(['product-requests', uid], (prev) => [made, ...(prev ?? [])])
    } catch (e) {
      if (e instanceof ApiError && e.code === 'in_catalog' && e.detail?.product) setFound(e.detail.product as Product)
      else setError(failureText(e, "Couldn't send the request. Try again."))
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    const what = [sent.brand, sent.name].filter(Boolean).join(' ') || 'your product'
    const others = (sent.askers ?? 1) - 1
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="flex flex-col gap-2 rounded-[24px] bg-sunken p-5">
          <span className="text-[20px] leading-tight">Requested</span>
          <span className="leading-[1.5] text-ink-2">
            We’ll check {what}, add it with its real ingredients and let you know when it’s in the catalog.
            {others > 0 ? ` ${plural(others, 'other person has', 'other people have')} asked for it too, so it moves up the list.` : ''}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setSent(null)
            setBrand('')
            setName('')
            setPhoto(null)
            setReadNote(null)
          }}
        >
          Request another
        </Button>
        <RequestList requests={requests.data ?? []} inRoutine={inRoutine} onPick={onPick} />
      </div>
    )
  }

  const field = 'min-h-[50px] rounded-[16px] bg-canvas px-3.5 text-[16px] text-ink outline-none'
  return (
    <div className="flex flex-col gap-4">
      <p className="leading-[1.55] text-ink-2">
        Can’t find it? Send a photo of the pack, or its brand and name. We check the product, add it to the catalog with its real ingredients, and let you know when it’s in. The more people ask for a product, the sooner it’s added.
      </p>

      {found ? (
        <div className="flex flex-col gap-3 rounded-[24px] bg-sunken p-4">
          <span className="text-[14px] text-ink-2">{hasFullFacts(found) ? 'Good news: it’s already in the catalog' : 'It’s in the catalog, but its ingredient list isn’t in Willow yet. Send the photo below and we’ll add it.'}</span>
          <div className="flex items-center gap-3.5">
            <ProductImage product={found} size={50} decorative />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13px] text-ink-2">
                {found.brand} · {categoryLabel(found.category)}
              </span>
              <span className="text-[16px] leading-snug">{found.name}</span>
            </span>
          </div>
          <InAisleCheck product={found} slots={slotsOf(defaultWhen(found.category))} />
          {inRoutine.has(found.product_id) ? (
            <span className="text-[14px]">✓ Already in your routine</span>
          ) : (
            <Button variant="ink" size="sm" className="self-start" onClick={() => onPick(found, photo ? 'label_scan' : 'catalog')}>
              Add to routine
            </Button>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {photo ? (
          <span className="relative">
            <img src={`data:${photo.mime_type};base64,${photo.data_base64}`} alt="Your photo of the pack" className="size-[72px] rounded-[18px] object-cover" />
            <button type="button" aria-label="Remove photo" onClick={() => setPhoto(null)} disabled={reading} className="hit44 absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-selected text-inverse">
              <X size={13} aria-hidden />
            </button>
          </span>
        ) : null}
        <label className={`${reading ? 'pointer-events-none opacity-55' : 'cursor-pointer'} relative inline-flex min-h-11 items-center gap-2 rounded-pill bg-white px-[18px] text-[15px] shadow-[inset_0_0_0_1px_var(--line-subtle)]`}>
          <Camera size={17} aria-hidden />
          {reading ? 'Reading the pack…' : photo ? 'Retake photo' : 'Photo of the pack'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={reading}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              void choose(file)
            }}
          />
        </label>
        {!photo ? (
          <button type="button" disabled={reading} onClick={() => void sampleLabelFile().then(choose)} className="min-h-11 text-[14px] text-ink-2 underline underline-offset-4 disabled:opacity-50">
            Try a sample photo
          </button>
        ) : null}
      </div>
      {readNote ? (
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <AITag label="AI-read" />
          {readNote}
        </span>
      ) : null}

      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
          Brand
          <input type="text" value={brand} maxLength={80} onChange={(e) => setBrand(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
          Product name
          <input type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
      </div>

      {error ? (
        <p role="alert" className="rounded-[18px] bg-avoid-bg px-4 py-3 text-[14px] text-avoid">
          {error}
        </p>
      ) : null}
      <button type="button" onClick={() => void send()} disabled={!ready || sending || reading} aria-busy={sending} className="min-h-[54px] rounded-[24px] bg-selected text-[16px] text-inverse disabled:opacity-50">
        {sending ? 'Sending…' : 'Send request'}
      </button>
      <span className="-mt-1 text-[13px] text-ink-2">A photo, or both the brand and the name. We keep the photo only until the product is checked.</span>

      <RequestList requests={requests.data ?? []} inRoutine={inRoutine} onPick={onPick} />
    </div>
  )
}

const STATUS_WORDS: Record<ProductRequest['status'], string> = { pending: 'Checking', added: 'Added', declined: 'Couldn’t add' }

function RequestList({ requests, inRoutine, onPick }: { requests: ProductRequest[]; inRoutine: Set<string>; onPick: (p: Product, source: Draft['source']) => void }) {
  if (!requests.length) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] text-ink-2">Your requests</span>
      <ul className="flex flex-col gap-2">
        {requests.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-[20px] bg-sunken px-4 py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[15px]">{[r.brand, r.name].filter(Boolean).join(' ') || 'Photo request'}</span>
              <span className="text-[13px] text-ink-2">
                {r.status === 'pending' && r.status_text ? r.status_text : STATUS_WORDS[r.status]}
                {r.status === 'pending' && (r.askers ?? 0) > 1 ? ` · ${r.askers} people asked` : ''}
                {r.status === 'declined' ? ' · we couldn’t verify its ingredients' : ''}
              </span>
            </span>
            {r.status === 'added' && r.product ? (
              inRoutine.has(r.product.product_id) ? (
                <span className="text-[14px]">✓ In routine</span>
              ) : (
                <Button variant="ink" size="sm" onClick={() => onPick(r.product!, 'catalog')}>
                  Add
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Confirm({ draft, when, setWhen, startedAt, setStartedAt, saving, saveError, onSave }: { draft: Draft; when: When; setWhen: (w: When) => void; startedAt: string; setStartedAt: (d: string) => void; saving: boolean; saveError: string | null; onSave: () => void }) {
  const p = draft.product
  // the product's check for this person (carried on a preset product, else read; cached from the search list)
  const carried = (p as Product & { check?: ProductCheck | null }).check ?? undefined
  const checks = useChecks(carried ? [] : [p.product_id])
  const check = carried ?? checks.checks[p.product_id]
  const warning = notAdvisedLine(check)

  // Order follows the job: which product (with its key actives), any warning, then the two answers this step
  // asks for (when, since when) and Save. The full ingredient list is reference, so it folds away under Save.
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3.5 rounded-[24px] bg-sunken p-3" style={{ animation: 'wRise .35s var(--ease-standard) both' }}>
        <ProductImage product={p} size={56} decorative />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[13px] text-ink-2">
            {p.brand} · {categoryLabel(p.category)}
          </span>
          <span className="text-[17px] leading-snug text-pretty">{p.name}</span>
          {p.key_actives.length ? (
            <span className="flex flex-wrap gap-1 pt-0.5">
              <span className="sr-only">Key actives: </span>
              {p.key_actives.map((a) => (
                <span key={a.name} className="rounded-pill bg-lime px-2.5 py-0.5 text-[12.5px]">
                  {activeLabel(a)}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </div>
      <p className="-mt-1 text-[13px] text-ink-2">
        {!hasFullFacts(p)
          ? 'Its ingredient list isn’t in Willow yet, so it hasn’t been checked for you. You can still add it; open it from your routine to scan the label.'
          : draft.source === 'label_scan'
            ? 'Matched from your photo. Ingredients, price and store links come from the catalog.'
            : 'Ingredients, price and store links come from the catalog.'}
      </p>
      {check && warning ? (
        <div className="flex flex-col gap-2">
          <p role="note" className="m-0 text-[14px] leading-[1.45] text-ink">
            {warning}
          </p>
          <CheckReasons check={check} profileComplete={checks.profileComplete} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3.5" style={{ animation: 'wRise .35s var(--ease-standard) 60ms both' }}>
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] text-ink-2">When you use it</span>
          <SegmentedControl label="When you use it" options={WHEN} value={when} onChange={setWhen} />
        </div>
        <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
          Start date
          <input type="date" value={startedAt} max={localDay()} onChange={(e) => setStartedAt(e.target.value)} className="h-11 rounded-pill bg-canvas px-4 text-[16px] text-ink outline-none" />
        </label>
      </div>
      <p className="-mt-1 text-[13px] text-ink-2">The start date is what lines this product up with your readings.</p>

      {saveError ? (
        <p role="alert" className="rounded-[18px] bg-avoid-bg px-4 py-3 text-[14px] text-avoid" style={{ animation: 'wRise .3s var(--ease-standard) both' }}>
          {saveError}
        </p>
      ) : null}
      <button type="button" onClick={onSave} disabled={saving} aria-busy={saving} className="min-h-[54px] rounded-[24px] bg-selected text-[16px] text-inverse transition-[scale,opacity] duration-200 ease-standard active:scale-[.985] disabled:opacity-70">
        {saving ? 'Saving…' : 'Save to routine'}
      </button>

      {p.inci.length ? (
        <details className="group rounded-[18px] bg-sunken">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[14px] [&::-webkit-details-marker]:hidden">
            <span>
              All ingredients <span className="font-mono text-[12px] text-ink-2">{p.inci.length}</span>
            </span>
            <ChevronDown size={16} strokeWidth={1.8} aria-hidden className="text-ink-2 transition-transform duration-200 ease-standard group-open:rotate-180" />
          </summary>
          <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto px-3 pb-3 group-open:animate-[wRise_.3s_var(--ease-standard)_both]">
            {p.inci.map((ing, i) => (
              <span key={`${ing}-${i}`} className="rounded-pill bg-white px-2.5 py-1 text-[13px]">
                {ing}
              </span>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
