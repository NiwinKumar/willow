import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { AITag } from '../../components/willow/AITag'
import type { Session } from '../../data/types'

const SEEN_KEY = 'willow.explained'

function seen(id: string): boolean {
  try {
    return (JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]).includes(id)
  } catch {
    return false
  }
}
function markSeen(id: string) {
  try {
    const list = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]
    if (!list.includes(id)) sessionStorage.setItem(SEEN_KEY, JSON.stringify([...list.slice(-40), id]))
  } catch {
    /* private mode: it simply reveals again */
  }
}

const WORD_LIMIT = 50

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The explanation card: Gemini's (or the template's) words for this session, revealed word by word once per
 * browser session (whole under reduced motion), its source on the second line, then NEXT actions.
 */
export function ExplanationCard({ session, measured, actions }: { session: Session; measured: boolean; actions: ReactNode }) {
  const ex = session.explanation
  const text = useMemo(() => {
    if (!ex) return ''
    // A headline without its own full stop would run into the first item ("…measured Skin tone…").
    const head = ex.headline && !/[.!?…:]$/.test(ex.headline.trim()) ? `${ex.headline.trim()}.` : ex.headline
    return [head, ...ex.items.map((i) => i.summary)].filter(Boolean).join(' ')
  }, [ex])
  const allWords = useMemo(() => (text ? text.split(/\s+/) : []), [text])
  // A long explanation would stretch the hero beside it far past the design's height: the first part shows,
  // the rest on request (screen readers always get the whole text).
  const [more, setMore] = useState(false)
  const long = allWords.length > WORD_LIMIT + 15
  const words = long && !more ? allWords.slice(0, WORD_LIMIT) : allWords
  // Reveal once per session per browser session; the parent remounts this card per session (key).
  const [instant] = useState(() => !text || seen(session.id) || reduced())
  const [count, setCount] = useState(0)
  const shown = instant || more ? words.length : count
  useEffect(() => {
    if (instant || more) return
    const t0 = Date.now()
    const timer = window.setInterval(() => {
      const n = Math.floor((Date.now() - t0) / 34)
      setCount(Math.min(n, words.length))
      if (n >= words.length) {
        window.clearInterval(timer)
        markSeen(session.id)
      }
    }, 34)
    return () => window.clearInterval(timer)
  }, [instant, more, words.length, session.id])

  const source = !measured
    ? 'WILLOW · NO MEASUREMENTS TO EXPLAIN'
    : session.explanation_source === 'gemini'
      ? 'GEMINI · NUMBERS CHECKED AGAINST MEASUREMENTS ✓'
      : 'STANDARD EXPLANATION · WRITTEN FROM YOUR NUMBERS'
  const busy = shown < words.length
  return (
    <section aria-label="Explanation" className="flex flex-[1_1_320px] flex-col gap-[18px] rounded-[44px] bg-surface p-[clamp(22px,3vw,32px)] shadow-[0_30px_70px_-50px_rgba(0,0,0,.35)] squircle">
      {/* Wraps the AI tag under the source line when the card is narrow, instead of squeezing the source into a column. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <span aria-hidden className="size-10 shrink-0 animate-[wBreathe_5s_ease-in-out_infinite] rounded-full shadow-[0_0_20px_rgba(61,123,255,.4)]" style={{ background: 'radial-gradient(circle at 40% 35%, var(--aura-ice), var(--aura-sky) 55%, #1B1F7A)' }} />
        <span className="flex min-w-[min(100%,190px)] flex-1 flex-col">
          <span className="text-[15px]">Explanation</span>
          <span className="font-mono text-[11px] tracking-[.04em] text-ink-2">{source}</span>
        </span>
        {session.explanation_source === 'gemini' && measured ? <AITag className="ml-auto shrink-0 whitespace-nowrap" /> : null}
      </div>
      {text ? (
        <div aria-busy={busy}>
          {/* Screen readers get the whole text at once; the reveal is visual only. */}
          <p className="sr-only">{text}</p>
          <p aria-hidden className="m-0 min-h-[120px] text-[18px] leading-[1.55] font-light">
            {words.slice(0, shown).map((w, i) => (
              <span key={i} className={instant ? undefined : 'animate-[wWord_.5s_ease-out_both]'}>
                {w}{' '}
              </span>
            ))}
            {busy ? <span className="inline-block h-[18px] w-[9px] animate-[wBlink_1s_steps(2)_infinite] rounded-[4px] bg-[var(--aura-sky)] align-[-3px]" /> : long && !more ? '…' : null}
          </p>
          {long && !busy ? (
            <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="mt-1 min-h-11 text-[14px] underline underline-offset-4">
              {more ? 'Show less' : 'Read the whole explanation'}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="m-0 text-[18px] leading-[1.55] font-light">{measured ? 'No explanation was written for this check-in. The numbers below are measured from your photos.' : 'Nothing was measured on this check-in, so there is nothing to explain yet.'}</p>
      )}
      {ex?.next_steps.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14px] leading-[1.45] text-ink-2">
          {ex.next_steps.slice(0, 3).map((s) => (
            <li key={s} className="flex gap-2">
              <span aria-hidden>·</span>
              {s}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-col gap-2">
        <span className="font-mono text-[12px] text-ink-2">NEXT</span>
        {actions}
      </div>
      {ex?.disclaimer ? <p className="m-0 text-caption text-ink-2">{ex.disclaimer}</p> : null}
    </section>
  )
}

/** One NEXT row: a soft full-width link or button with an arrow. */
export function NextAction({ children, onClick, to }: { children: ReactNode; onClick?: () => void; to?: string }) {
  const cls = 'flex min-h-[52px] items-center justify-between gap-2.5 rounded-[20px] bg-sunken px-[18px] py-2.5 text-left text-[15px] leading-[1.3] no-underline transition-colors hover:bg-muted'
  if (to)
    return (
      <Link to={to} className={cls}>
        {children}
        <span aria-hidden>→</span>
      </Link>
    )
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
      <span aria-hidden>→</span>
    </button>
  )
}
