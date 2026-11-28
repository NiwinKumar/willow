import { ArrowRight, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { toast } from 'sonner'

import { proofError, ROLE_LABEL, verifiedText, type InstanceView, type Membership, type ProofOrg, type Role } from './proofApi'
import { Badge, BrandLogo } from './ui'

/*
 * "Choose how to explore" on a demo instance (and "Explore as another organisation…" from the account menu).
 *
 * The person came to pick a seat: the retailer, or one of ~430 brands. The one thing seen first is the search
 * field (focused), with the retailer and any organisation you already joined pinned above the brands. Brands are
 * A–Z under sticky letter headings with an index rail on the side, each with its logo, so CeraVe is two
 * keystrokes or one glance away. ↑/↓ move, Enter opens, Esc clears the search. Each row says the role you join
 * with and the three verbs that seat is for. Joining shows "Joining…" in place on the row.
 *
 * Four tests (new: logos, index rail, keyboard list): the logo finds a brand faster than its name (1); a list
 * with a search field needs no instructions (2); nothing moves under the pointer, the rail only scrolls (3);
 * rows, radius and type are the kit's (4).
 */

type Row = { org: ProofOrg; group: 'mine' | 'retailer' | 'brands'; letter: string; role: Role; joined: Membership | null }

const VERBS: Record<'retailer' | 'brand', string> = { retailer: 'Stock, question and promote', brand: 'Prove, claim and promote' }

const fold = (t: string) =>
  t
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
const letterOf = (name: string) => {
  const c = fold(name).trim().charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

export function ChooseOrg({ view, memberships, onPick, onSignOut, onCancel, lockup }: { view: InstanceView; memberships: Membership[]; onPick: (id: string) => Promise<void>; onSignOut: () => Promise<void>; onCancel?: () => void; lockup: ReactNode }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const base = useId()

  const pick = async (id: string) => {
    if (busy) return
    setBusy(id)
    try {
      await onPick(id)
    } catch (e) {
      toast.error(proofError(e, 'join that organisation'))
      setBusy(null)
    }
  }

  const all = useMemo<Row[]>(() => {
    const joined = new Map(memberships.map((m) => [m.org_id, m]))
    const role = (o: ProofOrg): Role => joined.get(o.id)?.role ?? (o.kind === 'brand' ? 'analyst' : 'admin')
    const mine = view.orgs.filter((o) => joined.has(o.id))
    const retailer = view.orgs.filter((o) => o.kind === 'retailer' && !joined.has(o.id))
    const brands = view.orgs.filter((o) => o.kind === 'brand' && !joined.has(o.id)).sort((a, b) => fold(a.name).localeCompare(fold(b.name)))
    return [
      ...mine.map((o) => ({ org: o, group: 'mine' as const, letter: '', role: role(o), joined: joined.get(o.id) ?? null })),
      ...retailer.map((o) => ({ org: o, group: 'retailer' as const, letter: '', role: role(o), joined: null })),
      ...brands.map((o) => ({ org: o, group: 'brands' as const, letter: letterOf(o.name), role: role(o), joined: null })),
    ]
  }, [view.orgs, memberships])
  const brandCount = all.filter((r) => r.org.kind === 'brand').length

  const shown = useMemo(() => {
    const s = fold(q.trim())
    if (!s) return all
    // Starts-with first (typing "cer" puts CeraVe before "Skinceramide"), then contains.
    const hit = all.filter((r) => fold(r.org.name).includes(s) || (r.org.kind === 'brand' && r.org.brands.some((b) => fold(b).includes(s))))
    return [...hit.filter((r) => fold(r.org.name).startsWith(s)), ...hit.filter((r) => !fold(r.org.name).startsWith(s))]
  }, [all, q])
  const letters = useMemo(() => [...new Set(all.filter((r) => r.group === 'brands').map((r) => r.letter))], [all])

  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    document.getElementById(`${base}-r-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, base])

  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (shown.length ? Math.max(0, Math.min(shown.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))) : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (shown[active]) void pick(shown[active].org.id)
    } else if (e.key === 'Escape' && q) {
      e.preventDefault()
      setQ('')
      setActive(0)
    }
  }
  const jump = (letter: string) => {
    const el = list.current?.querySelector<HTMLElement>(`[data-letter="${letter}"]`)
    if (el && list.current) list.current.scrollTo({ top: el.offsetTop - 4, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  const searching = q.trim().length > 0
  const heading = (r: Row, i: number): ReactNode => {
    const prev = shown[i - 1]
    if (searching) return i === 0 ? <GroupHead>{`${shown.length} ${shown.length === 1 ? 'match' : 'matches'}`}</GroupHead> : null
    if (r.group !== prev?.group) {
      // Every brand seat is the same (Analyst: prove, claim and promote): said once here, not on 400 rows.
      const label = r.group === 'mine' ? 'Your organisations' : r.group === 'retailer' ? 'The retailer' : `Brands · ${brandCount} · you join as ${ROLE_LABEL.analyst} to ${VERBS.brand.toLowerCase()}`
      return (
        <>
          <GroupHead>{label}</GroupHead>
          {r.group === 'brands' && letters.length > 6 ? <LetterHead letter={r.letter} /> : null}
        </>
      )
    }
    if (r.group === 'brands' && r.letter !== prev?.letter && letters.length > 6) return <LetterHead letter={r.letter} />
    return null
  }

  return (
    <>
      {lockup}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="m-0 text-proof-title text-ink">Choose how to explore</h1>
          <Badge tone="amber">Demo</Badge>
        </div>
        <p className="m-0 max-w-[64ch] text-proof-body text-ink [text-wrap:pretty]">Proof shows which skincare products are linked to a measured, held change in people’s own photos, against people with the same goals who don’t use them.</p>
        <p className="m-0 max-w-[64ch] text-proof-small text-ink-2 [text-wrap:pretty]">
          Pick a seat: the retailer runs its range; a brand proves and promotes its own products. You land on that organisation’s Home and can switch any time from the account menu.
        </p>
      </div>

      <section aria-label="Organisations" className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-raised">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} strokeWidth={1.7} aria-hidden className="shrink-0 text-ink-2" />
          <label htmlFor={`${base}-q`} className="sr-only">
            Search organisations
          </label>
          <input
            id={`${base}-q`}
            ref={input}
            role="combobox"
            aria-expanded
            aria-controls={`${base}-list`}
            aria-activedescendant={shown[active] ? `${base}-r-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
              list.current?.scrollTo({ top: 0 })
            }}
            onKeyDown={key}
            placeholder={`Search ${brandCount} brands or the retailer`}
            className="h-12 min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-2 sm:text-proof-body"
          />
          {q ? (
            <button type="button" onClick={() => (setQ(''), setActive(0), input.current?.focus())} className="hit44 shrink-0 rounded-ctl border-0 bg-transparent px-2 py-1 text-proof-small text-ink-2 hover:bg-pf-hover hover:text-ink">
              Clear
            </button>
          ) : (
            <kbd className="hidden shrink-0 rounded-[4px] border border-line bg-pf-bg2 px-1.5 font-geist text-[11px] text-ink-2 sm:inline">↑↓ Enter</kbd>
          )}
        </div>
        <div className="relative flex min-h-0">
          <div ref={list} id={`${base}-list`} role="listbox" aria-label="Organisations" className="relative max-h-[min(56dvh,520px)] min-h-[240px] flex-1 overflow-y-auto overscroll-contain pb-2">
            {shown.length === 0 ? (
              <div className="flex flex-col items-start gap-1 px-5 py-8">
                <span className="text-proof-body font-medium text-ink">No organisation matches “{q.trim()}”</span>
                <span className="text-proof-small text-ink-2">Check the spelling, or search part of the name (“derma”, “la roche”).</span>
              </div>
            ) : (
              shown.map((r, i) => (
                <div key={r.org.id} role="presentation">
                  {heading(r, i)}
                  <OrgRow id={`${base}-r-${i}`} r={r} active={i === active} busy={busy === r.org.id} disabled={busy !== null} onHover={() => setActive(i)} onPick={() => void pick(r.org.id)} big={r.group !== 'brands' && !searching} searching={searching} />
                </div>
              ))
            )}
          </div>
          {!searching && letters.length > 6 ? (
            <nav aria-label="Jump to letter" className="hidden w-7 shrink-0 flex-col items-center justify-center overflow-y-auto border-l border-line py-2 sm:flex">
              {letters.map((l) => (
                <button key={l} type="button" onClick={() => jump(l)} className="grid h-6 w-6 shrink-0 place-items-center rounded-[4px] border-0 bg-transparent text-[10.5px] font-medium leading-none text-ink-2 transition-colors hover:bg-pf-hover hover:text-ink" aria-label={`Brands starting with ${l}`}>
                  {l}
                </button>
              ))}
            </nav>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-proof-small text-ink-2">
        <span className="min-w-0 [text-wrap:pretty]">Demo memberships are marked as such; campaigns they launch are shown to guest accounts only. In a real deployment the retailer invites you.</span>
        <span className="flex shrink-0 items-center gap-1">
          {onCancel ? (
            <button type="button" onClick={onCancel} className="hit44 rounded-ctl border-0 bg-transparent px-2 py-1 text-proof-small text-ink-2 hover:bg-pf-hover hover:text-ink">
              Back
            </button>
          ) : null}
          <button type="button" onClick={() => void onSignOut()} className="hit44 rounded-ctl border-0 bg-transparent px-2 py-1 text-proof-small text-ink-2 hover:bg-pf-hover hover:text-ink">
            Sign out
          </button>
        </span>
      </div>
    </>
  )
}

function GroupHead({ children }: { children: ReactNode }) {
  return <div className="px-4 pb-1.5 pt-3.5 text-proof-label font-medium text-ink-2">{children}</div>
}

function LetterHead({ letter }: { letter: string }) {
  return (
    <div data-letter={letter} className="sticky top-0 z-[1] border-y border-line bg-pf-bg2/95 px-4 py-1 text-proof-label font-semibold text-ink-2 backdrop-blur-sm">
      {letter}
    </div>
  )
}

function OrgRow({ id, r, active, busy, disabled, onHover, onPick, big, searching }: { id: string; r: Row; active: boolean; busy: boolean; disabled: boolean; onHover: () => void; onPick: () => void; big: boolean; searching: boolean }) {
  const o = r.org
  const basis = verifiedText(o)
  // A brand row is its name and logo; the seat it gives is in the group heading. Joined and retailer rows say theirs.
  const sub = r.joined ? `${o.kind === 'brand' ? 'Brand' : 'Retailer'} · you’re ${ROLE_LABEL[r.role]}` : o.kind === 'retailer' ? `${ROLE_LABEL[r.role]} · ${VERBS.retailer}` : searching ? `Brand · join as ${ROLE_LABEL[r.role]}` : null
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      onPointerMove={onHover}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => !disabled && onPick()}
      className={`group mx-1.5 flex min-h-11 cursor-pointer items-center gap-3 rounded-ctl px-2.5 transition-colors duration-100 ${big ? 'py-2.5' : 'py-1.5'} ${active ? 'bg-pf-hover' : ''} ${disabled && !busy ? 'opacity-60' : ''} active:scale-[.995]`}
    >
      <BrandLogo brand={o.name} src={o.logo_url} kind={o.kind} size={big ? 36 : 28} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-proof-body font-medium text-ink">{o.name}</span>
          {basis && big ? (
            <span title={basis} className="hidden shrink-0 text-proof-label text-proof-leaf sm:inline">
              Verified
            </span>
          ) : null}
        </span>
        {sub ? <span className="truncate text-proof-small text-ink-2">{sub}</span> : null}
      </span>
      <span className={`flex shrink-0 items-center gap-1 text-proof-small font-medium transition-[opacity,translate] duration-150 ${busy ? 'text-ink opacity-100' : active ? 'translate-x-0 text-ink opacity-100' : '-translate-x-1 text-ink-2 opacity-0 group-hover:opacity-100'}`}>
        {busy ? 'Joining…' : r.joined ? 'Open' : 'Join'}
        {busy ? null : <ArrowRight size={14} strokeWidth={1.8} aria-hidden />}
      </span>
    </div>
  )
}
