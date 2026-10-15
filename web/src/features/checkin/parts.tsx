import type { ReactNode } from 'react'

/** "■ NEW SESSION · 15 OCT" in Geist Mono caps (CAP eyebrows are 12px, .08em). */
export function MonoEyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[12px] tracking-[.08em] text-ink-2 uppercase ${className}`}>■ {children}</span>
}

/** Instrument Serif page title of the capture steps. */
export function SerifTitle({ children, id, size = 'lg' }: { children: ReactNode; id?: string; size?: 'lg' | 'md' }) {
  return (
    <h1 id={id} tabIndex={-1} className={`m-0 font-serif font-normal leading-[.95] outline-none ${size === 'lg' ? 'text-[clamp(31px,3vw,40px)]' : 'text-[clamp(28px,3.25vw,42px)]'}`}>
      {children}
    </h1>
  )
}

export type OrbState = 'run' | 'done' | 'fail'

/** The processing orb: three breathing blurred layers and a slow dashed ring (CAP orb()). */
export function Orb({ state }: { state: OrbState }) {
  const core =
    state === 'fail'
      ? 'radial-gradient(circle at 35% 35%, #FFE3DA, #FF8A6A 40%, #C2412A 75%, transparent 80%)'
      : state === 'done'
        ? 'radial-gradient(circle at 35% 35%, #F7FFD8, var(--signal-baseline) 40%, var(--willow-400) 75%, transparent 80%)'
        : 'radial-gradient(circle at 35% 35%, #FFE3F1, var(--aura-lilac) 40%, var(--aura-violet) 75%, transparent 80%)'
  const calm = state !== 'run'
  const layer = (bg: string, blur: number, dur: number, delay: number, inset: string) => (
    <div className="absolute rounded-full transition-[background] duration-1000" style={{ inset, background: bg, filter: `blur(${blur}px)`, animation: `wBreathe ${dur}s ease-in-out ${delay}s infinite` }} />
  )
  return (
    <div aria-hidden className="relative aspect-square w-[min(72vw,320px)]">
      {layer(core, 6, calm ? 8 : 4, 0, '0')}
      {layer('radial-gradient(circle at 60% 60%, rgba(255,178,122,.9), transparent 60%)', 20, 5, -2, '10%')}
      {layer('radial-gradient(circle at 40% 70%, rgba(156,211,255,.9), transparent 60%)', 24, 6, -4, '6%')}
      <div className="absolute -inset-[6%] rounded-full border border-dashed border-ink/25" style={{ animation: `wSpin ${calm ? 60 : 14}s linear infinite` }} />
    </div>
  )
}

/** Soft drifting colour behind the flow (CAP page canvas + blobs); hue is decoration only. */
export function FlowBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ background: 'radial-gradient(40% 40% at 90% 10%, rgba(255,178,122,.5), transparent 70%), radial-gradient(40% 45% at 0% 90%, rgba(156,211,255,.55), transparent 70%), var(--bg-canvas)' }}>
      <div className="absolute rounded-full blur-[40px]" style={{ left: '70%', top: '-10%', width: '40vw', height: '40vw', background: 'rgba(255,170,120,.45)', animation: 'wDrift 18s ease-in-out 0s infinite alternate' }} />
      <div className="absolute rounded-full blur-[40px]" style={{ left: '-10%', top: '60%', width: '45vw', height: '45vw', background: 'rgba(120,180,255,.45)', animation: 'wDrift 22s ease-in-out -3s infinite alternate' }} />
    </div>
  )
}

/** A banner across the top while sample photos run (CAP isSample). */
export function SampleBanner() {
  return (
    <div role="note" className="relative z-[21] bg-selected px-4 py-2.5 text-center font-mono text-[12px] tracking-[.06em] text-inverse">
      ■ SAMPLE RUN · SAMPLE PHOTOS GO THROUGH THE REAL PIPELINE · NOT YOUR SKIN
    </div>
  )
}

/** Notice cards in the design's language: ink bar (offline), yellow status, quiet sunken note. */
export function Notice({ tone = 'quiet', role, children, className = '' }: { tone?: 'ink' | 'yellow' | 'quiet'; role?: 'alert' | 'status'; children: ReactNode; className?: string }) {
  const t = tone === 'ink' ? 'bg-selected text-inverse' : tone === 'yellow' ? 'bg-cta text-ink' : 'bg-surface/70 text-ink'
  return (
    <div role={role} className={`m-0 rounded-[20px] px-[18px] py-3.5 text-[15px] leading-[1.45] ${t} ${className}`}>
      {children}
    </div>
  )
}
