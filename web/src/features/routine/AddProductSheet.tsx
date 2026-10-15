import { ArrowLeft, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Chip'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Sheet } from '../../components/ui/Sheet'
import { AITag } from '../../components/willow/AITag'
import type { Product } from '../../data/types'
import { ApiError, api, localDay, type LabelScan, type NewRoutineEntry } from '../../lib/api'
import { CATEGORY_LABEL, CONCERN_LABEL, categoryLabel } from '../../lib/catalog'
import { fmtPrice } from '../../lib/format'
import { toJpegBase64 } from '../../lib/image'
import { sampleLabelFile } from '../../lib/sampleLabel'
import { useAuth } from '../../lib/useAuth'
import './routine.css'
import { CategoryOrb } from './productUi'
import { activeLabel } from './routineModel'
import { failureText, useRoutineWrites } from './writes'

/** What the confirm step saves: a catalog product, or what a label scan read, or what the person typed. */
type Draft = {
  product_id: string | null
  brand: string
  name: string
  category: string
  key_actives: { name: string; pct: number | null }[]
  inci: string[]
  concerns: string[]
  source: 'catalog' | 'label_scan' | 'manual'
  /** Present when this draft came from a label photo (Gemini read it: AI-written). */
  scan: { confidence: LabelScan['confidence']; matched: boolean } | null
}

export type AddPreset = { mode?: 'search' | 'scan'; slot?: 'am' | 'pm'; category?: string; q?: string; product?: Product }

type When = 'am' | 'pm' | 'both'
const WHEN: { value: When; label: string }[] = [
  { value: 'am', label: 'Morning' },
  { value: 'pm', label: 'Evening' },
  { value: 'both', label: 'Both' },
]
// A new product starts in the slot it usually belongs to; the person can change it before saving.
const defaultWhen = (category: string): When => (category === 'sunscreen' ? 'am' : category === 'cleanser' || category === 'moisturizer' ? 'both' : 'pm')
const slotsOf = (w: When): ('am' | 'pm')[] => (w === 'both' ? ['am', 'pm'] : [w])

const fromProduct = (p: Product, source: Draft['source'], scan: Draft['scan'] = null): Draft => ({
  product_id: p.product_id,
  brand: p.brand,
  name: p.name,
  category: p.category,
  key_actives: p.key_actives,
  inci: p.inci,
  concerns: p.concerns,
  source,
  scan,
})

const MAX_B64 = 8_000_000 // api LabelImage.data_base64 max_length

/** Shrink a label photo until it fits the api's limit (big phone photos first go to 1600 px). */
async function labelImage(file: File) {
  let img = await toJpegBase64(file)
  if (img.data_base64.length > MAX_B64) img = await toJpegBase64(file, 1100, 0.75)
  if (img.data_base64.length > MAX_B64) throw new Error('too big')
  return img
}

function scanError(e: unknown): string {
  if (!navigator.onLine) return "You're offline. Connect and try again, or search the catalog instead."
  if (e instanceof ApiError) {
    if (e.status === 429) return `${e.message} Search the catalog instead.`
    if (e.status === 422) return 'That photo could not be opened. Try another photo of the ingredient list, or search instead.'
    if (e.status === 502) return "The label couldn't be read just now, and this scan wasn't counted. Try again in a moment, or search instead."
  }
  if (e instanceof Error && e.message === 'too big') return 'That photo is too large to send. Try a closer, smaller photo of the ingredient list.'
  return "The label couldn't be read. Flatten it, tilt it away from the light and try again, or search instead."
}

/**
 * "Add a product" bottom sheet (design: Willow App Routine, addOpen): search the catalog or scan a label,
 * then confirm when you use it and since when. Everything saved comes from the catalog or the label.
 */
export function AddProductSheet({ open, preset, inRoutine, onClose }: { open: boolean; preset: AddPreset | null; inRoutine: Set<string>; onClose: () => void }) {
  const [step, setStep] = useState<'pick' | 'confirm'>('pick')
  // Each opening starts where its preset says (a product from the advisor goes straight to confirm).
  const [opened, setOpened] = useState(false)
  if (open !== opened) {
    setOpened(open)
    if (open) setStep(preset?.product ? 'confirm' : 'pick')
  }
  return (
    <Sheet open={open} onClose={onClose} title={step === 'confirm' ? 'Confirm details' : 'Add a product'} variant="bottom" size="md">
      {open ? <AddFlow preset={preset ?? {}} inRoutine={inRoutine} onClose={onClose} step={step} setStep={setStep} /> : null}
    </Sheet>
  )
}

function AddFlow({ preset, inRoutine, onClose, step, setStep }: { preset: AddPreset; inRoutine: Set<string>; onClose: () => void; step: 'pick' | 'confirm'; setStep: (s: 'pick' | 'confirm') => void }) {
  const { getIdToken } = useAuth()
  const writes = useRoutineWrites()
  const [mode, setMode] = useState<'search' | 'scan'>(preset.mode ?? 'search')
  const [draft, setDraft] = useState<Draft | null>(preset.product ? fromProduct(preset.product, 'catalog') : null)
  const [when, setWhen] = useState<When>(preset.slot ?? (preset.product ? defaultWhen(preset.product.category) : 'am'))
  const [startedAt, setStartedAt] = useState(localDay)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const pick = (d: Draft) => {
    setDraft(d)
    setWhen(preset.slot ?? defaultWhen(d.category))
    setSaveError(null)
    setStep('confirm')
  }

  const save = async () => {
    if (!draft) return
    const entry: NewRoutineEntry = draft.product_id
      ? { product_id: draft.product_id, slots: slotsOf(when), started_at: startedAt, source: draft.source }
      : {
          // Clamp what a label scan read (or the person typed) to what the api accepts.
          custom_name: draft.name.trim().slice(0, 120),
          brand: draft.brand.trim().slice(0, 80),
          category: (draft.category || 'other').slice(0, 40),
          key_actives: draft.key_actives.slice(0, 20).map((a) => ({ name: a.name.slice(0, 80), pct: a.pct !== null && a.pct >= 0 && a.pct <= 100 ? a.pct : null })),
          inci: draft.inci.slice(0, 120),
          concerns: draft.concerns,
          slots: slotsOf(when),
          started_at: startedAt,
          source: draft.source,
        }
    setSaving(true)
    setSaveError(null)
    try {
      await writes.add(entry)
      onClose()
    } catch (e) {
      setSaveError(failureText(e, "Couldn't save. Your details are still here; try again."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {step === 'confirm' && !preset.product ? (
        <Button variant="glass" size="sm" icon={ArrowLeft} className="-mt-1 self-start" onClick={() => setStep('pick')}>
          Back
        </Button>
      ) : null}

      {step === 'pick' ? (
        <>
          <SegmentedControl
            label="How to add"
            className="self-start"
            options={[
              { value: 'search', label: 'Search catalog' },
              { value: 'scan', label: 'Scan label' },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'search' ? (
            <CatalogSearch
              initial={preset}
              inRoutine={inRoutine}
              onPick={(p) => pick(fromProduct(p, 'catalog'))}
              onScan={() => setMode('scan')}
              onManual={() => pick({ product_id: null, brand: '', name: '', category: 'other', key_actives: [], inci: [], concerns: [], source: 'manual', scan: null })}
            />
          ) : (
            <LabelScanner
              getIdToken={getIdToken}
              onRead={pick}
              onSearch={() => setMode('search')}
            />
          )}
        </>
      ) : draft ? (
        <Confirm draft={draft} setDraft={setDraft} when={when} setWhen={setWhen} startedAt={startedAt} setStartedAt={setStartedAt} saving={saving} saveError={saveError} onSave={() => void save()} />
      ) : null}
    </div>
  )
}

function CatalogSearch({ initial, inRoutine, onPick, onScan, onManual }: { initial: AddPreset; inRoutine: Set<string>; onPick: (p: Product) => void; onScan: () => void; onManual: () => void }) {
  const { getIdToken } = useAuth()
  const [query, setQuery] = useState(initial.q ?? '')
  const [category, setCategory] = useState(initial.category ?? '')
  const [concern, setConcern] = useState('')
  const [answer, setAnswer] = useState<{ key: string; status: 'ready' | 'error'; products: Product[] } | null>(null)
  const [retry, setRetry] = useState(0)
  const seq = useRef(0)
  const q = query.trim()

  // Debounced, latest query wins. An empty query lists the catalog (alphabetical by brand: no ranking).
  const key = JSON.stringify([q, category, concern, retry])
  useEffect(() => {
    const mine = ++seq.current
    const t = window.setTimeout(async () => {
      try {
        const res = await api.catalogSearch(await getIdToken(), { q: q.slice(0, 100) || undefined, category: category || undefined, concern: concern || undefined, limit: 60 })
        if (mine === seq.current) setAnswer({ key, status: 'ready', products: res.products })
      } catch {
        if (mine === seq.current) setAnswer((s) => ({ key, status: 'error', products: s?.products ?? [] }))
      }
    }, 300)
    return () => window.clearTimeout(t)
  }, [key, q, category, concern, getIdToken])
  // Until the answer for these words arrives, the last list stays (dimmed) under "Searching…".
  const state = { status: answer?.key === key ? answer.status : 'loading', products: answer?.products ?? [] }

  const n = state.products.length
  const filtered = Boolean(category || concern)
  const meta = state.status === 'loading' ? 'Searching…' : state.status === 'error' ? '' : q ? `${n} result${n === 1 ? '' : 's'} for “${q}”` : filtered ? `${n} product${n === 1 ? '' : 's'} in the catalog` : `From the catalog · ${n} products`

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
        Search the catalog
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={100}
          placeholder="Product, brand or key ingredient"
          className="min-h-[54px] rounded-md bg-canvas px-[18px] text-[16px] text-ink outline-none focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]"
        />
      </label>
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Filter by concern">
        {category ? (
          <Chip tone="ink" onToggle={() => setCategory('')} selected>
            {categoryLabel(category)} <X size={13} aria-hidden />
            <span className="sr-only">(clear filter)</span>
          </Chip>
        ) : null}
        {Object.entries(CONCERN_LABEL).map(([id, label]) => (
          <Chip key={id} onToggle={() => setConcern(concern === id ? '' : id)} selected={concern === id}>
            {label}
          </Chip>
        ))}
      </div>
      <span className="text-[13px] text-ink-2" aria-live="polite">
        {meta}
      </span>

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
          <span className="leading-[1.5]">{q ? `Nothing in the catalog matches “${q}”.` : 'Nothing in the catalog matches these filters.'}</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="ink" size="sm" onClick={onScan}>
              Scan the label instead
            </Button>
            <Button variant="outline" size="sm" onClick={onManual}>
              Add it yourself
            </Button>
          </div>
        </div>
      ) : (
        <ul className={`flex flex-col gap-2 transition-opacity ${state.status === 'loading' ? 'opacity-60' : ''}`}>
          {state.products.map((p, i) => {
            const has = inRoutine.has(p.product_id)
            return (
              <li key={p.product_id}>
                <button
                  type="button"
                  disabled={has}
                  onClick={() => onPick(p)}
                  className="flex w-full items-center gap-3.5 rounded-[24px] bg-sunken p-3 text-left transition-colors hover:bg-muted disabled:opacity-70"
                  style={{ animation: `wRise .35s ${Math.min(i, 10) * 40}ms both` }}
                >
                  <CategoryOrb category={p.category} size={50} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] text-ink-2">
                      {p.brand} · {categoryLabel(p.category)}
                    </span>
                    <span className="text-[16px] leading-snug">{p.name}</span>
                  </span>
                  <span className="text-right text-[14px] whitespace-nowrap">{has ? '✓ In routine' : fmtPrice(p.price)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {n > 0 ? (
        <button type="button" onClick={onManual} className="min-h-11 self-start text-[14px] text-ink-2 underline underline-offset-4">
          Not here? Add it yourself
        </button>
      ) : null}
    </div>
  )
}

function LabelScanner({ getIdToken, onRead, onSearch }: { getIdToken: () => Promise<string>; onRead: (d: Draft) => void; onSearch: () => void }) {
  const [status, setStatus] = useState<'idle' | 'reading' | 'failed'>('idle')
  const [failure, setFailure] = useState('')

  const read = async (files: File[]) => {
    if (!files.length) return
    setStatus('reading')
    try {
      const token = await getIdToken()
      const images = await Promise.all(files.slice(0, 2).map(labelImage))
      const res = await api.labelScan(token, images)
      if (res.match) {
        const product = await api.catalogProduct(token, res.match.product_id)
        onRead(fromProduct(product, 'label_scan', { confidence: res.scan.confidence, matched: true }))
      } else {
        onRead({
          product_id: null,
          brand: res.scan.brand ?? '',
          name: res.scan.product_name ?? '',
          category: res.scan.category || 'other',
          key_actives: res.scan.key_actives,
          inci: res.scan.inci,
          concerns: [],
          source: 'label_scan',
          scan: { confidence: res.scan.confidence, matched: false },
        })
      }
    } catch (e) {
      setFailure(scanError(e))
      setStatus('failed')
    }
  }

  const reading = status === 'reading'
  const corner = 'absolute size-9 border-white'
  return (
    <div className="flex flex-col gap-4">
      <div
        className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[32px] squircle"
        style={{ background: 'radial-gradient(60% 60% at 50% 50%, rgba(255,178,122,.6), transparent 70%), radial-gradient(50% 50% at 30% 70%, rgba(242,95,168,.45), transparent 70%), #F3EEE9' }}
      >
        <span className="absolute top-[18px] left-5 font-mono text-[11px] tracking-[.06em] text-ink-2">LABEL PHOTO</span>
        <span aria-hidden className={`${corner} top-[14%] left-[18%] rounded-tl-[14px] border-t-2 border-l-2`} />
        <span aria-hidden className={`${corner} top-[14%] right-[18%] rounded-tr-[14px] border-t-2 border-r-2`} />
        <span aria-hidden className={`${corner} bottom-[14%] left-[18%] rounded-bl-[14px] border-b-2 border-l-2`} />
        <span aria-hidden className={`${corner} right-[18%] bottom-[14%] rounded-br-[14px] border-r-2 border-b-2`} />
        {reading ? <span aria-hidden className="absolute inset-x-[18%] h-[3px] rounded-[3px] bg-white shadow-[0_0_24px_6px_rgba(255,255,255,.8)] motion-safe:animate-[rtScan_1.1s_ease-in-out_infinite_alternate]" style={{ top: '48%' }} /> : null}
        <span aria-live="polite" className="glass-pill relative rounded-pill px-[18px] py-3 text-center text-[16px]">
          {reading ? 'Reading the label…' : status === 'failed' ? 'Couldn’t read the label' : 'Point at the ingredient list'}
        </span>
      </div>

      {reading ? (
        <p role="status" className="text-[14px] leading-[1.5] text-ink-2">
          Gemini is reading the ingredient list and Willow is looking for it in the catalog. This takes a few seconds.
        </p>
      ) : status === 'failed' ? (
        <p role="alert" className="rounded-md bg-cta px-[18px] py-3.5 leading-[1.5]">
          {failure}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 text-[15px]">
          <span>○ Whole ingredient list in frame</span>
          <span>○ Label flat, no glare on the text</span>
          <span>○ Up to 2 photos: front and ingredient list</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <label className={`${reading ? 'pointer-events-none opacity-55' : 'cursor-pointer'} relative flex min-h-[54px] flex-1 items-center justify-center rounded-pill bg-selected px-5 text-[15px] text-inverse focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-focus`}>
          {reading ? 'Scanning…' : status === 'failed' ? 'Try again' : 'Take label photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={reading}
            className="sr-only"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              void read(files)
            }}
          />
        </label>
        <label className={`${reading ? 'pointer-events-none opacity-55' : 'cursor-pointer'} relative flex min-h-[54px] items-center justify-center rounded-pill bg-white px-5 text-[15px] shadow-[inset_0_0_0_1px_var(--line-subtle)] focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-focus`}>
          Choose photos
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={reading}
            className="sr-only"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              void read(files)
            }}
          />
        </label>
        {status === 'failed' ? (
          <Button variant="outline" size="lg" onClick={onSearch}>
            Search instead
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 text-[13px] text-ink-2">
        <button type="button" disabled={reading} onClick={() => void sampleLabelFile().then((f) => read([f]))} className="min-h-11 self-start text-ink underline underline-offset-4 disabled:opacity-50">
          No product to hand? Try a sample label
        </button>
        <span>Label photos are used only to read the ingredients and are not kept. Up to 30 scans a day.</span>
      </div>
    </div>
  )
}

function Confirm({ draft, setDraft, when, setWhen, startedAt, setStartedAt, saving, saveError, onSave }: { draft: Draft; setDraft: (d: Draft) => void; when: When; setWhen: (w: When) => void; startedAt: string; setStartedAt: (d: string) => void; saving: boolean; saveError: string | null; onSave: () => void }) {
  const matched = draft.product_id !== null
  const custom = !matched
  const field = 'min-h-[50px] rounded-[16px] bg-canvas px-3.5 text-[16px] text-ink outline-none read-only:text-ink-2 focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]'
  const note = matched
    ? draft.scan
      ? `Catalog match: ${draft.brand} ${draft.name}. Catalog facts are used over anything read from the label.`
      : 'From the catalog: ingredients, price and store links come from there.'
    : draft.source === 'label_scan'
      ? 'No catalog match. This will be saved as your own product. Check what was read from the label and correct the name if it is wrong.'
      : 'Not in the catalog. Saved as your own product with the details you give.'
  const canSave = Boolean(draft.name.trim()) && !saving

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-[18px] px-4 py-3 text-[14px] leading-[1.45]" style={{ background: matched ? 'var(--action-tag)' : 'var(--action-primary)' }}>
        {note}
      </p>
      {draft.scan ? (
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <AITag label="AI-read" />
          Label read with {draft.scan.confidence} confidence{draft.scan.confidence === 'low' ? ': parts were hard to read, so check the details against the bottle.' : '.'}
        </span>
      ) : null}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
          Brand
          <input type="text" value={draft.brand} readOnly={matched} maxLength={80} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
          Product name
          <input type="text" value={draft.name} readOnly={matched} maxLength={120} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} />
        </label>
      </div>
      {custom ? (
        <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
          Category
          <select value={CATEGORY_LABEL[draft.category] ? draft.category : 'other'} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={`${field} appearance-none`}>
            {Object.entries(CATEGORY_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {draft.inci.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] text-ink-2">{matched ? 'Ingredients · from catalog' : 'Ingredients · read from your label photo'}</span>
          <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-[16px] bg-canvas p-3">
            {draft.inci.map((ing, i) => (
              <span key={`${ing}-${i}`} className="rounded-pill bg-white px-2.5 py-1 text-[13px]">
                {ing}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {draft.key_actives.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[14px] text-ink-2">Key actives</span>
          {draft.key_actives.map((a) => (
            <span key={a.name} className="rounded-pill bg-lime px-3 py-1 text-[13px]">
              {activeLabel(a)}
            </span>
          ))}
        </div>
      ) : null}

      {custom ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] text-ink-2">What do you use it for? (links it to the right measurements)</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Concerns">
            {Object.entries(CONCERN_LABEL).map(([id, label]) => (
              <Chip key={id} selected={draft.concerns.includes(id)} onToggle={() => setDraft({ ...draft, concerns: draft.concerns.includes(id) ? draft.concerns.filter((c) => c !== id) : [...draft.concerns, id] })}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3.5">
        <div className="flex flex-col gap-1.5">
          <span id="when-label" className="text-[14px] text-ink-2">
            When you use it
          </span>
          <div role="radiogroup" aria-labelledby="when-label" className="flex gap-[3px] rounded-pill bg-canvas p-[5px]">
            {WHEN.map((w) => (
              <button
                key={w.value}
                type="button"
                role="radio"
                aria-checked={when === w.value}
                onClick={() => setWhen(w.value)}
                className={`min-h-11 rounded-pill px-[18px] text-[15px] transition-colors ${when === w.value ? 'bg-selected text-inverse' : 'text-ink'}`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
          Start date
          <input type="date" value={startedAt} max={localDay()} onChange={(e) => setStartedAt(e.target.value)} className={`${field} min-h-[54px]`} />
        </label>
      </div>
      <p className="-mt-1 text-[13px] text-ink-2">The start date is what lines this product up with your readings.</p>

      {saveError ? (
        <p role="alert" className="rounded-[18px] bg-avoid-bg px-4 py-3 text-[14px] text-avoid">
          {saveError}
        </p>
      ) : null}
      <button type="button" onClick={onSave} disabled={!canSave} aria-busy={saving} className="min-h-[58px] rounded-[24px] bg-selected text-[16px] text-inverse">
        {saving ? 'Saving…' : 'Save to routine'}
      </button>
    </div>
  )
}
