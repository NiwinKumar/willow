import { useState } from 'react'

import { useOwner } from '../../data/hooks'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { useQuery } from '../../lib/query'
import { AVOID_OPTIONS, LIFE_STAGES, MARKETS, useSafety, type SafetyProfile } from '../../lib/safety'
import { LEVEL_LOOK, SIGN_LABEL, useReactions, type Reaction } from '../../lib/reactions'
import { SafetyForm } from './SafetyForm'
import { Row } from './settings'
import { outline } from './settingsClasses'

const yesNo = (v: boolean | null) => (v === null ? 'Not answered' : v ? 'Yes' : 'No')

function summary(s: SafetyProfile): { k: string; v: string }[] {
  return [
    { k: 'Pregnancy and breastfeeding', v: LIFE_STAGES.find((l) => l.id === s.life_stage)?.label ?? 'Not answered' },
    { k: 'Avoid', v: s.avoid.length ? s.avoid.map((a) => AVOID_OPTIONS.find((o) => o.id === a)?.label ?? a).join(', ') : 'Nothing' },
    { k: 'Reacts easily', v: yesNo(s.reactive) },
    { k: 'Prescription skin treatment', v: yesNo(s.rx_treatment) },
    { k: 'Where you buy', v: MARKETS.find((m) => m.id === s.market)?.label ?? 'Not answered' },
  ]
}

/**
 * You → Product checks: the safety answers every product is checked against (view, then edit in place), and
 * the reactions the person logged with the fixed outcome each got.
 */
export function SafetyRows() {
  const safety = useSafety()
  const [editing, setEditing] = useState(false)
  const s = safety.data ?? null
  return (
    <>
      <Row
        stack
        label="Your answers"
        hint="Every product is checked against these with fixed rules from published sources. They never change a measurement."
      >
        {safety.status === 'loading' || safety.status === 'idle' ? (
          <span aria-busy className="skeleton block h-20 rounded-[16px]" />
        ) : editing || !s ? (
          <div style={{ animation: 'wRise .35s var(--ease-standard) both' }}>
            {!s && !editing ? (
              <div className="flex flex-col items-start gap-2">
                <span className="text-[14px] text-ink-2">Not answered yet, so products aren’t checked for you.</span>
                <button type="button" onClick={() => setEditing(true)} className={outline}>
                  Answer five questions
                </button>
              </div>
            ) : (
              <SafetyForm initial={s} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3" style={{ animation: 'wFadeIn .3s both' }}>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
              {summary(s).map((r) => (
                <div key={r.k} className="contents">
                  <dt className="text-ink-2">{r.k}</dt>
                  <dd className="m-0">{r.v}</dd>
                </div>
              ))}
            </dl>
            <button type="button" onClick={() => setEditing(true)} className={`${outline} self-start`}>
              Edit answers
            </button>
          </div>
        )}
      </Row>
      <ReactionsRow setAside={s?.avoid_products.length ?? 0} />
    </>
  )
}

function ReactionsRow({ setAside }: { setAside: number }) {
  const reactions = useReactions()
  const list = reactions.data ?? []
  return (
    <Row
      stack
      label="Reactions you logged"
      hint={setAside ? `${setAside === 1 ? 'One product is' : `${setAside} products are`} set aside: Willow won’t suggest ${setAside === 1 ? 'it' : 'them'} to you.` : 'Log one from a product with “I had a reaction”. Willow then stops suggesting that product.'}
    >
      {reactions.status === 'loading' ? (
        <span aria-busy className="skeleton block h-12 rounded-[16px]" />
      ) : reactions.status === 'error' && !reactions.data ? (
        <span className="text-[13px] text-ink-2">Your reactions didn’t load.</span>
      ) : list.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {[...list]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((r, i) => (
              <ReactionItem key={r.id} r={r} i={i} />
            ))}
        </ul>
      ) : (
        <span className="text-[13px] text-ink-2">None logged.</span>
      )}
    </Row>
  )
}

function ReactionItem({ r, i }: { r: Reaction; i: number }) {
  const uid = useOwner()
  // The same cache key as the product sheet's, so a product already opened is not fetched again.
  const product = useQuery(['catalog-product', r.product_id], (t) => api.catalogProduct(t, r.product_id), { enabled: Boolean(uid && r.product_id), staleMs: 30 * 60_000 })
  const look = LEVEL_LOOK[r.level]
  const name = product.data ? `${product.data.brand} ${product.data.name}` : 'A product'
  return (
    <li className="flex items-start gap-3 rounded-[16px] bg-sunken px-3.5 py-2.5" style={{ animation: `wRise .4s ${Math.min(i, 8) * 60}ms both` }}>
      <span className={`mt-0.5 shrink-0 rounded-pill px-2 py-0.5 font-mono text-[10px] tracking-[.06em] ${look.bg} ${look.fg}`}>{look.tag}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[14px]">{name}</span>
        <span className="text-[12.5px] text-ink-2">
          {fmtDate(r.created_at)} · {r.strength} · {r.signs.map((s) => SIGN_LABEL[s]?.toLowerCase() ?? s).join(', ')}
        </span>
      </span>
    </li>
  )
}
