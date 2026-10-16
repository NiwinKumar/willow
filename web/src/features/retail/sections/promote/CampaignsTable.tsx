import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

import type { Campaign } from '../../../../lib/api'
import { audienceText, ctrText, dateRange, HOLDOUT_MIN, timeLeft } from '../../promote'
import { DataTable, int, LiftValue, ProductCell, useTooltip, type Column } from '../../ui'
import { StatusBadge } from './CampaignCard'
import { useCampaignActions } from './useCampaignActions'

/*
 * The campaigns as one table (Geist Table): product, status with days left, audience, reach, adds to routine and
 * the lift over the randomised holdout ("Collecting" until both groups have 10 people). Clicks, CTR, holdout and
 * dates are optional columns. A row opens the campaign's side panel; the ⋯ menu pauses, resumes or deletes.
 */

const STATUS_ORDER: Record<Campaign['status'], number> = { active: 0, paused: 1, ended: 2 }

/** A header with its definition in a tooltip (the brief: definitions live in column headers, not running text). */
export function HeadTip({ label, tip }: { label: string; tip: ReactNode }) {
  const t = useTooltip(tip)
  return (
    <>
      <span {...t.trigger} tabIndex={0} className="cursor-help underline decoration-line-strong decoration-dotted underline-offset-4">
        {label}
      </span>
      {t.node}
    </>
  )
}

export function CampaignsTable({ campaigns, heading, toolbar, highlight, onOpen, onDelete, onChanged, onDeleted, onStale, workspaceOf }: {
  campaigns: Campaign[]
  heading: ReactNode
  toolbar?: ReactNode
  highlight: string | null
  onOpen: (id: string) => void
  /** Open the campaign's panel with the delete confirmation showing. */
  onDelete: (id: string) => void
  onChanged: (c: Campaign) => void
  onDeleted: (id: string) => void
  onStale: () => void
  /** "COSRX’s workspace" for a campaign from another workspace (null: this one). */
  workspaceOf: (c: Campaign) => string | null
}) {
  const rows = [...campaigns].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.created_at.localeCompare(a.created_at))
  const columns: Column<Campaign>[] = [
    {
      id: 'product',
      header: 'Product',
      rowHeader: true,
      width: '29%',
      sortValue: (c) => c.product ?? c.product_id,
      firstDir: 'asc',
      cell: (c) => {
        const other = workspaceOf(c)
        return <ProductCell p={{ product: c.product ?? c.product_id, brand: c.brand ?? '', category: c.category ?? '', image_url: c.image_url }} sub={other ? `· ${other}` : undefined} />
      },
      csv: (c) => `${c.product ?? c.product_id} (${c.brand ?? ''})`,
    },
    {
      id: 'status',
      header: 'Status',
      width: '200px',
      sortValue: (c) => STATUS_ORDER[c.status],
      firstDir: 'asc',
      cell: (c) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <StatusBadge status={c.status} />
          <span className="truncate text-proof-small text-ink-2">{c.status === 'ended' ? '' : timeLeft(c)}</span>
        </span>
      ),
      csv: (c) => `${c.status} · ${timeLeft(c)}`,
    },
    {
      id: 'audience',
      header: 'Audience',
      optional: true,
      cell: (c) => {
        const text = audienceText(c.goals, c.skin_types)
        return (
          <span className="block truncate text-proof-small text-ink-2" title={text}>
            {text}
          </span>
        )
      },
      csv: (c) => audienceText(c.goals, c.skin_types),
    },
    {
      id: 'reach',
      header: <HeadTip label="Reach" tip="Impressions: the card at least half on screen, each person counted once a day." />,
      headerText: 'Reach (impressions)',
      align: 'right',
      width: '88px',
      sortValue: (c) => c.stats.impressions,
      cell: (c) => <span className="text-ink tnum">{int(c.stats.impressions)}</span>,
    },
    {
      id: 'clicks',
      header: 'Clicks',
      align: 'right',
      width: '80px',
      optional: true,
      hidden: true,
      sortValue: (c) => c.stats.clicks,
      cell: (c) => <span className="text-ink tnum">{int(c.stats.clicks)}</span>,
    },
    {
      id: 'ctr',
      header: 'CTR',
      align: 'right',
      width: '72px',
      optional: true,
      hidden: true,
      sortValue: (c) => c.stats.ctr,
      cell: (c) => <span className="text-ink tnum">{ctrText(c.stats.ctr)}</span>,
    },
    {
      id: 'adds',
      header: <HeadTip label="Adds" tip="Added to the routine from the card, each person once a day." />,
      headerText: 'Adds to routine',
      align: 'right',
      width: '76px',
      sortValue: (c) => c.stats.adds,
      cell: (c) => <span className="text-ink tnum">{int(c.stats.adds)}</span>,
    },
    {
      id: 'holdout',
      header: 'Holdout',
      align: 'right',
      width: '84px',
      optional: true,
      hidden: true,
      sortValue: (c) => c.holdout_pct ?? 0.2,
      cell: (c) => <span className="text-ink-2 tnum">{Math.round((c.holdout_pct ?? 0.2) * 100)}%</span>,
    },
    {
      id: 'dates',
      header: 'Dates',
      width: '132px',
      optional: true,
      hidden: true,
      sortValue: (c) => c.starts_at,
      cell: (c) => <span className="whitespace-nowrap text-proof-small text-ink-2 tnum">{dateRange(c.starts_at, c.ends_at)}</span>,
    },
    {
      id: 'lift',
      header: <HeadTip label="Incremental lift" tip={`Adoption among people who could see the card minus adoption in the randomised holdout, who never see it. Shown once both groups have ${HOLDOUT_MIN} people; hover a figure for its 95% interval.`} />,
      headerText: 'Incremental lift vs holdout',
      align: 'right',
      width: '212px',
      sortValue: (c) => c.stats.incrementality?.lift ?? null,
      cell: (c) => {
        const inc = c.stats.incrementality
        if (!inc)
          return (
            <span className="whitespace-nowrap text-proof-small text-ink-2">
              Collecting<span className="max-[1279px]:hidden"> · needs {HOLDOUT_MIN} per group</span>
            </span>
          )
        return (
          <span className="inline-flex items-baseline justify-end gap-2 whitespace-nowrap">
            <LiftValue lift={inc.lift} lo={inc.lift_lo} hi={inc.lift_hi} />
            <span className="text-proof-label text-ink-2 tnum">
              n={int(inc.exposed.n)}/{int(inc.holdout.n)}
            </span>
          </span>
        )
      },
      csv: (c) => c.stats.incrementality?.lift ?? 'collecting',
    },
    {
      id: 'menu',
      header: <span className="sr-only">Actions</span>,
      headerText: 'Actions',
      align: 'right',
      width: '60px',
      noCsv: true,
      cell: (c) => <RowMenu c={c} onOpen={onOpen} onDelete={onDelete} onChanged={onChanged} onDeleted={onDeleted} onStale={onStale} />,
    },
  ]
  return (
    <DataTable
      caption="Campaigns"
      heading={heading}
      toolbar={toolbar}
      columns={columns}
      columnsKey="campaigns"
      rows={rows}
      rowKey={(c) => c.id}
      onRowClick={(c) => onOpen(c.id)}
      rowLabel={(c) => `Open campaign for ${c.product ?? c.product_id}`}
      minWidth={980}
      rowClassName={(c) => `cmp-row-${c.id} ${highlight === c.id ? '!bg-proof-leaf-soft' : ''} [transition:background-color_.8s_ease]`}
    />
  )
}

