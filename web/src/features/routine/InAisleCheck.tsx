import { useEffect, useState, type ReactNode } from 'react'

import type { Product } from '../../data/types'
import { routinePreview, useChecks, type RoutinePreview } from '../../lib/safety'
import { useAuth } from '../../lib/useAuth'
import { CheckForMe, ProductChecked } from './checked'

/**
 * In-aisle check (research 05 §5 #11): a pack photo matched a catalog product, so before buying it the person
 * sees three lines: its flags for them, what it would newly clash with in their routine
 * (POST /v1/routine/check/preview, fixed rules, nothing saved), and the key actives they already use.
 */
export function InAisleCheck({ product, slots }: { product: Product; slots?: ('am' | 'pm')[] }) {
  const { getIdToken } = useAuth()
  const checks = useChecks([product.product_id])
  const check = checks.checks[product.product_id]
  const [preview, setPreview] = useState<{ id: string; data: RoutinePreview | null; failed: boolean } | null>(null)
  const slotKey = slots?.join(',') ?? ''

  useEffect(() => {
    let live = true
    getIdToken()
      .then((t) => routinePreview(t, product.product_id, slotKey ? (slotKey.split(',') as ('am' | 'pm')[]) : undefined))
      .then((data) => live && setPreview({ id: product.product_id, data, failed: false }))
      .catch(() => live && setPreview({ id: product.product_id, data: null, failed: true }))
    return () => {
      live = false
    }
  }, [getIdToken, product.product_id, slotKey])

  const p = preview?.id === product.product_id ? preview : null
  const clashLines = p?.data ? [...p.data.clashes.map((c) => ({ key: c.issue, main: c.issue, sub: [c.with.length ? `With ${c.with.join(', ')}.` : '', c.suggestion].filter(Boolean).join(' '), caution: c.severity !== 'info' })), ...p.data.gaps.map((g) => ({ key: g.need, main: g.need, sub: g.why, caution: true }))] : []

  return (
    <ul aria-label="Checked for you" className="m-0 flex list-none flex-col divide-y divide-ink/[.07] rounded-[18px] bg-white/80 p-0">
      <Line n={0} label="For you">
        {checks.status === 'ready' && !check ? (
          <CheckForMe />
        ) : (
          <span className="flex flex-col gap-1">
            <ProductChecked check={check} loading={checks.status === 'loading'} profileComplete={checks.profileComplete} inDialog short={false} />
            {check?.flags.length ? <span className="text-[13px] leading-[1.4] text-ink-2">{check.flags.map((f) => f.title).join(' · ')}</span> : null}
          </span>
        )}
      </Line>
      <Line n={1} label="With your routine">
        {!p ? (
          <Wait />
        ) : p.failed || !p.data ? (
          <span className="text-[13.5px] text-ink-2">Couldn’t check your routine just now.</span>
        ) : p.data.in_routine ? (
          <span className="text-[13.5px]">It’s already in your routine.</span>
        ) : clashLines.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {clashLines.map((c, i) => (
              <li key={c.key} className="flex flex-col text-[13.5px] leading-[1.4]" style={{ animation: `wRise .3s var(--ease-standard) ${i * 60}ms both` }}>
                <span style={{ color: c.caution ? 'var(--state-caution-fg)' : undefined }}>
                  <span aria-hidden>{c.caution ? '! ' : 'i '}</span>
                  {c.main}
                </span>
                <span className="text-ink-2">{c.sub}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[13.5px]">{p.data.routine_size ? 'No new clashes with your routine.' : 'Nothing in your routine yet to clash with.'}</span>
        )}
      </Line>
      <Line n={2} label="Already in use">
        {!p ? (
          <Wait />
        ) : p.data?.already_use.length ? (
          <span className="flex flex-col gap-0.5 text-[13.5px] leading-[1.4]">
            {p.data.already_use.map((a) => (
              <span key={a.active}>
                You already use {a.active}
                <span className="text-ink-2"> · {a.products.join(', ')}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-[13.5px] text-ink-2">{p.data && !p.data.in_routine ? 'None of its key actives are in your routine.' : '—'}</span>
        )}
      </Line>
    </ul>
  )
}

function Line({ n, label, children }: { n: number; label: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[minmax(92px,auto)_1fr] items-start gap-3 px-3.5 py-2.5" style={{ animation: `wRise .35s var(--ease-standard) ${80 + n * 70}ms both` }}>
      <span className="pt-[3px] text-[12.5px] text-ink-2">{label}</span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function Wait() {
  return <span aria-busy className="skeleton block h-[18px] w-40 rounded-pill" />
}
