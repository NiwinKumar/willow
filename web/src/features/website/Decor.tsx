import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { LogoMark } from '../../components/willow/Logo'

/**
 * Decoration for the website, all CSS (no images are shipped): the hero's blurred flowers, the soft
 * drifting blobs behind onboarding and the tour, and the large logo lockup.
 */

type FlowerSpec = { left: string; top: string; size: string; petal: string; edge: string; core: string; rot: number; dur: number; stemH: string; lean: number }

/** The design's flowers(): five blurred petals multiplied over each other, a soft core, a stem fading out. */
function Flower({ f, i }: { f: FlowerSpec; i: number }) {
  return (
    <div className="absolute" style={{ left: f.left, top: f.top, width: f.size, height: f.size, animation: `wDrift ${f.dur}s ease-in-out ${-i * 3}s infinite alternate` }}>
      <div
        className="absolute rounded-pill"
        style={{ left: '50%', top: '58%', width: 'max(10px, 1.6%)', height: f.stemH, translate: '-50% 0', rotate: `${f.lean}deg`, transformOrigin: 'top', background: 'linear-gradient(180deg, #6FA6B8, rgba(94,155,184,0))', filter: 'blur(6px)', opacity: 0.85 }}
      />
      <div className="absolute rounded-full" style={{ left: '62%', top: '120%', width: '46%', height: '18%', rotate: '-30deg', background: 'radial-gradient(circle, rgba(110,170,170,.7), transparent 70%)', filter: 'blur(10px)' }} />
      {[0, 1, 2, 3, 4].map((p) => (
        <div
          key={p}
          className="absolute rounded-full"
          style={{
            left: '50%',
            top: '50%',
            width: '60%',
            height: '38%',
            transform: `translate(-50%,-50%) rotate(${p * 72 + f.rot}deg) translateX(34%)`,
            background: `radial-gradient(circle at 30% 50%, ${f.petal} 0%, ${f.edge} 58%, transparent 76%)`,
            filter: 'blur(9px)',
            mixBlendMode: 'multiply',
            opacity: 0.9,
          }}
        />
      ))}
      <div className="absolute rounded-full" style={{ left: '50%', top: '50%', width: '26%', height: '26%', translate: '-50% -50%', background: `radial-gradient(circle, ${f.core}, transparent 70%)`, filter: 'blur(8px)' }} />
    </div>
  )
}

const HERO_FLOWERS: FlowerSpec[] = [
  { left: '40%', top: '6%', size: 'min(34vw,470px)', petal: '#FF6B3D', edge: 'rgba(255,190,150,.85)', core: '#FF4A2A', rot: 50, dur: 17, stemH: '120%', lean: 8 },
  { left: '22%', top: '-4%', size: 'min(22vw,300px)', petal: '#7E8DFF', edge: 'rgba(170,180,255,.8)', core: '#5C6BFF', rot: 30, dur: 19, stemH: '140%', lean: -4 },
  { left: '8%', top: '44%', size: 'min(28vw,380px)', petal: '#FF5A2A', edge: 'rgba(255,170,120,.85)', core: '#FF3D1F', rot: 10, dur: 16, stemH: '90%', lean: 6 },
  { left: '74%', top: '48%', size: 'min(16vw,220px)', petal: '#C9A8FF', edge: 'rgba(230,200,255,.8)', core: '#B087FF', rot: 0, dur: 21, stemH: '80%', lean: -6 },
]

/** The hero imagery: blurred flowers inside a radial mask, breathing slowly. `style` carries the parallax. */
export function HeroBloom({ className = '', style, mask = 'radial-gradient(75% 70% at 62% 52%, #000 45%, transparent 82%)' }: { className?: string; style?: CSSProperties; mask?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none overflow-hidden ${className}`} style={{ WebkitMaskImage: mask, maskImage: mask, ...style }}>
      <div className="absolute inset-0 animate-[wHeroBreathe_16s_ease-in-out_infinite]" style={{ filter: 'saturate(1.05)' }}>
        {HERO_FLOWERS.map((f, i) => (
          <Flower key={i} f={f} i={i} />
        ))}
      </div>
    </div>
  )
}

type Blob = [left: string, top: string, w: string, h: string, bg: string, blur: number, dur: number]

const SOFT_BLOBS: Blob[] = [
  ['-8%', '-6%', '40vw', '40vw', 'radial-gradient(circle, rgba(255,150,100,.55), transparent 70%)', 40, 18],
  ['64%', '58%', '44vw', '44vw', 'radial-gradient(circle, rgba(110,170,255,.5), transparent 70%)', 40, 20],
  ['70%', '-10%', '30vw', '30vw', 'radial-gradient(circle, rgba(200,160,255,.5), transparent 70%)', 40, 16],
]

/** Fixed full-page backdrop: a tinted canvas plus three drifting blurred blobs (onboarding, judge tour). */
export function SoftBackdrop({ background }: { background: string }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden" style={{ background }}>
      {SOFT_BLOBS.map(([left, top, width, height, bg, blur, dur], i) => (
        <div key={i} className="absolute rounded-full" style={{ left, top, width, height, background: bg, filter: `blur(${blur}px)`, animation: `wDrift ${dur}s ease-in-out ${-i * 2.3}s infinite alternate` }} />
      ))}
    </div>
  )
}

/** The website header lockup: 38px mark, 34px light wordmark. */
export function Lockup() {
  return (
    <Link to="/" aria-label="Willow home" className="flex items-center gap-3 text-ink no-underline">
      <LogoMark size={38} />
      <span className="text-[34px] font-light tracking-[-0.03em]">willow</span>
    </Link>
  )
}

/** Round 52px glass back button used by onboarding and the tour. */
export const backButton = 'grid size-[52px] shrink-0 place-items-center rounded-full border border-line bg-white/50 text-[20px] text-ink no-underline backdrop-blur-[12px] transition-colors hover:bg-white/80'