/** ⋯ on a row: Open, Pause or Resume, Delete (which opens the panel to confirm). Esc or a click outside closes it. */
function RowMenu({ c, onOpen, onDelete, onChanged, onDeleted, onStale }: { c: Campaign; onOpen: (id: string) => void; onDelete: (id: string) => void; onChanged: (c: Campaign) => void; onDeleted: (id: string) => void; onStale: () => void }) {
  // The menu is portalled with fixed coordinates, so the table's scroll box never clips it.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const open = at !== null
  const setOpen = (v: boolean) => {
    const r = button.current?.getBoundingClientRect()
    setAt(v && r ? { top: r.bottom + 4, left: Math.max(8, r.right - 176) } : null)
  }
  const box = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const actions = useCampaignActions(c, { onChanged, onDeleted, onStale })
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(false)
    const scroll = (e: Event) => !menu.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', scroll)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', scroll)
    }
  }, [open])
  const run = (f: () => void) => {
    setOpen(false)
    f()
  }
  const status = async (s: 'active' | 'paused') => {
    const err = await actions.setStatus(s)
    if (err) toast(err.title, { description: [err.message, ...err.reasons].join(' ') })
    else toast(s === 'paused' ? `Paused · ${c.product}` : `Resumed · ${c.product}`)
  }
  const item = 'flex h-9 w-full items-center rounded-ctl border-0 bg-transparent px-2.5 text-left text-proof-body text-ink hover:bg-pf-hover focus-visible:bg-pf-hover focus-visible:outline-none disabled:opacity-50'
  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
  return (
    // Clicks and keys inside the menu never reach the row (which would open the panel).
    <div ref={box} className="relative inline-flex" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${c.product ?? 'this campaign'}`}
        disabled={actions.busy !== null}
        onClick={() => setOpen(!open)}
        className="hit44 grid size-8 place-items-center rounded-ctl border-0 bg-transparent text-ink-2 transition-colors hover:bg-pf-hover hover:text-ink disabled:opacity-50"
      >
        <MoreHorizontal size={16} strokeWidth={1.8} aria-hidden />
      </button>
      {at
        ? createPortal(
            <div ref={menu} role="menu" aria-label={`Actions for ${c.product ?? 'this campaign'}`} onKeyDown={onMenuKey} onClick={(e) => e.stopPropagation()} style={{ top: at.top, left: at.left }} className="fixed z-[60] flex w-44 flex-col rounded-card border border-line bg-surface p-1 text-left shadow-[0_0_0_1px_var(--line-subtle),0_16px_24px_-8px_rgba(0,0,0,.12)] animate-[wFadeIn_.12s_ease_both]">
              <button type="button" role="menuitem" className={item} onClick={() => run(() => onOpen(c.id))}>
                View details
              </button>
              {c.status === 'active' ? (
                <button type="button" role="menuitem" className={item} onClick={() => run(() => void status('paused'))}>
                  Pause
                </button>
              ) : c.status === 'paused' ? (
                <button type="button" role="menuitem" className={item} onClick={() => run(() => void status('active'))}>
                  Resume
                </button>
              ) : null}
              <button type="button" role="menuitem" className={`${item} text-pf-red`} onClick={() => run(() => onDelete(c.id))}>
                Delete…
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
