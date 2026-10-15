import { HeroRuler } from '../../components/charts'
import { VerdictGlyph } from '../../components/willow/Verdict'
import type { Hero } from './hero'

export function ResultHero({ hero, photos }: { hero: Hero; photos: string }) {
  return (
    <section
      aria-label="Overall result"
      className="relative flex min-h-[440px] flex-[2_1_560px] flex-col gap-[18px] overflow-hidden rounded-[44px] p-[clamp(24px,3.5vw,40px)] transition-[background] duration-[600ms] squircle"
      style={{ background: hero.bg, color: hero.fg, boxShadow: `inset 0 0 0 1px rgba(255,255,255,.35), inset 0 0 90px 24px rgba(255,255,255,.28), 0 40px 80px -50px ${hero.shadow}` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[12px] tracking-[.08em]">■ {hero.eyebrow}</span>
        <span className="rounded-pill bg-white/60 px-3.5 py-2 text-[13px] text-ink backdrop-blur-[10px]">{photos}</span>
      </div>
      <div className="flex flex-1 animate-[wRise_.6s_both] flex-col items-center justify-center gap-1.5 text-center">
        <span className="text-[16px]">{hero.kicker}</span>
        <span className="font-dot text-[clamp(84px,8vw,105px)] leading-[.9] tnum [text-shadow:0_0_40px_rgba(255,255,255,.45)]" style={{ color: hero.grey ? '#9A978F' : '#fff' }}>
          {hero.big}
        </span>
        <span className="max-w-[440px] text-[17px] leading-[1.35]">{hero.bigLabel}</span>
      </div>
      {hero.ruler ? <HeroRuler ratio={hero.ruler.ratio} label={hero.ruler.label} /> : null}
      {hero.chips.length ? (
        <div className="flex flex-wrap justify-center gap-2">
          {hero.chips.map((c) => (
            <span key={c.t} className="flex items-center gap-2 rounded-pill bg-white/60 px-3.5 py-[9px] text-[14px] text-ink backdrop-blur-[12px]">
              {c.g === 'text' ? <span aria-hidden>{c.mark}</span> : <VerdictGlyph kind={c.g} />}
              {c.t}
            </span>
          ))}
        </div>
      ) : null}
      <p className="m-0 max-w-[680px] self-center text-center text-[15px] leading-normal">{hero.text}</p>
    </section>
  )
}
