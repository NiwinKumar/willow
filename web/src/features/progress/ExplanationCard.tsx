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

const WORD_LIMIT = 40

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Insights: Gemini's (or the template's) words for this session, revealed word by word once per browser session
 * (whole under reduced motion), a short read first and the rest on request, then the next steps as small buttons.
 */
export function InsightsCard({ session, measured, actions }: { session: Session; measured: boolean; actions: ReactNode }) {
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
  // The short read ends on a full sentence: as many whole sentences as fit the limit (at least the first).
  const cut = useMemo(() => {
    let n = 0
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const c = sentence.split(/\s+/).length
      if (n && n + c > WORD_LIMIT) break
      n += c
    }
    return n
  }, [text])
  const long = allWords.length > cut
  const words = long && !more ? allWords.slice(0, cut) : allWords
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

  const busy = shown < words.length
  return (
    <section aria-label="Insights" className="flex flex-col gap-3 rounded-[28px] bg-surface p-4 shadow-[0_30px_70px_-50px_rgba(0,0,0,.35)] squircle">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="size-7 shrink-0 animate-[wBreathe_5s_ease-in-out_infinite] rounded-full shadow-[0_0_14px_rgba(61,123,255,.4)]" style={{ background: 'radial-gradient(circle at 40% 35%, var(--aura-ice), var(--aura-sky) 55%, #1B1F7A)' }} />
        <h2 className="m-0 flex-1 text-[16px] font-normal">Insights</h2>
        {session.explanation_source === 'gemini' && measured ? <AITag className="shrink-0 whitespace-nowrap" /> : null}
      </div>
      {text ? (
        <div aria-busy={busy}>
          {/* Screen readers get the whole text at once; the reveal is visual only. */}
          <p className="sr-only">{text}</p>
          <p aria-hidden className="m-0 text-[14.5px] leading-[1.55]">
            {words.slice(0, shown).map((w, i) => (
              <span key={i} className={instant ? undefined : 'animate-[wWord_.5s_ease-out_both]'}>
                {w}{' '}
              </span>
            ))}
            {busy ? <span className="inline-block h-[14px] w-[7px] animate-[wBlink_1s_steps(2)_infinite] rounded-[3px] bg-[var(--aura-sky)] align-[-2px]" /> : null}
          </p>
          {long && !busy ? (
            <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="mt-0.5 min-h-9 text-[13px] underline underline-offset-4">
              {more ? 'Show less' : 'Read more'}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="m-0 text-[14.5px] leading-[1.55] text-ink-2">{measured ? 'No insights were written for this check-in. The numbers below are measured from your photos.' : 'Nothing was measured on this check-in, so there are no insights yet.'}</p>
      )}
      {ex?.next_steps.length && (more || !long) ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] leading-[1.45] text-ink-2">
          {ex.next_steps.slice(0, 3).map((s) => (
            <li key={s} className="flex gap-2">
              <span aria-hidden>·</span>
              {s}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap justify-end gap-2 pt-1">{actions}</div>
    </section>
  )
}

/** One next step: a small outline button (or the ink one for the main step) with an arrow. */
export function NextAction({ children, onClick, to, primary }: { children: ReactNode; onClick?: () => void; to?: string; primary?: boolean }) {
  const cls = `inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3.5 text-[13px] leading-[1.2] no-underline transition-colors ${primary ? 'bg-selected text-inverse hover:bg-[#2a2a2a]' : 'text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-ink/5'}`
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
