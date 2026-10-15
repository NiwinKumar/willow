import { ArrowCircle } from './parts'

/** The design's lead-card auras (Willow App.dc.html appVals AURA), plus a quiet grey for checks that didn't finish. */
const AURA = {
  coral: {
    bg: 'radial-gradient(90% 90% at 0% 0%, #FFB27A 0%, transparent 60%), radial-gradient(90% 100% at 100% 100%, #F25FA8 0%, transparent 62%), radial-gradient(70% 70% at 80% 10%, #FFD9C2 0%, transparent 70%), #FF8A70',
    shadow: 'rgba(242,95,168,.6)',
  },
  violet: {
    bg: 'radial-gradient(90% 90% at 0% 0%, #D8B8FF 0%, transparent 60%), radial-gradient(90% 100% at 100% 100%, #7A5CFF 0%, transparent 62%), radial-gradient(60% 60% at 85% 15%, #F25FA8 0%, transparent 70%), #A994FF',
    shadow: 'rgba(122,92,255,.55)',
  },
  sky: {
    bg: 'radial-gradient(90% 90% at 0% 0%, #9CD3FF 0%, transparent 60%), radial-gradient(90% 100% at 100% 100%, #3D7BFF 0%, transparent 62%), radial-gradient(60% 60% at 85% 10%, #E6F3FF 0%, transparent 70%), #7FA6FF',
    shadow: 'rgba(61,123,255,.55)',
  },
  grey: {
    bg: 'radial-gradient(90% 90% at 0% 0%, #FFFFFF 0%, transparent 60%), radial-gradient(90% 100% at 100% 100%, #B8B5AE 0%, transparent 62%), #E3E1DC',
    shadow: 'rgba(18,18,18,.3)',
  },
} as const

export type LeadStep = { t: string; state: 'done' | 'current' | 'todo' }
export type Lead = {
  eyebrow?: string
  title: string
  sub: string
  chips?: string[]
  big?: string
  bigLabel?: string
  /** 0..1, for the baseline progress bar. */
  prog?: number
  steps?: LeadStep[]
  cta?: { label: string; onClick: () => void }
  secondary?: { label: string; onClick: () => void }
  /** Shown instead of the CTA (demo: "Available in your own account"). */
  note?: string
  aura: keyof typeof AURA
}

const STEP_GLYPH = { done: '●', current: '◐', todo: '○' } as const

/** Today's check-in: one aura card whose variant comes from the person's real sessions (see Home.tsx). */
export function LeadCard({ lead }: { lead: Lead }) {
  const a = AURA[lead.aura]
  return (
    <section
      aria-label="Today's check-in"
      className="relative flex min-h-[320px] min-w-0 animate-[wRise_.55s_.06s_both] flex-col gap-3.5 overflow-hidden rounded-[36px] squircle text-ink transition-[background] duration-[600ms]"
      style={{ padding: 'clamp(20px,2.4vw,28px)', background: a.bg, boxShadow: `inset 0 0 0 1px rgba(255,255,255,.35), inset 0 0 70px 18px rgba(255,255,255,.28), 0 34px 70px -46px ${a.shadow}` }}
    >
      <span aria-hidden className="pointer-events-none absolute -top-[50px] -right-[50px] size-[220px] animate-[wBreathe_6s_ease-in-out_infinite] rounded-full blur-[8px]" style={{ background: 'radial-gradient(circle, rgba(255,255,255,.75), rgba(255,255,255,0) 68%)' }} />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[.08em]">{lead.eyebrow ? `■ ${lead.eyebrow}` : ''}</span>
        {lead.chips?.length ? (
          <span className="flex flex-wrap gap-[5px]">
            {lead.chips.map((c) => (
              <span key={c} className="rounded-pill bg-white/60 px-2.5 py-[5px] text-[12px] text-ink backdrop-blur-[10px]">
                {c}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <div className="relative flex flex-1 items-end justify-between gap-3.5">
        <div className="flex min-w-0 flex-auto flex-col gap-2">
          <h2 className="m-0 text-[clamp(26px,2.4vw,32px)] leading-[1.02] font-normal tracking-[-0.02em]">{lead.title}</h2>
          <p className="m-0 text-[14px] leading-[1.45]">{lead.sub}</p>
        </div>
        {lead.big ? (
          <div className="flex flex-none flex-col items-end gap-1 text-right">
            <span className="font-dot text-[clamp(48px,4.4vw,64px)] leading-[.85] [text-shadow:0_0_30px_rgba(255,255,255,.45)]">{lead.big}</span>
            {lead.bigLabel ? <span className="max-w-[120px] text-[12px]">{lead.bigLabel}</span> : null}
          </div>
        ) : null}
      </div>
      {lead.prog !== undefined ? (
        <div role="progressbar" aria-label={lead.bigLabel ?? 'Progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(lead.prog * 100)} className="relative h-[5px] overflow-hidden rounded-[5px] bg-white/45">
          <span className="absolute inset-y-0 left-0 rounded-[5px] bg-selected transition-[width] duration-[800ms] ease-standard" style={{ width: `${Math.round(lead.prog * 100)}%` }} />
        </div>
      ) : null}
      {lead.steps ? (
        <div className="relative flex flex-col gap-2.5" aria-live="polite">
          <div aria-hidden className="h-[5px] animate-[wShimmer_1.6s_linear_infinite] rounded-[5px] bg-[length:200%_100%]" style={{ backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,.35) 0%, rgba(255,255,255,.95) 50%, rgba(255,255,255,.35) 100%)' }} />
          <ol className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0">
            {lead.steps.map((st) => (
              <li key={st.t} aria-current={st.state === 'current' ? 'step' : undefined} className={`flex items-center gap-1.5 text-[12.5px] ${st.state === 'todo' ? 'opacity-55' : ''}`}>
                <span aria-hidden>{STEP_GLYPH[st.state]}</span>
                {st.t}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {lead.cta || lead.note ? (
        <div className="relative flex flex-wrap items-center gap-2">
          {lead.cta ? (
            <button
              type="button"
              onClick={lead.cta.onClick}
              className="flex min-h-[46px] items-center gap-3 rounded-pill bg-selected pr-[5px] pl-5 text-[14.5px] text-inverse shadow-[0_14px_26px_-14px_rgba(0,0,0,.6)] transition-transform duration-[250ms] hover:-translate-y-0.5"
            >
              {lead.cta.label}
              <ArrowCircle tone="yellow" size={36} />
            </button>
          ) : null}
          {lead.secondary ? (
            <button type="button" onClick={lead.secondary.onClick} className="min-h-11 rounded-pill bg-white/60 px-4 text-[13px] text-ink backdrop-blur-[10px] hover:bg-white/80">
              {lead.secondary.label}
            </button>
          ) : null}
          {lead.note ? <span className="rounded-pill bg-white/60 px-3.5 py-2.5 text-[13px] backdrop-blur-[10px]">{lead.note}</span> : null}
        </div>
      ) : null}
    </section>
  )
}
