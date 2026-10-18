import { ChevronDown, Info, RefreshCw, Sparkles } from 'lucide-react'
import { useId, useState } from 'react'

import { useShell } from '../../components/shell/ShellContext'
import type { RoutineCheck } from '../../data/types'
import type { QueryResult } from '../../lib/query'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { ProductImage } from './productUi'
import { SEVERITY_STYLE, compactName, entryName, imageOf, type Finding } from './routineModel'

const SKELETON = 'linear-gradient(90deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.22) 50%, rgba(255,255,255,.08) 100%)'
const MUTED = 'text-[#D5D8FF]'
const SHOWN = 4
const SEVERITY_RANK: Record<Finding['severity'], number> = { High: 0, Moderate: 1, Low: 2 }

/**
 * Columns follow the number of findings and the card's own width (container queries), so no cell is left empty:
 * one finding is full width, two sit side by side, three go three across when there is room (else two with the
 * last one spanning), more stay in two with an odd last one spanning.
 */
function gridClass(n: number) {
  if (n <= 1) return 'grid-cols-1'
  if (n === 2) return 'grid-cols-1 @min-[560px]:grid-cols-2'
  if (n === 3) return 'grid-cols-1 @min-[560px]:grid-cols-2 @min-[860px]:grid-cols-3 @min-[560px]:@max-[859px]:[&>*:last-child]:col-span-2'
  return `grid-cols-1 @min-[560px]:grid-cols-2${n % 2 ? ' @min-[560px]:[&>*:last-child]:col-span-2' : ''}`
}

/**
 * The compatibility check, first on the page and the only blue thing on it (design: "■ ROUTINE CHECK"): a
 * compact card with the verdict at the top left, "How this was checked" and a small re-run icon button at the top
 * right, and every finding under it, most serious first, each in its own soft inset panel (severity and kind are
 * words, not pills; the actions sit bottom right). On a phone the
 * findings are one-line rows that open on tap, so the lists stay in reach. It runs by itself whenever the
 * routine changes (useRoutineCheck is keyed by the routine); the icon button re-asks.
 */
