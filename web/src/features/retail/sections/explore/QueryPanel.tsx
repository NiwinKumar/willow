import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { Segmented } from '../../ui'
import { MultiSelect, type Option } from './MultiSelect'
import { DEFAULT_QUERY, FILTERS, filterCount, GROUPS, groupOf, LIMITS, measureOf, MEASURES, MINS, sameQuery, type FilterId, type Query } from './query'

/**
 * The Explore configuration panel (after Vercel Observability's query view): Measure, Group by, Filters,
 * Minimum people, Sort, Limit, top to bottom, in one bordered column. Sticky beside the chart from 1024 px;
 * below that it sits above the chart, folded into one line that names the current query.
 */
export function QueryPanel({ q, onChange, options }: { q: Query; onChange: (q: Query) => void; options: Record<FilterId, Option[]> }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const nf = filterCount(q)
  const set = (patch: Partial<Query>) => onChange({ ...q, ...patch })
  const setFilter = (id: FilterId, v: string[]) => onChange({ ...q, filters: { ...q.filters, [id]: v } })

  return (
    <aside aria-label="Query" className="flex flex-col rounded-card border border-line bg-surface lg:sticky lg:top-[116px]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-12 w-full items-center gap-2.5 rounded-card border-0 bg-transparent px-4 text-left text-proof-small text-ink hover:bg-pf-hover lg:hidden"
      >
        <SlidersHorizontal size={15} strokeWidth={1.7} aria-hidden className="shrink-0 text-ink-2" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{measureOf(q.measure).label}</span>
          <span className="text-ink-2"> by {groupOf(q.group).label.toLowerCase()}</span>
          {nf ? <span className="text-ink-2"> · {nf === 1 ? '1 filter' : `${nf} filters`}</span> : null}
        </span>
        <ChevronDown size={15} strokeWidth={1.6} aria-hidden className={`shrink-0 text-ink-2 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={bodyId} className={`${open ? 'flex' : 'hidden'} flex-col border-t border-line lg:flex lg:border-t-0`}>
        <Section>
          <Field label="Measure">
            {(id) => <NativeSelect id={id} value={q.measure} onChange={(v) => set({ measure: v as Query['measure'] })} options={MEASURES.map((m) => ({ value: m.id, label: m.label }))} />}
          </Field>
          <Field label="Group by" hint={q.group === 'goal' ? 'A product with several goals counts in each.' : undefined}>
            {(id) => <NativeSelect id={id} value={q.group} onChange={(v) => set({ group: v as Query['group'] })} options={GROUPS.map((g) => ({ value: g.id, label: g.label }))} />}
          </Field>
        </Section>
        <Section title="Filters" tight action={nf ? <TextButton onClick={() => onChange({ ...q, filters: DEFAULT_QUERY.filters })}>Clear</TextButton> : null}>
          {FILTERS.map((f) => (
            <MultiSelect key={f.id} label={f.label} plural={f.plural} options={options[f.id]} value={q.filters[f.id]} onChange={(v) => setFilter(f.id, v)} />
          ))}
        </Section>
        <Section last>
          <Inline label="Minimum people">
            <Segmented label="Minimum people per product" options={MINS.map((m) => ({ value: String(m), label: String(m) }))} value={String(q.min)} onChange={(v) => set({ min: Number(v) as Query['min'] })} />
          </Inline>
          <Inline label="Sort">
            <Segmented
              label="Sort"
              options={[
                { value: 'desc', label: 'High → low' },
                { value: 'asc', label: 'Low → high' },
              ]}
              value={q.dir}
              onChange={(v) => set({ dir: v })}
            />
          </Inline>
          <Inline label="Limit">
            <Segmented label="Limit" options={LIMITS.map((l) => ({ value: String(l), label: l === 'all' ? 'All' : String(l) }))} value={String(q.limit)} onChange={(v) => set({ limit: (v === 'all' ? 'all' : Number(v)) as Query['limit'] })} />
          </Inline>
          {!sameQuery(q, DEFAULT_QUERY) ? (
            <div className="pt-1">
              <TextButton onClick={() => onChange(DEFAULT_QUERY)}>Reset query</TextButton>
            </div>
          ) : null}
        </Section>
      </div>
    </aside>
  )
}

function Section({ title, action, children, last = false, tight = false }: { title?: string; action?: ReactNode; children: ReactNode; last?: boolean; tight?: boolean }) {
  return (
    <div className={`flex flex-col px-4 py-4 ${tight ? 'gap-2.5' : 'gap-4'} ${last ? '' : 'border-b border-line'}`}>
      {title ? (
        <div className="flex h-5 items-center justify-between">
          <h2 className="m-0 text-proof-small font-medium text-ink">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-proof-small text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="m-0 text-proof-label text-ink-2">{hint}</p> : null}
    </div>
  )
}

function Inline({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span aria-hidden className="text-proof-small text-ink-2">
        {label}
      </span>
      {children}
    </div>
  )
}

function NativeSelect({ id, value, options, onChange }: { id: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <span className="relative flex">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full min-w-0 appearance-none truncate rounded-ctl border border-line bg-surface py-0 pl-3 pr-8 text-proof-small text-ink hover:border-line-strong">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} strokeWidth={1.6} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-2" />
    </span>
  )
}

function TextButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="hit44 rounded-ctl border-0 bg-transparent px-1 text-proof-small text-ink-2 hover:text-ink">
      {children}
    </button>
  )
}
