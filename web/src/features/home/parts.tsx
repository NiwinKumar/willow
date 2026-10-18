import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { VerdictGlyph } from '../../components/willow/Verdict'
import { CHANGE_WORDS, VERDICT_WORDS, type ChangeWay, type VerdictKind } from '../../lib/verdict'

/** The design's small pills on Home cards: ink (black) or outline. 44px tall for touch. */
export function Pill({ tone = 'ink', className = '', children, ...rest }: { tone?: 'ink' | 'outline' | 'glass'; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const t =
    tone === 'ink'
      ? 'bg-selected text-inverse hover:bg-[#2a2a2a]'
      : tone === 'glass'
        ? 'bg-white/60 text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,.7)] backdrop-blur-[16px] hover:bg-white/85'
        : 'text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.14)] hover:bg-ink/5'
  return (
    <button type="button" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-pill px-4 text-[13px] transition-[background,translate] duration-300 ${t} ${className}`} {...rest}>
      {children}
    </button>
  )
}

/** Card title row: h2 18px with a quiet note on the right. */
export function CardHead({ title, note, id }: { title: string; note?: ReactNode; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 id={id} className="m-0 text-h3 font-normal">
        {title}
      </h2>
      {note ? <span className="text-right text-caption text-ink-2">{note}</span> : null}
    </div>
  )
}

/** Glyph + words, never colour alone (lib/verdict is the only source of the words). */
export function VerdictLine({ kind, way, short, className = '' }: { kind: VerdictKind; way?: ChangeWay; short?: boolean; className?: string }) {
  const w = kind === 'changed' && way ? CHANGE_WORDS[way] : VERDICT_WORDS[kind]
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <VerdictGlyph kind={kind} way={way} size={10} />
      {short ? w.short : w.label}
    </span>
  )
}

/** Text glyph for sentences (◆ ○ ◌ → ◐ ·); decorative, the words carry the meaning. */
export function Glyph({ g, className = '' }: { g: string; className?: string }) {
  return (
    <span aria-hidden className={`inline-block w-3.5 flex-none text-[12px] ${g === '◆' ? 'text-signal' : 'text-[#3E3C38]'} ${className}`}>
      {g}
    </span>
  )
}

/** The arrow circle that ends the design's pills: black on glass pills, yellow on ink CTAs. */
export function ArrowCircle({ tone = 'ink', size = 28 }: { tone?: 'ink' | 'yellow'; size?: number }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full ${tone === 'ink' ? 'bg-selected text-inverse' : 'bg-cta text-ink'}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size * 0.45} height={size * 0.45} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </span>
  )
}
