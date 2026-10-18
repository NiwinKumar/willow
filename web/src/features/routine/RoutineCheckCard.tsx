import { ChevronDown, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { useShell } from '../../components/shell/ShellContext'
import { AITag } from '../../components/willow/AITag'
import type { RoutineCheck } from '../../data/types'
import type { QueryResult } from '../../lib/query'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { ProductImage } from './productUi'
import { SEVERITY_STYLE, entryName, imageOf, type Finding } from './routineModel'

const SKELETON = 'linear-gradient(90deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.22) 50%, rgba(255,255,255,.08) 100%)'
const SEVERITY_RANK: Record<Finding['severity'], number> = { High: 0, Moderate: 1, Low: 2 }

/**
 * The compatibility check, first on the page and the only blue thing on it (design: "■ ROUTINE CHECK"): a
 * full-width band with the verdict at the left and every finding beside it as its own card, most serious
 * first. On a phone the findings are one-line rows that open on tap, so the lists stay in reach. It runs by
 * itself whenever the routine changes (useRoutineCheck is keyed by the routine); the button re-asks.
 */
export function RoutineCheckCard({ check, findings, count, onFind, onAlternate }: { check: QueryResult<RoutineCheck> & { rerun: () => Promise<void> }; findings: Finding[]; count: number; onFind: (f: Finding) => void; onAlternate: (f: Finding) => Promise<void> }) {
  const shell = useShell()
  const phone = useMediaQuery('(max-width: 639px)')
  const [rerun, setRerun] = useState(false)
  const [alternating, setAlternating] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
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
      className="@container relative overflow-hidden rounded-[32px] p-5 text-inverse squircle sm:p-6"
      style={{
        background: 'radial-gradient(70% 90% at 15% 0%, #4A5BFF 0%, #1D237A 50%, #0A0C2A 95%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08), inset 0 -40px 80px rgba(110,139,255,.2), 0 40px 80px -44px rgba(29,35,122,.8)',
      }}
    >
      <div className="flex flex-col gap-5 @min-[860px]:flex-row @min-[860px]:gap-8">
        <div className="flex shrink-0 flex-col gap-2.5 @min-[860px]:w-[250px]">
          <span className="font-mono text-[11.5px] tracking-[.08em] text-[#C9CFFF]">■ ROUTINE CHECK</span>
          <h2 className="text-[clamp(24px,2.6vw,32px)] leading-[1.1] font-light tracking-[-0.02em]">{title}</h2>
          <p className="text-[14px] leading-[1.5] text-[#D5D8FF]">{sub}</p>
          {count > 0 ? (
            <button type="button" onClick={() => void runAgain()} disabled={running} className="hit44 mt-1 flex min-h-10 items-center gap-2 self-start rounded-pill bg-white px-4 text-[14px] text-ink transition-transform hover:-translate-y-px disabled:opacity-60">
              <RefreshCw size={15} strokeWidth={1.8} aria-hidden className={running ? 'motion-safe:animate-spin' : ''} />
              {running ? 'Checking…' : failed ? 'Try again' : 'Run again'}
            </button>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          {count === 0 ? (
            <p className="rounded-[22px] bg-white/[.07] p-4 text-[14px] leading-[1.55] text-[#D5D8FF]">Looks for conflicting actives, duplicates and gaps such as a missing sunscreen, once there is something in your routine.</p>
          ) : running ? (
            <div role="status" aria-label="Checking ingredient lists" className="grid gap-3 @min-[700px]:grid-cols-2">
              {[0, 1].map((k) => (
                <div key={k} className="flex h-[150px] flex-col gap-3 rounded-[24px] border border-white/10 bg-white/[.06] p-4">
                  {['40%', '90%', '70%'].map((w, i) => (
                    <span key={w} className="block rounded-[6px] motion-safe:animate-[wShimmer_1.4s_linear_infinite]" style={{ width: w, height: [18, 14, 12][i], background: SKELETON, backgroundSize: '200% 100%', animationDelay: `${i * 0.1}s` }} />
                  ))}
                </div>
              ))}
            </div>
          ) : failed ? (
            <p role="alert" className="rounded-[22px] border border-[rgba(255,107,74,.5)] bg-[rgba(255,107,74,.2)] px-4 py-3.5 text-[14px] leading-[1.5]">
              {navigator.onLine ? 'The check didn’t finish. Your routine is saved and unchanged. Try again in a moment.' : 'You’re offline, so the check can’t run. Your routine is saved and unchanged.'}
            </p>
          ) : done && findings.length === 0 ? (
            <div className="flex items-center gap-4 rounded-[24px] bg-white/[.08] p-4">
              <span className="font-dot text-[40px] leading-none text-lime">00</span>
              <span className="text-[15px] leading-[1.45]">No conflicts, duplicates or gaps found in this routine.</span>
            </div>
          ) : done ? (
            <div className="grid gap-3 @min-[700px]:grid-cols-2">
              {sorted.map((f, i) => {
                const sev = SEVERITY_STYLE[f.severity]
                const open = !phone || openKey === f.key
                return (
                  <article key={f.key} className="flex flex-col rounded-[24px] border border-white/[.12] bg-white/[.08] backdrop-blur-[12px]" style={{ animation: `wRise .45s ${i * 70}ms both` }}>
                    <div className={`flex items-start gap-2.5 p-4 ${open ? 'pb-0' : ''}`}>
                      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-pill px-3 py-1.5 text-[12.5px] leading-none text-ink" style={{ background: sev.bg }}>
                            <span aria-hidden>{sev.glyph} </span>
                            {f.severity}
                            <span className="sr-only"> severity</span>
                          </span>
                          <span className="rounded-pill bg-white/[.14] px-3 py-1.5 text-[12.5px] leading-none">{f.kind}</span>
                          {f.ai ? <AITag label="AI suggestion" className="text-ink" /> : <span className="rounded-pill border border-white/30 px-2.5 py-[5px] font-mono text-[11px] leading-none">FIXED RULE</span>}
                        </span>
                        <h3 className={`text-[17px] leading-[1.3] font-normal ${open ? '' : 'line-clamp-2'}`}>{f.title}</h3>
                      </div>
                      {phone ? (
                        <button type="button" aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'} onClick={() => setOpenKey(open ? null : f.key)} className="hit44 grid size-8 shrink-0 place-items-center rounded-full bg-white/[.12]">
                          <ChevronDown size={16} strokeWidth={1.8} aria-hidden className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                        </button>
                      ) : null}
                    </div>
                    {open ? (
                      <div className="flex flex-1 flex-col gap-3 p-4 pt-3">
                        {f.entries.length ? (
                          <span className="flex flex-wrap gap-1.5">
                            {f.entries.map((e) => (
                              <span key={e.id} className="flex items-center gap-2 rounded-pill bg-white/[.12] py-1 pr-3 pl-1 text-[13px]">
                                <ProductImage product={imageOf(e)} size={24} decorative />
                                {entryName(e)}
                              </span>
                            ))}
                          </span>
                        ) : f.products.length ? (
                          <span className="flex flex-wrap gap-1.5">
                            {f.products.map((p) => (
                              <span key={p} className="rounded-pill bg-white/[.12] px-3 py-1.5 text-[13px]">
                                {p}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        <p className="text-[14px] leading-[1.5] text-[#D5D8FF]">{f.fix}</p>
                        <span className="mt-auto flex flex-wrap gap-2 pt-1">
                          {f.find ? (
                            <button type="button" onClick={() => onFind(f)} className="min-h-10 rounded-pill bg-white px-4 text-[14px] text-ink">
                              Find one
                            </button>
                          ) : null}
                          {f.alternate && f.entries.length === 2 ? (
                            <button type="button" disabled={alternating !== null} aria-busy={alternating === f.key} onClick={() => void alternate(f)} className="min-h-10 rounded-pill bg-white px-4 text-[14px] text-ink disabled:opacity-60">
                              {alternating === f.key ? 'Saving…' : 'Alternate these'}
                            </button>
                          ) : null}
                          <button type="button" onClick={() => shell.openAdvisor(f.question, 'Routine check')} className="min-h-10 rounded-pill bg-white/[.16] px-4 text-[14px] transition-colors hover:bg-white/[.26]">
                            Ask Wisp why →
                          </button>
                        </span>
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
      {done && findings.length ? (
        <details className="mt-4 text-[12.5px] leading-[1.5] text-[#C9CFFF]">
          <summary className="hit44 inline-block cursor-pointer list-none underline underline-offset-4">How this was checked</summary>
          <p className="max-w-[760px] pt-1.5">
            FIXED RULE = matched against Willow’s ingredient rules.{anyAi ? ' AI SUGGESTION = Gemini’s reading of the lists, which can be wrong.' : ''}
            {check.data?.notes.length ? ` Also checked: ${check.data.notes.join(' ')}` : ''}
          </p>
        </details>
      ) : null}
    </section>
  )
}
