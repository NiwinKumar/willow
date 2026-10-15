import { useState } from 'react'

import { useShell } from '../../components/shell/ShellContext'
import { AITag } from '../../components/willow/AITag'
import type { RoutineCheck } from '../../data/types'
import type { QueryResult } from '../../lib/query'
import { SEVERITY_STYLE, type Finding } from './routineModel'

const SKELETON = 'linear-gradient(90deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.22) 50%, rgba(255,255,255,.08) 100%)'

/**
 * The dark compatibility-check card (design: "■ ROUTINE CHECK"). It runs by itself whenever the routine
 * changes (useRoutineCheck is keyed by the routine), so there is no "stale" state; "Run again" re-asks.
 */
export function RoutineCheckCard({ check, findings, count, onFind }: { check: QueryResult<RoutineCheck>; findings: Finding[]; count: number; onFind: (f: Finding) => void }) {
  const shell = useShell()
  const [rerun, setRerun] = useState(false)
  const running = check.status === 'loading' || rerun
  const done = check.status === 'ready' && !rerun && check.data !== undefined
  const failed = check.status === 'error' && !rerun
  const anyAi = findings.some((f) => f.ai)
  const title = count === 0 ? 'Do these products work together?' : running ? 'Checking…' : failed ? 'The check didn’t finish' : done ? (findings.length ? `${findings.length} thing${findings.length > 1 ? 's' : ''} to look at` : 'Looks compatible') : 'Do these products work together?'

  const runAgain = async () => {
    setRerun(true)
    try {
      await check.refetch()
    } finally {
      setRerun(false)
    }
  }

  return (
    <section
      aria-label="Compatibility check"
      className="relative flex flex-col gap-[18px] overflow-hidden rounded-[34px] p-[clamp(18px,2.4vw,26px)] text-inverse squircle"
      style={{
        background: 'radial-gradient(70% 60% at 50% 0%, #4A5BFF 0%, #1D237A 45%, #0A0C2A 85%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08), inset 0 -40px 80px rgba(110,139,255,.25), 0 40px 80px -40px rgba(29,35,122,.8)',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[12px] tracking-[.08em] text-[#C9CFFF]">■ ROUTINE CHECK · {count} PRODUCT{count === 1 ? '' : 'S'} · RUNS WHEN YOUR ROUTINE CHANGES</span>
          <h2 className="text-[24px] font-light tracking-[-0.02em]">{title}</h2>
        </div>
        {count > 0 ? (
          <button type="button" onClick={() => void runAgain()} disabled={running} className="min-h-11 rounded-pill bg-white px-[18px] text-[15px] text-ink">
            {running ? 'Checking…' : failed ? 'Try again' : 'Run again'}
          </button>
        ) : null}
      </div>

      {count === 0 ? (
        <p className="max-w-[680px] leading-[1.55] text-[#D5D8FF]">Compares ingredient lists across your morning and evening products. Looks for conflicting actives, duplicates and gaps such as missing sunscreen.</p>
      ) : running ? (
        <>
          <div role="status" aria-label="Checking ingredient lists" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))' }}>
            {[0, 1, 2].map((k) => (
              <div key={k} className="flex h-[190px] flex-col gap-3 rounded-[30px] border border-white/10 bg-white/[.06] p-5">
                {['50%', '85%', '65%'].map((w, i) => (
                  <span key={w} className="block rounded-[8px] motion-safe:animate-[wShimmer_1.4s_linear_infinite]" style={{ width: w, height: [22, 18, 14][i], background: SKELETON, backgroundSize: '200% 100%', animationDelay: `${i * 0.1}s` }} />
                ))}
              </div>
            ))}
          </div>
          <span className="text-[14px] text-[#C9CFFF]">Checking the ingredient lists against Willow’s rules, with Gemini looking for duplicates and gaps…</span>
        </>
      ) : failed ? (
        <p role="alert" className="rounded-[20px] border border-[rgba(255,107,74,.5)] bg-[rgba(255,107,74,.2)] px-[18px] py-3.5 leading-[1.5]">
          {navigator.onLine ? 'The check didn’t finish. Your routine is saved and unchanged. Try again in a moment.' : 'You’re offline, so the check can’t run. Your routine is saved and unchanged.'}
        </p>
      ) : done && findings.length === 0 ? (
        <div className="flex items-center gap-4 rounded-[30px] bg-white/[.08] p-5">
          <span className="font-dot text-[44px] text-lime">00</span>
          <span className="leading-[1.5]">No conflicts, duplicates or gaps found in this routine.</span>
        </div>
      ) : done ? (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))' }}>
            {findings.map((f, i) => {
              const sev = SEVERITY_STYLE[f.severity]
              return (
                <article key={f.key} className="flex flex-col gap-3 rounded-[30px] border border-white/[.12] bg-white/[.08] p-5 backdrop-blur-[12px]" style={{ animation: `wRise .5s ${i * 90}ms both` }}>
                  <span className="flex flex-wrap gap-1.5">
                    <span className="rounded-pill px-3 py-1.5 text-[12px] text-ink" style={{ background: sev.bg }}>
                      <span aria-hidden>{sev.glyph} </span>
                      {f.severity}
                      <span className="sr-only"> severity</span>
                    </span>
                    <span className="rounded-pill bg-white/[.14] px-3 py-1.5 text-[12px]">{f.kind}</span>
                    {f.ai ? <AITag label="AI suggestion" className="text-ink" /> : <span className="rounded-pill border border-white/30 px-3 py-1.5 font-mono text-[11px]">FIXED RULE</span>}
                  </span>
                  <span className="text-[18px] leading-[1.3]">{f.title}</span>
                  {f.products.length ? (
                    <span className="flex flex-wrap gap-[5px]">
                      {f.products.map((p) => (
                        <span key={p} className="rounded-pill bg-white/[.12] px-2.5 py-[5px] text-[12px]">
                          {p}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="text-[14px] leading-[1.5] text-[#D5D8FF]">{f.fix}</span>
                  <span className="mt-auto flex flex-wrap gap-2">
                    {f.find ? (
                      <button type="button" onClick={() => onFind(f)} className="min-h-11 rounded-pill bg-white px-4 text-[13px] text-ink">
                        Find one
                      </button>
                    ) : null}
                    <button type="button" onClick={() => shell.openAdvisor(f.question, 'Routine check')} className="min-h-11 rounded-pill bg-white/[.16] px-4 text-[13px] transition-colors hover:bg-white/[.26]">
                      Ask the advisor why →
                    </button>
                  </span>
                </article>
              )
            })}
          </div>
          <span className="text-[13px] leading-[1.5] text-[#C9CFFF]">
            FIXED RULE = matched against Willow’s ingredient rules.{anyAi ? ' AI SUGGESTION = Gemini’s reading of the lists, which can be wrong.' : ''}
            {check.data?.notes.length ? ` Also checked: ${check.data.notes.join(' ')}` : ''}
          </span>
        </>
      ) : null}
    </section>
  )
}
