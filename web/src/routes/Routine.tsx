import { AlertTriangle, Camera, Check, CircleAlert, Copy, Info, Octagon, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { Sheet } from '../components/Sheet'
import type { Product, RoutineCheck, RoutineEntry } from '../data/types'
import { useData } from '../data/useData'
import { outcomeFor } from '../lib/outcome'
import { CATALOG, CONCERN_LABEL } from '../mock/catalog'
import { DEMO_CHECK, DEMO_ROUTINE } from '../mock/routine'

const ORDER = ['cleanser', 'toner', 'serum', 'treatment', 'exfoliant', 'moisturizer', 'eye_care', 'mask', 'sunscreen']
const SEVERITY = {
  avoid_same_routine: { label: 'Keep these apart', Icon: Octagon, cls: 'text-warn-text' },
  caution: { label: 'Use with care', Icon: AlertTriangle, cls: 'text-warn-text' },
  info: { label: 'Good to know', Icon: Info, cls: 'text-text-2' },
} as const

export function Routine() {
  const data = useData()
  const navigate = useNavigate()
  const [entries, setEntries] = useState<RoutineEntry[]>(data.mode === 'demo' ? DEMO_ROUTINE : [])
  const [check] = useState<RoutineCheck | null>(data.mode === 'demo' ? DEMO_CHECK : null)
  const [add, setAdd] = useState<'closed' | 'pick' | 'scan' | 'search' | 'confirm'>('closed')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Product | null>(null)
  const [slots, setSlots] = useState<('am' | 'pm')[]>(['pm'])
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [dismissed, setDismissed] = useState<string[]>([])
  const sessions = data.series('face_full')?.sessions ?? []
  const byId = (id: string) => entries.find((e) => e.id === id)
  const name = (e: RoutineEntry) => e.product_id ? (CATALOG.find((p) => p.product_id === e.product_id)?.name ?? e.custom_name) : e.custom_name

  const openConflicts = (check?.conflicts ?? []).filter((c) => !dismissed.includes(c.products.join('+')))
  const worst = openConflicts.some((c) => c.severity === 'avoid_same_routine') ? 'avoid' : openConflicts.some((c) => c.severity === 'caution') ? 'caution' : (check?.gaps.length ?? 0) > 0 ? 'gap' : 'ok'
  const status = entries.length === 0 ? 'Add products to check compatibility' : worst === 'ok' ? 'Looks compatible' : `${openConflicts.length + (check?.gaps.length ?? 0)} ${openConflicts.length + (check?.gaps.length ?? 0) === 1 ? 'thing' : 'things'} to look at`
  const results = useMemo(() => (query.trim().length < 2 ? CATALOG : CATALOG.filter((p) => `${p.brand} ${p.name}`.toLowerCase().includes(query.toLowerCase()))), [query])

  const section = (slot: 'am' | 'pm') => {
    const items = entries.filter((e) => e.slots.includes(slot) && !e.ended_at).sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category))
    return (
      <section aria-labelledby={`slot-${slot}`}>
        <h2 id={`slot-${slot}`} className="border-b border-border pb-1 pt-5 text-[15px] font-semibold text-text-2">{slot === 'am' ? 'Morning' : 'Evening'}</h2>
        {items.length === 0 ? <p className="py-3 text-[13px] text-text-3">Nothing yet.</p> : null}
        <ul className="divide-y divide-border">
          {items.map((e) => {
            const o = outcomeFor(e, sessions)
            const flagged = openConflicts.some((c) => c.products.includes(e.id))
            return (
              <li key={`${slot}-${e.id}`} className="flex items-start gap-3 py-3">
                <span aria-hidden className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-(--radius-control) bg-surface-2 text-[11px] font-medium text-text-2">{e.category.slice(0, 3)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium">{e.brand} {name(e)}</span>
                    {flagged ? <span aria-label="part of a compatibility note" className="h-2 w-2 shrink-0 rounded-full bg-warn" /> : null}
                    {e.slots.length === 2 ? <Chip tone="neutral">AM + PM</Chip> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.key_actives.slice(0, 3).map((a) => (
                      <Chip key={a.name} tone="neutral">{a.name}{a.pct !== null ? ` ${a.pct}%` : ''}</Chip>
                    ))}
                  </div>
                  <button type="button" title={o.detail} onClick={() => (o.kind === 'real' ? navigate(`/s/face_full${data.mode === 'demo' ? '?demo=1' : '?'}&m=${o.metric}&layer=1`) : toast(o.detail))} className="mt-2 inline-flex">
                    <Chip tone={o.kind === 'real' ? 'signal' : o.kind === 'none' ? 'noise' : 'neutral'}>{o.text}</Chip>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  return (
    <div className="mx-auto max-w-[36rem] px-5 pb-20 pt-4 sm:px-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Your routine</h1>
          <p className={`mt-1 text-[15px] ${worst === 'ok' || entries.length === 0 ? 'text-text-2' : 'text-warn-text'}`}>{status}</p>
        </div>
        <Button onClick={() => setAdd('pick')}>
          <Plus size={18} aria-hidden /> Add product
        </Button>
      </div>

      {section('am')}
      {section('pm')}

      <section className="mt-8" aria-labelledby="compat">
        <h2 id="compat" className="text-[17px] font-semibold">Compatibility</h2>
        {check ? <p className="mt-1 text-[12px] text-text-3">Checked against the rule table{check.notes.length ? ` · ${check.notes[0]}` : ''}</p> : <p className="mt-1 text-[13px] text-text-2">Add two products and Willow checks them.</p>}
        <ul className="mt-3 space-y-3">
          {openConflicts.map((c) => {
            const s = SEVERITY[c.severity]
            return (
              <li key={c.products.join('+')} className="rounded-(--radius-tile) border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-2 text-[15px] font-semibold ${s.cls}`}>
                    <s.Icon size={18} aria-hidden /> {s.label}
                  </span>
                  <Chip tone="neutral">{c.source === 'rule' ? 'rule-based' : 'AI-suggested'}</Chip>
                </div>
                <p className="mt-2 text-[15px]">{c.products.map((id) => byId(id)).filter(Boolean).map((e) => `${e!.brand} ${name(e!)} (${e!.slots.map((x) => x.toUpperCase()).join('+')})`).join(' + ')}</p>
                <p className="mt-1 text-[15px] text-text-2">{c.issue}</p>
                <p className="mt-1 text-[15px]"><span className="font-medium">Suggested change:</span> {c.suggestion}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" className="!min-h-10" onClick={() => toast('Applied: alternate nights noted on both products.')}>Apply</Button>
                  <Button variant="quiet" className="!min-h-10" onClick={() => navigate(`/advisor${data.mode === 'demo' ? '?demo=1&' : '?'}q=${encodeURIComponent(`Why should I keep ${c.products.map((id) => name(byId(id)!)).join(' and ')} apart?`)}`)}>Tell me more</Button>
                  {c.source === 'model' ? <Button variant="quiet" className="!min-h-10" onClick={() => setDismissed((d) => [...d, c.products.join('+')])}>Dismiss</Button> : null}
                </div>
              </li>
            )
          })}
          {(check?.duplicates ?? []).map((d) => (
            <li key={d.active} className="rounded-(--radius-tile) border border-border bg-surface p-4">
              <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-text-2"><Copy size={18} aria-hidden /> Same active twice</span>
              <p className="mt-2 text-[15px] text-text-2">{d.active} appears in {d.products.length} products. {d.note}</p>
            </li>
          ))}
          {(check?.gaps ?? []).map((g) => (
            <li key={g.need} className="rounded-(--radius-tile) border border-border bg-surface p-4">
              <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-willow-700"><CircleAlert size={18} aria-hidden /> Missing step</span>
              <p className="mt-2 text-[15px]">{g.need}. <span className="text-text-2">{g.why}</span></p>
              <p className="mt-1 text-[15px]"><span className="font-medium">Suggested change:</span> {g.suggestion}</p>
              <Button variant="secondary" className="mt-3 !min-h-10" onClick={() => { setQuery('SPF'); setAdd('search') }}>Find a sunscreen</Button>
            </li>
          ))}
        </ul>
      </section>

      <Sheet open={add !== 'closed'} onOpenChange={(o) => !o && setAdd('closed')} title={add === 'pick' ? 'Add a product' : add === 'scan' ? 'Scan the label' : add === 'search' ? 'Search the catalog' : 'Check what was read'}>
        {add === 'pick' ? (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setAdd('scan')} className="flex min-h-28 flex-col items-start justify-between rounded-(--radius-tile) border border-border bg-surface p-4 text-left hover:bg-surface-2">
              <Camera size={22} aria-hidden className="text-willow-700" />
              <span><span className="block text-[15px] font-semibold">Scan the label</span><span className="block text-[13px] text-text-2">The ingredient list, usually on the back or the box.</span></span>
            </button>
            <button type="button" onClick={() => setAdd('search')} className="flex min-h-28 flex-col items-start justify-between rounded-(--radius-tile) border border-border bg-surface p-4 text-left hover:bg-surface-2">
              <Search size={22} aria-hidden className="text-willow-700" />
              <span><span className="block text-[15px] font-semibold">Search the catalog</span><span className="block text-[13px] text-text-2">Ingredients, price and store links. No reviews.</span></span>
            </button>
          </div>
        ) : null}
        {add === 'scan' ? (
          <div>
            <p className="text-[15px] text-text-2">Fit the whole ingredient list inside the frame. Label photos are used only to read the ingredients and are not kept.</p>
            <label className="mt-4 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-(--radius-tile) border border-dashed border-border bg-surface-2 text-[15px] text-text-2">
              <Camera size={24} aria-hidden className="mb-2" />
              Take or choose a photo
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={() => { setDraft(CATALOG[7]); setAdd('confirm'); toast(data.mode === 'demo' ? 'Demo: label reading is simulated until Gemini is connected.' : 'Reading the label…') }} />
            </label>
          </div>
        ) : null}
        {add === 'search' ? (
          <div>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Brand or product" className="w-full rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-[16px]" aria-label="Search the catalog" />
            <ul className="mt-3 max-h-[50dvh] divide-y divide-border overflow-y-auto">
              {results.map((p) => (
                <li key={p.product_id}>
                  <button type="button" onClick={() => { setDraft(p); setAdd('confirm') }} className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left">
                    <span><span className="block text-[15px] font-medium">{p.brand} {p.name}</span><span className="block text-[12px] text-text-2">For {p.concerns.map((c) => CONCERN_LABEL[c]).join(', ')}</span></span>
                    <span className="font-mono text-[13px] text-text-2">₹{p.price.amount}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {add === 'confirm' && draft ? (
          <div>
            <p className="text-[13px] text-text-2">Check the name and actives. You can edit anything that was misread.</p>
            <div className="mt-3 space-y-2">
              <input defaultValue={draft.brand} aria-label="Brand" className="w-full rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-[16px]" />
              <input defaultValue={draft.name} aria-label="Product name" className="w-full rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-[16px]" />
              <div className="flex flex-wrap gap-1">
                <Chip tone="neutral">{draft.category}</Chip>
                {draft.key_actives.map((a) => <Chip key={a.name} tone="willow">{a.name}{a.pct !== null ? ` ${a.pct}%` : ''}</Chip>)}
              </div>
              <details className="text-[13px] text-text-2"><summary className="cursor-pointer py-1">Ingredients ({draft.inci.length})</summary><p className="pt-1">{draft.inci.join(', ')}</p></details>
              <p className="text-[13px] text-text-2"><Check size={14} aria-hidden className="mr-1 inline" /> Found in catalog: {draft.brand} {draft.name}</p>
            </div>
            <h3 className="mt-4 text-[15px] font-semibold">When do you use it?</h3>
            <div className="mt-2 flex gap-2" role="group" aria-label="Time of day">
              {(['am', 'pm'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={slots.includes(s)} onClick={() => setSlots((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))} className={`min-h-11 rounded-full border px-4 text-[15px] ${slots.includes(s) ? 'border-text bg-text text-surface' : 'border-border bg-surface'}`}>{s.toUpperCase()}</button>
              ))}
            </div>
            <label className="mt-3 block text-[13px] font-medium">Started on<input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} className="mt-1 block w-full rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-[16px]" /></label>
            <p className="mt-1 text-[12px] text-text-3">The start date is what links this product to your measured outcome.</p>
            <Button className="mt-4" disabled={slots.length === 0} onClick={() => {
              setEntries((e) => [...e, { id: `r${Date.now()}`, product_id: draft.product_id, custom_name: '', brand: draft.brand, category: draft.category, key_actives: draft.key_actives, inci: draft.inci, started_at: startedAt, ended_at: null, slots, concerns: draft.concerns, source: 'catalog' }])
              setAdd('closed')
              toast('Added to your routine. Compatibility rechecked.')
            }}>Add to routine</Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  )
}
