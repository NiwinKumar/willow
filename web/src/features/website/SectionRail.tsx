import { useEffect, useState } from 'react'

import { useMediaQuery } from '../../lib/useMediaQuery'
import { glide, SECTIONS } from './scroll'

/** The four rail groups that cover the landing's sections. */
const GROUPS: [string, string[]][] = [
  ['Intro', ['top', 'ways']],
  ['How it works', ['how']],
  ['Science', ['science', 'limits']],
  ['Fairness & privacy', ['fairness', 'privacy']],
]
const LABEL_BG = [
  'radial-gradient(120% 140% at 15% 0%, #FFB27A 0%, transparent 60%), radial-gradient(120% 140% at 100% 100%, #FF8A70 0%, transparent 65%), #FFD9C2',
  'radial-gradient(120% 140% at 15% 0%, #9CD3FF 0%, transparent 60%), radial-gradient(120% 140% at 100% 100%, #7FA6FF 0%, transparent 65%), #CFE6FF',
  'radial-gradient(120% 140% at 15% 0%, #D8B8FF 0%, transparent 60%), radial-gradient(120% 140% at 100% 100%, #A994FF 0%, transparent 65%), #E6D9FF',
  'radial-gradient(120% 140% at 15% 0%, #B8E986 0%, transparent 60%), radial-gradient(120% 140% at 100% 100%, #7FD08A 0%, transparent 65%), #D6F2C2',
]

type Measure = { pos: number; end: boolean; past: boolean }

/** Where the reader is: section index × 5 plus progress through it (0..4.99), as in the design. */
function measure(): Measure | null {
  const y = window.scrollY + window.innerHeight * 0.4
  const tops = SECTIONS.map((id) => {
    const el = document.getElementById(id)
    return el ? el.getBoundingClientRect().top + window.scrollY : null
  })
  if (tops.some((t) => t === null)) return null
  const end = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4
  let pos = 0
  if (end) pos = (SECTIONS.length - 1) * 5
  else
    for (let i = 0; i < tops.length; i++) {
      const top = tops[i]!
      const nx = tops[i + 1]
      if (y >= top && (nx === undefined || y < nx!)) {
        pos = i * 5 + (nx === undefined ? 0 : Math.min(4.99, (5 * (y - top)) / (nx! - top)))
        break
      }
    }
  const hero = document.getElementById('top')
  const past = hero ? hero.getBoundingClientRect().bottom < window.innerHeight * 0.4 : true
  return { pos, end, past }
}

/**
 * The fixed right-edge section rail (≥760px): one bar per group that fills as you read it, a gradient
 * label pill on hover or focus. It appears once the intro is gone and the hero is scrolled past.
 */
export function SectionRail({ ready }: { ready: boolean }) {
  const wide = useMediaQuery('(min-width: 760px)')
  const [m, setM] = useState<Measure>({ pos: 0, end: false, past: false })
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    let ticking = false
    const on = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const next = measure()
        if (next) setM((p) => (Math.abs(next.pos - p.pos) > 0.02 || next.end !== p.end || next.past !== p.past ? next : p))
      })
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
    }
  }, [])

  if (!wide) return null
  const vis = ready && m.past
  const sec = Math.min(SECTIONS.length - 1, Math.floor(m.pos / 5))
  const frac = (m.pos - sec * 5) / 5
  const secId = SECTIONS[sec]
  const groupOf = GROUPS.findIndex(([, members]) => members.includes(secId))
  const rows = GROUPS.map(([label, members], gi) => {
    const on = members.includes(secId)
    const hov = hover === gi
    const prog = on ? (m.end && gi === GROUPS.length - 1 ? 1 : (members.indexOf(secId) + frac) / members.length) : groupOf > gi ? 1 : 0
    return { label, members, on, hov, show: vis && hov, fill: on ? Math.max(0.08, prog) : 0, delay: `${vis ? gi * 90 : (3 - gi) * 50}ms` }
  })

  return (
    <>
      <nav aria-label="Sections" onMouseLeave={() => setHover(null)} className="fixed right-[clamp(14px,1.3vw,22px)] top-1/2 z-50 flex -translate-y-1/2 flex-col items-end text-white mix-blend-difference">
        {rows.map((r, gi) => (
          <button
            key={r.label}
            type="button"
            onClick={() => glide(r.members[0])}
            onMouseEnter={() => setHover(gi)}
            onFocus={() => setHover(gi)}
            onBlur={() => setHover(null)}
            aria-label={r.label}
            aria-current={r.on ? 'true' : undefined}
            tabIndex={vis ? 0 : -1}
            className="relative flex h-4 w-9 items-center justify-end border-0 bg-transparent p-0"
            style={{ pointerEvents: vis ? 'auto' : 'none', opacity: vis ? 1 : 0, translate: `${vis ? 0 : 14}px 0`, transition: `opacity .7s ease ${r.delay}, translate .9s cubic-bezier(.2,.8,.2,1) ${r.delay}` }}
          >
            <span
              aria-hidden
              className="relative block h-0.5 overflow-hidden rounded-[2px] transition-[width,background] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]"
              style={{ width: r.on ? 30 : r.hov ? 22 : 14, background: `rgba(255,255,255,${r.on ? 0.35 : r.hov ? 0.6 : 0.4})` }}
            >
              <span className="absolute inset-0 origin-right bg-white transition-[scale] duration-[250ms] ease-linear" style={{ scale: `${r.fill} 1` }} />
            </span>
          </button>
        ))}
      </nav>
      <div aria-hidden className="pointer-events-none fixed right-[calc(clamp(14px,1.3vw,22px)+44px)] top-1/2 z-50 flex -translate-y-1/2 flex-col items-end">
        {rows.map((r, gi) => (
          <div key={r.label} className="relative h-4 w-0">
            <span
              className="absolute right-0 top-1/2 origin-right whitespace-nowrap rounded-pill px-4 py-[9px] text-[14px] tracking-[-0.005em] text-ink transition-[opacity,translate,scale,filter] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]"
              style={{
                translate: `${r.show ? 0 : 10}px -50%`,
                scale: r.show ? 1 : 0.92,
                background: LABEL_BG[gi],
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7), inset 0 0 18px rgba(255,255,255,.35), 0 14px 32px -14px rgba(0,0,0,.35)',
                opacity: r.show ? 1 : 0,
                filter: `blur(${r.show ? 0 : 4}px)`,
              }}
            >
              {r.label}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
