import { Link } from 'react-router-dom'

import { statusOf } from '../range'
import { sectionPath, useRetailState } from '../state'
import type { ProductRow } from '../types'
import { ErrorState, int, pct, pts, TierDot } from '../ui'
import { proofRows } from './dashboard'

/*
 * "How your products compare" (Home, left column): the brand's (or the range's) measured products, each as two
 * dots on one 0–100% track: people using it who saw a visible change by week 8 (leaf, filled) and people with
 * the same goals not using it who changed anyway (grey, hollow), joined by the gap. The gap is the figure.
 * Replaces "Your strongest proof", which repeated one product's page on Home (owner feedback, Nov 28).
 *
 * Four tests: (1) the one comparison Proof exists for, across products at once, which no other Home part shows;
 * (2) a legend in words above the rows and every figure in words on the row ("77% vs 23%", "+54 pts", n), so
 * "why do non-users change?" answers itself: they are people who changed anyway; (3) static, no motion beyond
 * the panel's arrival, nothing over text; (4) kit panel, tier dots, leaf for the product's own mark only.
 */

/** Rows the panel always has: blank rows hold the frame when fewer products are compared (Home is a fixed layout). */
const ROWS = 5

export function ProofPanel({ rows, mix, scopeWord, weeks, brand, className = '', loading = false, onRetry }: { rows: ProductRow[]; mix: 'brand' | 'retailer'; scopeWord: string; weeks: number; brand: string | null; className?: string; loading?: boolean; /** the products could not be read: say so, never "none of your products" */ onRetry?: () => void }) {
  const { carry } = useRetailState()
  const { rows: shown, count } = proofRows(rows, ROWS)
  const title = mix === 'brand' ? 'How your products compare' : `Strongest in ${scopeWord}`
  return (
    <section aria-labelledby="proof-h" className={`flex min-w-0 flex-col rounded-card border border-line bg-surface ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-1 pt-4">
        <h2 id="proof-h" className="m-0 text-proof-h text-ink">
          {title}
        </h2>
        {count ? (
          <Link to={`${sectionPath('products')}${carry}`} className="text-proof-small text-ink-2 no-underline hover:text-ink">
            {shown.length < count ? `Top ${shown.length} of ${int(count)}` : `All ${int(count)}`} →
          </Link>
        ) : null}
      </div>
      {loading ? (
        // the products are still loading: the panel's frame with skeleton rows, never "none of your products"
        <ul aria-hidden className="m-0 flex list-none flex-col p-0 pt-9">
          {Array.from({ length: ROWS }, (_, k) => (
            <li key={k} className="flex h-[65px] items-center gap-4 border-t border-line px-5">
              <span className="retail-shimmer h-3.5 w-[34%] rounded-pill" />
              <span className="retail-shimmer ml-auto h-2 w-[38%] rounded-pill" />
              <span className="retail-shimmer h-3.5 w-12 rounded-pill" />
            </li>
          ))}
        </ul>
      ) : onRetry ? (
        <ErrorState compact title="Products couldn’t load" body="No figures are shown rather than none." onRetry={onRetry} />
      ) : shown.length ? (
        <>
          <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-3 text-proof-small text-ink-2">
            <span>Visible change by week {weeks}:</span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full bg-proof-leaf" /> people using it
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full border-2 border-ink-3 bg-surface" /> same goals, not using it (changed anyway)
            </span>
          </p>
          <div aria-hidden className="hidden grid-cols-[minmax(0,1.1fr)_minmax(140px,1fr)_64px] gap-x-4 px-5 pb-1 text-proof-label text-ink-2 tnum sm:grid">
            <span />
            <span className="flex justify-between">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </span>
            <span className="text-right">Gap</span>
          </div>
          <ul className="m-0 flex list-none flex-col p-0">
            {shown.map((r, i) => (
              <ProofRow key={r.product_id} r={r} i={i} carry={carry} showBrand={mix === 'retailer'} />
            ))}
            {Array.from({ length: ROWS - shown.length }, (_, k) => (
              <li key={`blank-${k}`} className="flex h-[65px] items-center border-t border-line px-5 text-proof-small text-ink-2">
                {k === 0 ? `A product shows here once 10 people using it reach week ${weeks}` : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <NextStep rows={brand ? rows.filter((r) => r.brand === brand) : rows} weeks={weeks} mix={mix} carry={carry} />
      )}
    </section>
  )
}

function ProofRow({ r, i, carry, showBrand }: { r: ProductRow; i: number; carry: string; showBrand: boolean }) {
  const rate = r.rate ?? 0
  const base = r.base_rate ?? 0
  const lo = Math.min(rate, base)
  const hi = Math.max(rate, base)
  const ahead = (r.lift ?? 0) > 0
  const label = `${r.product}: ${pct(rate)} of ${int(r.n)} people using it saw a visible change; ${pct(base)} of people with the same goals not using it changed anyway; a ${pts(r.lift)} gap. ${r.tier_label ?? ''}`
  return (
    <li className="border-t border-line animate-[proofPage_.28s_var(--ease-standard)_both]" style={{ animationDelay: `${i * 30}ms` }}>
      <Link to={`/retail/products/${encodeURIComponent(r.product_id)}${carry}`} aria-label={label} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3 no-underline transition-colors hover:bg-pf-hover sm:grid-cols-[minmax(0,1.1fr)_minmax(140px,1fr)_64px]">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <TierDot tier={r.tier} />
            <span className="truncate text-proof-body font-medium text-ink">{r.product}</span>
          </span>
          <span className="truncate pl-4 text-proof-small text-ink-2 tnum">
            {showBrand ? `${r.brand} · ` : ''}
            {pct(rate)} vs {pct(base)} · n={int(r.n)}
          </span>
        </span>
        <span aria-hidden className="relative order-last col-span-2 block h-4 sm:order-none sm:col-span-1">
          <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
          <span className={`absolute top-1/2 h-[3px] -translate-y-1/2 rounded-pill bg-proof-leaf/40 animate-[wGrowX_.5s_var(--ease-standard)_both] ${rate >= base ? 'origin-left' : 'origin-right'}`} style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%`, animationDelay: `${120 + i * 30}ms` }} />
          <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-3 bg-surface" style={{ left: `${base * 100}%` }} />
          <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-proof-leaf ring-2 ring-surface" style={{ left: `${rate * 100}%` }} />
        </span>
        <span className={`text-right text-proof-body font-semibold tnum ${ahead && r.tier === 'proven' ? 'text-proof-leaf' : 'text-ink'}`}>{pts(r.lift)}</span>
      </Link>
    </li>
  )
}

