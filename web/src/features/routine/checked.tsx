import { useState } from 'react'

import { CheckedChip } from '../../components/willow/CheckedChip'
import { CHECK_WORDS, LABELS_NOTE, REGULATORY_WORDS, useSafety, type CheckStatus, type ProductCheck } from '../../lib/safety'
import { useOwner } from '../../data/hooks'
import { SafetySheet } from '../you/SafetyForm'
import { Link } from 'react-router-dom'

export type ChecksMap = Record<string, ProductCheck | undefined>

/** The same status colours as CheckedChip (state tokens); meaning always also in glyph and words. */
const LOOK: Record<CheckStatus, { fg: string; bg: string }> = {
  clear: { fg: 'var(--willow-700)', bg: 'rgba(79,184,102,.14)' },
  check: { fg: 'var(--state-caution-fg)', bg: 'var(--state-caution-bg)' },
  avoid: { fg: 'var(--state-avoid-fg)', bg: 'var(--state-avoid-bg)' },
  not_sold: { fg: 'var(--text-secondary)', bg: 'var(--bg-muted)' },
}

/**
 * A product's check on a list row. On a page it is the shared CheckedChip (tap for reasons). Inside one of the
 * routine's <dialog> sheets the chip's reasons panel (portalled to <body>) would sit under the modal, so there
 * it is a plain status pill and the reasons are one tap away in the product's own sheet.
 */
export function ProductChecked({ check, loading = false, profileComplete = null, inDialog = false, short = true }: { check: ProductCheck | null | undefined; loading?: boolean; profileComplete?: boolean | null; inDialog?: boolean; short?: boolean }) {
  if (!inDialog) return <CheckedChip check={check} loading={loading} profileComplete={profileComplete} short={short} className="self-start" />
  if (!check) return loading ? <span aria-hidden className="inline-block h-[22px] w-[84px] self-start rounded-pill bg-sunken" /> : null
  const w = CHECK_WORDS[check.status]
  const look = LOOK[check.status]
  return (
    <span className="inline-flex min-h-[22px] shrink-0 items-center gap-1.5 self-start rounded-pill py-[3px] pr-2.5 pl-1 text-[12px] leading-none whitespace-nowrap animate-[wFadeIn_.3s_both]" style={{ color: look.fg, background: look.bg }}>
      <span aria-hidden className="grid size-[16px] place-items-center rounded-full bg-white/70 text-[10px] font-semibold">
        {w.glyph}
      </span>
      {short ? w.short : w.label}
    </span>
  )
}

/** The full reasons inline (product sheet header): status, every flag with its source and grade, how it is sold, "Labels can be incomplete". */
export function CheckReasons({ check, profileComplete }: { check: ProductCheck; profileComplete: boolean | null }) {
  const w = CHECK_WORDS[check.status]
  const look = LOOK[check.status]
  return (
    <div className="flex flex-col gap-2 rounded-[20px] p-3.5" style={{ background: look.bg, animation: 'wRise .4s var(--ease-standard) both' }}>
      <span className="flex items-center gap-2 text-[15px]" style={{ color: look.fg }}>
        <span aria-hidden className="grid size-6 place-items-center rounded-full bg-white/70 text-[12px] font-semibold">
          {w.glyph}
        </span>
        {w.label}
      </span>
      {check.flags.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {check.flags.map((f, i) => (
            <li key={f.rule} className="rounded-[14px] bg-white/75 px-3 py-2.5 text-[13px] leading-[1.45]" style={{ animation: `wRise .4s ${100 + i * 70}ms both` }}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[14px]">{f.title}</span>
                <span className="shrink-0 font-mono text-[10px] tracking-[.06em]" style={{ color: LOOK[f.level].fg }}>
                  {f.level === 'avoid' ? '⊘ NOT ADVISED' : '! CHECK'}
                </span>
              </span>
              <span className="mt-0.5 block text-ink-2">{f.detail}</span>
              {f.source ? (
                <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                  {f.source.url ? (
                    <a href={f.source.url} target="_blank" rel="noopener noreferrer" className="hit44 text-ink underline underline-offset-2">
                      {f.source.label}
                      <span aria-hidden> ↗</span>
                      <span className="sr-only"> (opens in new tab)</span>
                    </a>
                  ) : (
                    <span className="text-ink">{f.source.label}</span>
                  )}
                  {f.grade ? <span className="rounded-pill bg-sunken px-1.5 py-0.5 font-mono text-[10px]">Evidence grade {f.grade}</span> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[13px] leading-[1.45] text-ink-2">{check.status === 'not_sold' ? 'In your market this is sold as a medicine, not a cosmetic, so Willow does not suggest it.' : 'Nothing on its ingredient list matches what you told Willow.'}</span>
      )}
      <span className="text-[12px] leading-[1.45] text-ink-2">
        {check.regulatory ? `${REGULATORY_WORDS[check.regulatory.class]} in ${check.regulatory.market === 'UK' || check.regulatory.market === 'US' ? `the ${check.regulatory.market}` : check.regulatory.market}. ` : ''}
        {profileComplete === false ? 'Checked against part of your profile. ' : ''}
        {LABELS_NOTE} Checked by fixed rules from published sources, not by AI.{' '}
        <Link to="/checks" className="text-ink underline underline-offset-2">
          How we check
        </Link>
      </span>
    </div>
  )
}

/**
 * "Check for me": shown where checks would be when the person has no safety profile yet. Opens the small
 * safety questions sheet; once saved, the checks load everywhere.
 */
export function CheckForMe({ className = '' }: { className?: string }) {
  const uid = useOwner()
  const safety = useSafety()
  const [open, setOpen] = useState(false)
  if (!uid || safety.status !== 'ready' || safety.data) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`hit44 inline-flex min-h-8 items-center gap-1.5 self-start text-[13px] text-ink-2 underline decoration-ink/30 underline-offset-4 transition-colors hover:text-ink ${className}`}>
        <span aria-hidden className="grid size-[17px] place-items-center rounded-full bg-sunken text-[10px] no-underline">
          ✓
        </span>
        Check products for me
      </button>
      <SafetySheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