export function RoutineCheckCard({ check, findings, count, onFind, onAlternate }: { check: QueryResult<RoutineCheck> & { rerun: () => Promise<void> }; findings: Finding[]; count: number; onFind: (f: Finding) => void; onAlternate: (f: Finding) => Promise<void> }) {
  const shell = useShell()
  const phone = useMediaQuery('(max-width: 639px)')
  const [rerun, setRerun] = useState(false)
  const [alternating, setAlternating] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [showHow, setShowHow] = useState(false)
  const [all, setAll] = useState(false)
  const howId = useId()
  const alternate = async (f: Finding) => {
    setAlternating(f.key)
    try {
      await onAlternate(f)
    } finally {
      setAlternating(null)
    }
  }
  const running = check.status === 'loading' || rerun
  const done = check.status === 'ready' && !rerun && check.data !== undefined
  const failed = check.status === 'error' && !rerun
  const sorted = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  const anyAi = findings.some((f) => f.ai)
  const shown = all ? sorted : sorted.slice(0, SHOWN)
  const title = count === 0 ? 'Do these work together?' : running ? 'Checking…' : failed ? 'The check didn’t finish' : done ? (findings.length ? `${findings.length} thing${findings.length > 1 ? 's' : ''} to look at` : 'Looks compatible') : 'Do these work together?'
  const sub = count === 0 ? 'Compares ingredient lists across your morning and evening products.' : `${count} product${count === 1 ? '' : 's'} checked. Runs again when your routine changes.`

  const runAgain = async () => {
    setRerun(true)
    try {
      await check.rerun()
    } finally {
      setRerun(false)
    }
  }

  return (
    <section
      aria-label="Compatibility check"
      className="@container relative flex min-w-0 flex-col gap-3.5 overflow-hidden rounded-[28px] p-5 text-inverse squircle"
      style={{
        background: 'radial-gradient(70% 90% at 15% 0%, #4A5BFF 0%, #1D237A 50%, #0A0C2A 95%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08), inset 0 -40px 80px rgba(110,139,255,.2), 0 40px 80px -44px rgba(29,35,122,.8)',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2.5">
        <div className="flex min-w-0 flex-1 basis-[13rem] flex-col gap-1.5">
          <span className="font-mono text-[11px] tracking-[.08em] text-[#C9CFFF]">■ ROUTINE CHECK</span>
          <h2 className="text-[clamp(21px,1.9vw,25px)] leading-[1.1] font-light tracking-[-0.02em]">{title}</h2>
          <p className={`text-[13px] leading-[1.45] ${MUTED}`}>{sub}</p>
        </div>
        {count > 0 ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {done && findings.length ? (
              <button type="button" aria-expanded={showHow} aria-controls={howId} onClick={() => setShowHow((v) => !v)} className="hit44 inline-flex h-9 items-center gap-1.5 rounded-pill bg-white/[.14] px-3.5 text-[12.5px] text-inverse transition-colors hover:bg-white/[.26]">
                <Info size={14} strokeWidth={1.8} aria-hidden />
                How this was checked
              </button>
            ) : null}
            <button type="button" onClick={() => void runAgain()} disabled={running} aria-label={running ? 'Checking' : failed ? 'Try the check again' : 'Run the check again'} title={failed ? 'Try again' : 'Run again'} className="hit44 grid size-9 shrink-0 place-items-center rounded-full bg-white/[.14] text-inverse transition-colors hover:bg-white/[.26] disabled:opacity-60">
              <RefreshCw size={15} strokeWidth={1.8} aria-hidden className={running ? 'motion-safe:animate-spin' : ''} />
            </button>
          </div>
        ) : null}
      </div>

      {showHow && done && findings.length ? (
        <p id={howId} className="max-w-[760px] rounded-[16px] bg-white/[.07] px-4 py-3 text-[12.5px] leading-[1.55] text-[#D5D8FF]">
          Findings come from Willow’s ingredient rules.{anyAi ? ' Findings tagged AI suggestion are Gemini’s reading of the lists, which can be wrong.' : ''}
          {check.data?.notes.length ? ` Also checked: ${check.data.notes.join(' ')}` : ''}
        </p>
      ) : null}

      {count === 0 ? (
        <p className="text-[14px] leading-[1.55] text-[#D5D8FF]">Looks for conflicting actives, duplicates and gaps such as a missing sunscreen, once there is something in your routine.</p>
      ) : running ? (
        <div role="status" aria-label="Checking ingredient lists" className="grid gap-4 @min-[640px]:grid-cols-2">
          {[0, 1].map((k) => (
            <div key={k} className="flex flex-col gap-2.5 border-t border-white/15 pt-3">
              {['40%', '90%', '70%'].map((w, i) => (
                <span key={w} className="block rounded-[6px] motion-safe:animate-[wShimmer_1.4s_linear_infinite]" style={{ width: w, height: [16, 13, 12][i], background: SKELETON, backgroundSize: '200% 100%', animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          ))}
        </div>
      ) : failed ? (
        <p role="alert" className="rounded-[18px] border border-[rgba(255,107,74,.5)] bg-[rgba(255,107,74,.2)] px-4 py-3 text-[14px] leading-[1.5]">
          {navigator.onLine ? 'The check didn’t finish. Your routine is saved and unchanged. Try again in a moment.' : 'You’re offline, so the check can’t run. Your routine is saved and unchanged.'}
        </p>
      ) : done && findings.length === 0 ? (
        <div className="flex items-center gap-4">
          <span className="font-dot text-[34px] leading-none text-lime">00</span>
          <span className="text-[14.5px] leading-[1.45]">No conflicts, duplicates or gaps found in this routine.</span>
        </div>
      ) : done ? (
        <div className="flex flex-col gap-3">
          <div className={`grid gap-3 ${gridClass(shown.length)}`}>
            {shown.map((f, i) => {
              const sev = SEVERITY_STYLE[f.severity]
              const open = !phone || openKey === f.key
              const items = f.entries.length ? f.entries.map((e) => ({ id: e.id, name: compactName(e), full: entryName(e), image: <ProductImage product={imageOf(e)} size={26} decorative /> })) : f.products.map((p) => ({ id: p, name: p, full: p, image: null }))
              return (
                <article key={f.key} className="flex flex-col gap-3 rounded-[20px] bg-white/[.07] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]" style={{ animation: `wRise .45s ${i * 70}ms both` }}>
                  <div className="flex items-start gap-2.5">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] tracking-[.08em] text-[#C9CFFF]">
                        <span>
                          <span aria-hidden>{sev.glyph} </span>
                          {f.severity.toUpperCase()}
                          <span className="sr-only"> severity</span> · {f.kind.toUpperCase()}
                        </span>
                        {f.ai ? (
                          <span className="inline-flex items-center gap-1">
                            <Sparkles size={11} strokeWidth={1.8} aria-hidden />
                            AI SUGGESTION
                          </span>
                        ) : null}
                      </span>
                      <h3 className={`text-[15px] leading-[1.35] font-normal ${open ? '' : 'line-clamp-2'}`}>{f.title}</h3>
                    </div>
                    {phone ? (
                      <button type="button" aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'} onClick={() => setOpenKey(open ? null : f.key)} className="hit44 grid size-8 shrink-0 place-items-center rounded-full bg-white/[.12]">
                        <ChevronDown size={16} strokeWidth={1.8} aria-hidden className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                      </button>
                    ) : null}
                  </div>
                  {open ? (
                    <div className="flex flex-1 flex-col gap-3">
                      {items.length ? (
                        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-[13px]">
                          {items.map((it) => (
                            <li key={it.id} title={it.full} className="flex items-center gap-2">
                              {it.image}
                              {it.name}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <p className={`max-w-[56ch] text-[13px] leading-[1.5] ${MUTED}`}>{f.fix}</p>
                      <span className="mt-auto flex flex-wrap justify-end gap-2 border-t border-white/10 pt-3">
                        {f.find ? (
                          <button type="button" onClick={() => onFind(f)} className="min-h-9 rounded-pill bg-white px-3.5 text-[13px] text-ink">
                            Find one
                          </button>
                        ) : null}
                        {f.alternate && f.entries.length === 2 ? (
                          <button type="button" disabled={alternating !== null} aria-busy={alternating === f.key} onClick={() => void alternate(f)} className="min-h-9 rounded-pill bg-white px-3.5 text-[13px] text-ink disabled:opacity-60">
                            {alternating === f.key ? 'Saving…' : 'Alternate these'}
                          </button>
                        ) : null}
                        <button type="button" onClick={() => shell.openAdvisor(f.question, 'Routine check')} className="min-h-9 rounded-pill bg-white/[.16] px-3.5 text-[13px] transition-colors hover:bg-white/[.26]">
                          Ask Wisp why →
                        </button>
                      </span>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
          {sorted.length > SHOWN ? (
            <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="min-h-9 self-end rounded-pill bg-white/[.14] px-3.5 text-[13px] transition-colors hover:bg-white/[.26]">
              {all ? 'Show fewer' : `Show ${sorted.length - SHOWN} more`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
