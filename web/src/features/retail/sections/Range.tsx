import { Check, Download, FileSpreadsheet, PackagePlus, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { api, ApiError, uploadShelfStock } from '../../../lib/api'
import { useAuth } from '../../../lib/useAuth'
import { useRetailData } from '../context'
import { useOrg } from '../org'
import { useProducts } from '../productData'
import { canAct } from '../proofApi'
import { coverage, coverageSentence, ItemFileError, itemTemplate, matchRows, readItemFile, STATUS_HINT, STATUS_LABEL, STATUS_ORDER, statusOf, stockCsv, type MatchedRow, type RangeStatus } from '../range'
import { useRange, type StoredRange } from '../rangeStore'
import { purposeOf, sectionPath, useRetailState } from '../state'
import type { ProductRow } from '../types'
import { Badge, Bone, Button, DataTable, ErrorState, int, PageHeader, Panel, ProductCell, ProofTierChip, Tabs, type Column } from '../ui'
import { ProductsNav } from './ProductsNav'

/*
 * Range (/retail/range), research/finals/06 §6.3: "Connect your range" in three steps. 1 Source: the retailer
 * uploads its item file (CSV: gtin, product_id or brand + product, category, price, facings); a brand's range
 * arrives from the retailer's item file, filtered to its brand. 2 Match: each row against the measured catalog →
 * Measured / Collecting / In range, no users yet / Not measured by Willow / Not recognised. 3 Coverage: one
 * sentence with the real counts. Unrecognised rows go to the product-request queue; facings, when the file has
 * them, also feed the Shelf check. Production would read a feed (GS1, Shopify, a nightly SFTP drop); the CSV is
 * the same step by hand.
 */

type Row = MatchedRow & { p: ProductRow | null }
const STATUS_TONE: Record<RangeStatus, 'green' | 'amber' | 'gray' | 'outline' | 'red'> = { measured: 'green', collecting: 'amber', no_users: 'gray', not_measured: 'outline', unrecognised: 'red' }

export default function Range() {
  const { filters, workspace } = useRetailData()
  const { org, lockedBrand } = useOrg()
  const { state, retry } = useProducts(filters)
  const catalog = useMemo(() => (state.status === 'ready' ? state.d.products : []), [state])
  const { range } = useRange()
  const brand = lockedBrand ?? (workspace.kind === 'brand' ? workspace.brand : null)

  if (state.status === 'loading')
    return (
      <div className="flex flex-col gap-6">
        <Bone className="h-8 w-48" />
        <Bone className="h-11 w-full" />
        <Bone className="h-40 w-full" />
      </div>
    )
  if (state.status !== 'ready') return <ErrorState title="The catalog couldn’t load" body="Matching needs the measured catalog. No partial counts are shown." onRetry={retry} />

  // A brand's range is its own catalog products (from the retailer's item file, filtered to the brand).
  const brandRange: StoredRange | null = brand
    ? { filename: `${org?.name ?? brand} in the retailer’s item file`, at: '', source: 'catalog', rows: catalog.filter((p) => p.brand === brand).map((p, i) => ({ line: i + 2, gtin: '', productId: p.product_id, brand: p.brand, name: p.product, category: p.category_label, price: '', facings: '', match: p.product_id, status: statusOf(p) })) }
    : null
  const current = brandRange ?? range
  return <Body catalog={catalog} current={current} brand={brand} canUpload={!brand} />
}

function Body({ catalog, current, brand, canUpload }: { catalog: ProductRow[]; current: StoredRange | null; brand: string | null; canUpload: boolean }) {
  const { save, clear } = useRange()
  const { role, org } = useOrg()
  const { getIdToken, user, continueAsGuest } = useAuth()
  const { carry, param, setParam } = useRetailState()
  const navigate = useNavigate()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'file' | 'request' | null>(null)
  const byId = useMemo(() => new Map(catalog.map((p) => [p.product_id, p])), [catalog])
  // Statuses are re-read from today's catalog rows, so the range follows the data as it moves.
  const rows: Row[] = useMemo(() => (current?.rows ?? []).map((r) => { const p = r.match ? (byId.get(r.match) ?? null) : null; return { ...r, p, status: p ? statusOf(p) : r.match ? r.status : 'unrecognised' } }), [current, byId])
  const cov = coverage(rows)
  const allowed = canAct(role) || !org
  const status = STATUS_ORDER.find((s) => s === param('status')) ?? null
  const shown = status ? rows.filter((r) => r.status === status) : rows

  const download = () => {
    const url = URL.createObjectURL(new Blob([itemTemplate(catalog)], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'proof-item-file-template.csv' })
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast('Template downloaded · every catalog product, with gtin, price and facings to fill in')
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 400_000) return toast.error('Keep the file under 400 KB (500 rows).')
    setBusy('file')
    try {
      const items = readItemFile(await f.text())
      const matched = matchRows(items, catalog)
      save({ filename: f.name, at: new Date().toISOString(), source: 'file', rows: matched })
      const c = coverage(matched)
      toast(`Range connected · ${c.matched} matched${c.unrecognised ? `, ${c.unrecognised} not recognised` : ''}`)
      // Facings in the file feed the Shelf check (the existing stock upload).
      const stock = stockCsv(matched)
      if (stock) {
        try {
          if (!user) await continueAsGuest()
          await uploadShelfStock(await getIdToken(), f.name, stock)
          toast('Facings sent to the Shelf check')
        } catch {
          toast.error('The range is connected; the facings couldn’t reach the Shelf check. Upload them there.')
        }
      }
    } catch (e) {
      toast.error(e instanceof ItemFileError ? e.message : 'Couldn’t read that file. Save it as CSV and try again.')
    } finally {
      setBusy(null)
      if (file.current) file.current.value = ''
    }
  }

  const useCatalog = () => {
    save({ filename: 'The whole Willow catalog', at: new Date().toISOString(), source: 'catalog', rows: catalog.map((p, i) => ({ line: i + 2, gtin: '', productId: p.product_id, brand: p.brand, name: p.product, category: p.category_label, price: '', facings: '', match: p.product_id, status: statusOf(p) })) })
    toast(`Range set to the whole catalog · ${catalog.length} products`)
  }

  const unrec = rows.filter((r) => r.status === 'unrecognised' && r.brand && r.name)
  const requestAll = async () => {
    setBusy('request')
    let ok = 0
    let had = 0
    try {
      if (!user) await continueAsGuest()
      const t = await getIdToken()
      for (const r of unrec.slice(0, 20)) {
        try {
          await api.requestProduct(t, { brand: r.brand, name: r.name })
          ok++
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) had++
          else throw e
        }
      }
      toast(`${ok} ${ok === 1 ? 'product' : 'products'} sent to the product-request queue${had ? `; ${had} already in the catalog` : ''}`)
    } catch (e) {
      toast.error(e instanceof ApiError && e.message ? e.message : 'The requests couldn’t be sent. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<Row>[] = [
    {
      id: 'product',
      header: 'Product',
      rowHeader: true,
      sortValue: (r) => r.p?.product ?? r.name,
      firstDir: 'asc',
      cell: (r) => (r.p ? <ProductCell p={r.p} /> : <span className="flex min-w-0 flex-col"><span className="truncate font-medium text-ink">{r.name || r.productId || `Row ${r.line}`}</span><span className="truncate text-proof-label text-ink-2">{r.brand || 'No brand given'}</span></span>),
      csv: (r) => `${r.p?.product ?? r.name} (${r.p?.brand ?? r.brand})`,
    },
    {
      id: 'status',
      header: 'Status',
      width: '200px',
      sortValue: (r) => STATUS_ORDER.indexOf(r.status),
      firstDir: 'asc',
      cell: (r) => (
        <span title={STATUS_HINT[r.status]}>
          <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        </span>
      ),
      csv: (r) => STATUS_LABEL[r.status],
    },
    { id: 'tier', header: 'Proof tier', width: '172px', cell: (r) => (r.p && r.status === 'measured' ? <ProofTierChip tier={r.p.tier} size="sm" /> : <span className="text-ink-3">—</span>), csv: (r) => (r.p && r.status === 'measured' ? r.p.tier : '') },
    { id: 'n', header: 'People at week 8', align: 'right', width: '132px', sortValue: (r) => r.p?.n ?? null, cell: (r) => <span className="tnum">{r.p?.n !== null && r.p?.n !== undefined ? int(r.p.n) : r.p?.users ? `${int(r.p.users)} using` : '—'}</span>, csv: (r) => r.p?.n ?? '' },
    { id: 'gtin', header: 'GTIN', optional: true, width: '140px', cell: (r) => <span className="font-mono text-proof-small text-ink-2">{r.gtin || '—'}</span>, csv: (r) => r.gtin },
    { id: 'facings', header: 'Facings', optional: true, hidden: !rows.some((r) => r.facings), align: 'right', width: '96px', cell: (r) => <span className="tnum">{r.facings || '—'}</span>, csv: (r) => r.facings },
  ]

  if (!current)
    return (
      <div className="flex flex-col gap-6">
        <ProductsNav />
        <PageHeader title="Connect your range" description="Proof doesn’t know which products you sell yet, so every view shows the whole catalog." purpose={purposeOf('range')} />
        <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-3">
          {[
            { t: 'Source', b: 'Your item file as CSV: gtin, product_id or brand + product, category, price, facings. The template lists every catalog product.' },
            { t: 'Match', b: 'Each row is matched to the measured catalog by Willow id, or brand and name. Barcodes are kept for your records.' },
            { t: 'Coverage', b: 'One line says what is measured, collecting or new; unrecognised rows go to the product-request queue.' },
          ].map((s, i) => (
            <li key={s.t} className="flex gap-3 rounded-card border border-line bg-surface p-5 animate-[proofPage_.28s_var(--ease-standard)_both]" style={{ animationDelay: `${i * 50}ms` }}>
              <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-proof-leaf-soft text-proof-label font-medium text-proof-leaf tnum">
                {i + 1}
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-proof-body font-medium text-ink">{s.t}</span>
                <span className="text-proof-small text-ink-2">{s.b}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="primary" onClick={() => file.current?.click()} disabled={!allowed || busy !== null} title={allowed ? undefined : 'An analyst or admin connects the range'}>
            <Upload size={15} strokeWidth={1.7} aria-hidden /> {busy === 'file' ? 'Reading…' : 'Upload item file'}
          </Button>
          <Button onClick={download}>
            <Download size={15} strokeWidth={1.7} aria-hidden /> Download template
          </Button>
          <Button kind="ghost" onClick={useCatalog} disabled={!allowed}>
            Use the whole catalog
          </Button>
        </div>
        <p className="m-0 text-proof-small text-ink-2">In production the range arrives by feed (GS1, Shopify or a nightly file drop); the upload is the same step by hand. The file stays in this browser until the range api lands.</p>
        <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Upload an item file (CSV)" onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
    )

  return (
    <div className="flex flex-col gap-6">
      <ProductsNav />
      <PageHeader
        title={brand ? `${brand} range` : 'Your range'}
        description={<strong>{coverageSentence(cov)}</strong>}
        purpose={purposeOf('range')}
        actions={
          canUpload ? (
            <>
              <Button onClick={download}>
                <Download size={15} strokeWidth={1.7} aria-hidden /> Template
              </Button>
              <Button kind="primary" onClick={() => file.current?.click()} disabled={!allowed || busy !== null}>
                <Upload size={15} strokeWidth={1.7} aria-hidden /> {busy === 'file' ? 'Reading…' : 'Replace item file'}
              </Button>
            </>
          ) : (
            <Button kind="primary" onClick={() => navigate(`${sectionPath('products')}${carry}`)}>
              See how they do
            </Button>
          )
        }
      />
      <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Upload an item file (CSV)" onChange={(e) => void onFile(e.target.files?.[0])} />

      <section aria-label="Connect your range" className="grid grid-cols-1 overflow-hidden rounded-card border border-line bg-surface md:grid-cols-3">
        <Step n={1} title="Source" done>
          <span className="flex items-center gap-1.5 text-ink">
            <FileSpreadsheet size={14} strokeWidth={1.7} aria-hidden className="text-ink-2" /> <span className="truncate">{current.filename}</span>
          </span>
          <span>{current.at ? `Connected ${new Date(current.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${int(rows.length)} rows` : `${int(rows.length)} products, confirmed by the brand`}</span>
          {canUpload && current.source === 'file' ? (
            <button type="button" onClick={clear} className="hit44 inline-flex items-center gap-1 self-start border-0 bg-transparent p-0 text-proof-small text-ink-2 hover:text-ink">
              <Trash2 size={13} strokeWidth={1.7} aria-hidden /> Disconnect
            </button>
          ) : null}
        </Step>
        <Step n={2} title="Match" done>
          <MatchBar cov={cov} />
        </Step>
        <Step n={3} title="Coverage" done={cov.measured > 0}>
          <span className="text-ink">
            {int(cov.measured)} of {int(cov.total)} measured
          </span>
          <span>{cov.measured ? 'Every view now defaults to this range.' : 'Nothing measured yet: products need 10 people at week 8.'}</span>
        </Step>
      </section>

      {unrec.length && canUpload ? (
        <Panel title={`${unrec.length} ${unrec.length === 1 ? 'product isn’t' : 'products aren’t'} in the catalog`} id="unrec-h" description="Willow measures only what is in its catalog. Send them to the product-request queue; each is checked and added by hand." actions={<Button onClick={() => void requestAll()} disabled={!allowed || busy !== null}><PackagePlus size={15} strokeWidth={1.7} aria-hidden /> {busy === 'request' ? 'Sending…' : `Request ${Math.min(20, unrec.length)}`}</Button>}>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {unrec.slice(0, 12).map((r) => (
              <li key={r.line} className="rounded-pill border border-line px-2.5 py-0.5 text-proof-small text-ink-2">
                {r.brand} {r.name}
              </li>
            ))}
            {unrec.length > 12 ? <li className="px-1 text-proof-small text-ink-2">+{unrec.length - 12} more</li> : null}
          </ul>
        </Panel>
      ) : null}

      <div className="flex flex-col gap-4">
        <Tabs
          label="Status"
          panelId="range-table"
          value={status ?? 'all'}
          onChange={(v) => setParam({ status: v === 'all' ? null : v })}
          tabs={[{ id: 'all' as const, label: 'All', count: cov.total }, ...STATUS_ORDER.filter((s) => cov[s] > 0).map((s) => ({ id: s, label: STATUS_LABEL[s], count: cov[s] }))]}
        />
        <div id="range-table" role="tabpanel" className="overflow-hidden rounded-card border border-line bg-surface">
          <DataTable
            caption="Your range"
            columns={columns}
            columnsKey="range"
            rows={shown}
            rowKey={(r) => `${r.line}-${r.match ?? r.name}`}
            onRowClick={(r) => {
              if (r.match) navigate(`${sectionPath('products', r.match)}${carry}`)
            }}
            rowLabel={(r) => `${r.p?.product ?? r.name}: ${STATUS_LABEL[r.status]}`}
            defaultSort={{ id: 'status', dir: 'asc' }}
            maxHeight="max(440px, calc(100dvh - 360px))"
            minWidth={760}
            csv={{ name: 'willow-proof-range.csv', meta: [`Proof by Willow range · ${coverageSentence(cov)}`, 'Statuses from the measured catalog; groups under 10 people suppressed.'] }}
            empty="No product with this status."
          />
        </div>
      </div>
    </div>
  )
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3 border-line p-5 [&:not(:last-child)]:border-b md:[&:not(:last-child)]:border-b-0 md:[&:not(:last-child)]:border-r">
      <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full text-proof-label font-medium tnum ${done ? 'bg-proof-leaf text-[var(--bg-canvas)]' : 'bg-proof-leaf-soft text-proof-leaf'}`}>
        {done ? <Check size={13} strokeWidth={3} /> : n}
      </span>
      <span className="flex min-w-0 flex-col gap-1 text-proof-small text-ink-2">
        <span className="text-proof-body font-medium text-ink">{title}</span>
        {children}
      </span>
    </div>
  )
}

/** The match as one stacked bar with a legend (words carry the meaning, colour only repeats it). */
function MatchBar({ cov }: { cov: ReturnType<typeof coverage> }) {
  const tone: Record<RangeStatus, string> = { measured: 'bg-proof-leaf', collecting: 'bg-pf-amber-fill', no_users: 'bg-line-strong', not_measured: 'bg-sunken', unrecognised: 'bg-pf-red' }
  const parts = STATUS_ORDER.filter((s) => cov[s] > 0)
  return (
    <span className="flex flex-col gap-2">
      <span className="flex h-2 w-full overflow-hidden rounded-pill bg-sunken" aria-hidden>
        {parts.map((s) => (
          <span key={s} className={`h-full origin-left animate-[wGrowX_.6s_var(--ease-standard)_both] ${tone[s]}`} style={{ width: `${(cov[s] / Math.max(1, cov.total)) * 100}%` }} />
        ))}
      </span>
      <span className="flex flex-wrap gap-x-3 gap-y-1">
        {parts.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 tnum">
            <span aria-hidden className={`size-2 rounded-full ${tone[s]}`} />
            {int(cov[s])} {STATUS_LABEL[s].toLowerCase()}
          </span>
        ))}
      </span>
    </span>
  )
}

