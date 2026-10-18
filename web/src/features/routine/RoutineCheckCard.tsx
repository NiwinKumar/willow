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
const SHOWN = 5
const SEVERITY_RANK: Record<Finding['severity'], number> = { High: 0, Moderate: 1, Low: 2 }

/** One or two findings sit side by side as panels; three or more are a list of rows (no cells to leave empty). */
const ROWS_FROM = 3

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
  const rows = sorted.length >= ROWS_FROM
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
          <div className={rows ? 'flex flex-col gap-2' : `grid gap-3 ${shown.length === 2 ? '@min-[560px]:grid-cols-2' : ''}`}>
            {shown.map((f, i) => {
              const sev = SEVERITY_STYLE[f.severity]
              const open = !phone || openKey === f.key
              const items = f.entries.length ? f.entries.map((e) => ({ id: e.id, name: compactName(e), full: entryName(e), image: <ProductImage product={imageOf(e)} size={rows ? 20 : 26} decorative /> })) : f.products.map((p) => ({ id: p, name: p, full: p, image: null }))
              const actions = (
                <span className={`flex flex-wrap justify-end gap-2 ${rows ? '@min-[700px]:shrink-0 @min-[700px]:flex-nowrap' : 'mt-auto border-t border-white/10 pt-3'}`}>
                  {f.find ? (
                    <button type="button" onClick={() => onFind(f)} className="min-h-8 rounded-pill bg-white px-3.5 text-[12.5px] text-ink">
                      Find one
                    </button>
                  ) : null}
                  {f.alternate && f.entries.length === 2 ? (
                    <button type="button" disabled={alternating !== null} aria-busy={alternating === f.key} onClick={() => void alternate(f)} className="min-h-8 rounded-pill bg-white px-3.5 text-[12.5px] text-ink disabled:opacity-60">
                      {alternating === f.key ? 'Saving…' : 'Alternate these'}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => shell.openAdvisor(f.question, 'Routine check')} className="min-h-8 rounded-pill bg-white/[.16] px-3.5 text-[12.5px] whitespace-nowrap transition-colors hover:bg-white/[.26]">
                    Ask Wisp why →
                  </button>
                </span>
              )
              const productList = items.length ? (
                <ul className={`m-0 flex list-none p-0 text-[12.5px] ${rows ? 'flex-wrap gap-1.5 @min-[700px]:flex-nowrap @min-[700px]:justify-end' : 'flex-wrap gap-1.5'}`}>
                  {items.map((it) => (
                    <li key={it.id} title={it.full} className="flex items-center gap-1.5 rounded-pill bg-white/[.12] py-0.5 pr-2.5 pl-0.5 whitespace-nowrap">
                      {it.image}
                      {it.name}
                    </li>
                  ))}
                </ul>
              ) : null
              return (
                <article key={f.key} className={rows ? 'flex flex-col gap-2.5 rounded-[16px] bg-white/[.07] px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)] @min-[700px]:flex-row @min-[700px]:items-center @min-[700px]:gap-5' : 'flex flex-col gap-3 rounded-[20px] bg-white/[.07] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]'} style={{ animation: `wRise .45s ${i * 70}ms both` }}>
                  <div className={`flex min-w-0 flex-1 flex-col ${rows ? 'gap-1.5' : 'gap-3'}`}>
                    <div className="flex items-start gap-2.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-[#C9CFFF]">
                          <span>
                            <span aria-hidden>{sev.glyph} </span>
                            {f.severity}
                            <span className="sr-only"> severity</span> {f.kind.toLowerCase()}
                          </span>
                          {f.ai ? (
                            <span className="inline-flex items-center gap-1">
                              <Sparkles size={11} strokeWidth={1.8} aria-hidden />
                              AI suggestion
                            </span>
                          ) : null}
                        </span>
                        <h3 className={`text-[15px] leading-[1.5] font-normal ${open ? '' : 'line-clamp-2'}`}>
                          {f.title} {open ? <mark className="rounded-[4px] bg-[rgba(150,166,255,.34)] px-1 text-inverse [box-decoration-break:clone]">{f.fix}</mark> : null}
                        </h3>
                      </div>
                      {phone ? (
                        <button type="button" aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'} onClick={() => setOpenKey(open ? null : f.key)} className="hit44 grid size-8 shrink-0 place-items-center rounded-full bg-white/[.12]">
                          <ChevronDown size={16} strokeWidth={1.8} aria-hidden className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                        </button>
                      ) : null}
                    </div>
                    {open && !rows ? productList : null}
                  </div>
                  {open && rows ? (
                    <div className="flex flex-col gap-2.5 @min-[700px]:shrink-0 @min-[700px]:items-end @min-[700px]:self-stretch @min-[700px]:justify-between">
                      {productList}
                      {actions}
                    </div>
                  ) : open ? (
                    actions
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
