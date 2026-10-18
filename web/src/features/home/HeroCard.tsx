import { useState } from 'react'

import { ArrowCircle, Glyph } from './parts'

export type HeroLine = { g: string; t: string }

/**
 * The sunrise greeting card: serif greeting, two or three glyph lines built from real verdicts, and the
 * blurred bloom. The design uses a photo of a flower; it is recreated here with CSS (no images in the repo).
 */
export function HeroCard({ name, lines, onAsk, askLabel = 'Ask about today', next }: { name: string | null; lines: HeroLine[]; onAsk?: () => void; askLabel?: string; next?: string | null }) {
  // The greeting and date are read once per visit (they do not tick while the page is open).
  const [now] = useState(() => new Date())
  const hr = now.getHours()
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'
  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()
  return (
    <section
      aria-label="Today"
      className="relative isolate flex min-h-[clamp(240px,20vw,260px)] min-w-0 animate-[wRise_.6s_both] flex-col justify-between gap-7 overflow-hidden rounded-[36px] squircle text-ink"
      style={{
        padding: 'clamp(20px,2.4vw,30px)',
        background: 'linear-gradient(180deg, #F8E2CB 0%, #F4C6B6 38%, #DDBBDD 62%, #9DB4E8 84%, #84A3E0 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.4), 0 40px 80px -50px rgba(40,50,110,.5)',
      }}
    >
      <Bloom />
      <span aria-hidden className="absolute inset-0 -z-10" style={{ background: 'linear-gradient(90deg, rgba(250,240,232,.42) 0%, rgba(250,240,232,.12) 42%, rgba(250,240,232,0) 64%)' }} />
      <span
        aria-hidden
        className="absolute inset-0 -z-10 opacity-55 mix-blend-overlay"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E\")" }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[11px] tracking-[.08em]">■ {date}</span>
        {/* The check-in schedule: "Check-in due today", "2 days late", "Next check-in Sat 17 Oct". */}
        {next ? <span className="rounded-pill bg-white/55 px-3 py-1.5 text-[12.5px] backdrop-blur-[10px]">{next}</span> : null}
      </div>
      <div className="flex flex-col gap-4">
        <h1 className="m-0 font-serif text-[clamp(40px,3.8vw,58px)] leading-[.9] font-normal tracking-[-0.02em]">
          {/* A guest has no name to greet ("Good evening, there" read oddly). */}
          {name ? (
            <>
              {greet},
              <br />
              <span className="italic">{name}</span>
            </>
          ) : (
            `${greet}.`
          )}
        </h1>
        {/* The lines on the left and the ask button in the bottom-right corner, sharing their last baseline;
            on a narrow card the button wraps below them and stays on the right. */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          {lines.length ? (
            <div className="flex max-w-[560px] min-w-0 flex-1 basis-[300px] flex-col gap-1">
              {lines.map((l, i) => (
                <p key={l.t} className="m-0 flex animate-[wWord_.9s_both] items-baseline gap-3 text-[15px] leading-[1.45] font-light tracking-[-0.005em]" style={{ animationDelay: `${200 + i * 140}ms` }}>
                  <Glyph g={l.g} />
                  <span>{l.t}</span>
                </p>
              ))}
            </div>
          ) : null}
          {onAsk ? (
            <button
              type="button"
              onClick={onAsk}
              className="ml-auto flex min-h-11 shrink-0 items-center gap-2.5 rounded-pill bg-white/62 pr-[5px] pl-3.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,.7)] backdrop-blur-[16px] transition-[background,translate] duration-300 hover:-translate-y-px hover:bg-white/85"
            >
              {askLabel}
              <ArrowCircle />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/** A soft blurred bloom on its stem, masked into the right of the card (the design's hero flower, in CSS). */
function Bloom() {
  const petal = (left: string, top: string, w: string, h: string, rotate: number, colour: string, blur = 8) => (
    <span className="absolute rounded-[50%]" style={{ left, top, width: w, height: h, rotate: `${rotate}deg`, background: `radial-gradient(closest-side, ${colour} 0%, ${colour} 45%, transparent 100%)`, filter: `blur(${blur}px)` }} />
  )
  return (
    <span
      aria-hidden
      className="absolute -z-10 aspect-square animate-[wBreathe_14s_ease-in-out_infinite]"
      style={{
        right: '-4%',
        top: '-14%',
        height: '128%',
        filter: 'blur(5px) saturate(1.08)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)',
        maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)',
      }}
    >
      {/* stems and leaves (teal into blue) */}
      <span className="absolute rounded-pill" style={{ left: '54.5%', top: '36%', width: '1.6%', height: '66%', rotate: '-3deg', background: 'linear-gradient(180deg, #7DB5B0, #4C86D8)', filter: 'blur(2px)' }} />
      <span className="absolute rounded-pill" style={{ left: '39%', top: '70%', width: '1.4%', height: '32%', rotate: '6deg', background: 'linear-gradient(180deg, #7DB5B0, #4C86D8)', filter: 'blur(2px)' }} />
      {petal('55%', '52%', '7%', '22%', 18, 'rgba(110,170,190,.85)', 4)}
      {petal('42%', '82%', '24%', '20%', 0, 'rgba(76,134,216,.75)', 10)}
      {/* upper bloom: lilac-blue petals, a closed bud, an orange flower beside it */}
      {petal('34%', '10%', '38%', '26%', -8, 'rgba(143,168,240,.95)', 7)}
      {petal('46%', '9%', '24%', '16%', 0, 'rgba(227,181,240,.85)', 7)}
      {petal('49%', '29%', '9%', '12%', 0, 'rgba(110,140,130,.75)', 4)}
      {petal('56%', '18%', '32%', '30%', 10, 'rgba(255,184,150,.95)', 8)}
      {petal('61%', '25%', '18%', '16%', 0, 'rgba(255,107,74,.9)', 6)}
      {/* lower bloom: peach petals around a coral core */}
      {petal('16%', '46%', '40%', '28%', -6, 'rgba(255,184,150,.95)', 8)}
      {petal('20%', '50%', '30%', '20%', 0, 'rgba(255,150,105,.95)', 6)}
      {petal('30%', '55%', '14%', '11%', 0, 'rgba(255,107,74,.95)', 5)}
    </span>
  )
}
