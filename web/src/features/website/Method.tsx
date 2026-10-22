import { CHIP_DOT, serviceChips, useDemoStatus } from '../../lib/useDemoStatus'

/** The services answering right now, read live from GET /v1/demo/status, so this is never stale. */
export function LiveStatus({ className = '' }: { className?: string }) {
  const { status: s, failed, waking, gaveUp } = useDemoStatus()
  const pending = !s && !failed
  return (
    <div className={`flex flex-col gap-3 rounded-[28px] bg-surface p-[clamp(18px,2.4vw,26px)] sm:flex-row sm:items-center sm:gap-6 ${className}`}>
      <div className="flex shrink-0 flex-col gap-0.5">
        <span className="text-[15px] font-medium text-ink">Running right now</span>
        <span className="text-[12.5px] text-ink-2">Web {__APP_VERSION__}, checked live</span>
      </div>
      {s ? (
        <ul aria-label="Live service checks" aria-live="polite" className="m-0 flex min-w-0 flex-1 list-none flex-wrap gap-2 p-0 sm:justify-end">
          {serviceChips(s, gaveUp).map((c) => (
            <li key={c.key} className="flex items-center gap-2 rounded-pill bg-white px-3 py-1.5 text-[12.5px]">
              <span aria-hidden className="size-2 rounded-full" style={{ background: CHIP_DOT[c.state] }} />
              {c.label}
              <span className="font-mono text-[11px] text-ink-2">{c.note}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 flex-1 text-[13px] text-ink-2 sm:text-right" aria-live="polite">
          {pending ? 'Asking the services…' : waking ? 'The measurement engine is waking up.' : 'The services did not answer a check just now; reload to ask again.'}
        </p>
      )}
    </div>
  )
}

/** The two rules behind "real change": the noise band (with its formula) and the spot diary. */
export function MethodCards({ className = '' }: { className?: string }) {
  return (
    <div className={`grid gap-4 md:grid-cols-2 ${className}`}>
      <article className="flex flex-col gap-3 rounded-[28px] bg-surface p-[clamp(20px,2.4vw,28px)]">
        <h3 className="m-0 text-[20px] font-normal tracking-[-0.01em]">Noise band</h3>
        <p className="m-0 text-[15px] leading-[1.6] text-ink-2">
          Five photos of the same skin never give identical numbers, so their spread is your noise. A later reading counts as a real change only when it lands outside the band. A band needs at least three usable photos, and it is wider when there are few.
        </p>
        <p className="m-0 mt-auto overflow-x-auto rounded-[14px] bg-white px-4 py-3 font-mono text-[13px] text-ink">band = max(1.96 · √2 · sd, t₀.₉₇₅,ₙ₋₁ · sd · √(1 + 1/n))</p>
      </article>
      <article className="flex flex-col gap-3 rounded-[28px] bg-surface p-[clamp(20px,2.4vw,28px)]">
        <h3 className="m-0 text-[20px] font-normal tracking-[-0.01em]">Spot diary</h3>
        <p className="m-0 text-[15px] leading-[1.6] text-ink-2">
          Each face photo places every spot on a standard face, so the same spot is recognised next time even if your head is turned a little. A single photo can miss a spot, so it takes two to add one or to call it gone.
        </p>
        <ul className="m-0 mt-auto flex list-none flex-wrap gap-2 p-0 text-[13px]">
          <li className="rounded-pill bg-white px-3 py-1.5">Joins after two check-ins show it</li>
          <li className="rounded-pill bg-white px-3 py-1.5">Gone after two clear ones in a row</li>
        </ul>
      </article>
    </div>
  )
}