/** No measured product with a comparison yet: the next useful step, not an empty chart. */
function NextStep({ rows, weeks, mix, carry }: { rows: ProductRow[]; weeks: number; mix: 'brand' | 'retailer'; carry: string }) {
  const collecting = rows.filter((r) => statusOf(r) === 'collecting').length
  const unused = rows.filter((r) => statusOf(r) === 'no_users').length
  return (
    <div className="flex flex-col gap-2 px-5 pb-5 pt-1">
      <p className="m-0 max-w-[60ch] text-proof-body text-ink-2 [text-wrap:pretty]">
        {rows.length
          ? `${int(rows.length)} ${rows.length === 1 ? 'product is' : 'products are'} in the catalog; ${int(collecting)} ${collecting === 1 ? 'is' : 'are'} collecting people and ${int(unused)} ${unused === 1 ? 'has' : 'have'} no users yet. A product is compared once 10 people reach week ${weeks}, against 10 or more with the same goals who don’t use it.`
          : mix === 'brand'
            ? 'None of your products is in the catalog yet.'
            : 'No products are in view yet.'}
      </p>
      <Link to={`${sectionPath('products')}${carry}`} className="self-start text-proof-small font-medium text-ink no-underline hover:underline">
        See where each product stands →
      </Link>
    </div>
  )
}
