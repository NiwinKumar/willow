import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Willow's loading moment, ported from the design's intro loader (Willow.dc.html): a 64×64 dot-matrix
 * tulip, ordered-dithered with an 8×8 Bayer matrix, that flies in, condenses into the soft logo bud,
 * holds, and flies out again on a 3.8 s loop.
 *
 *   <WillowLoader />                 full-screen white cover while the app or a page opens
 *   <WillowLoader inline label=… />  a compact tulip inside a card or panel, looping while it waits
 *   <WillowIntro onDone={…} />       the landing's intro: plays once per browser session, then opens
 *                                    with the design's iris reveal (the page shows through a growing hole)
 *
 * Under reduced motion the tulip is drawn once, fully formed, and nothing moves.
 */

const N = 64
const S = 320
const CELL = S / N
const LOOP_MS = 3800
const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
]
const sm = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

type Shape = { field: Float32Array; colour: string[] }
let shape: Shape | null = null

/** The tulip as a field (0..1 per cell) and a colour per cell, built once: head, two petals, stem, leaf. */
function tulip(): Shape {
  if (shape) return shape
  const field = new Float32Array(N * N)
  const colour: string[] = []
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
  const coral = [255, 107, 74]
  const pink = [242, 95, 168]
  const lilac = [201, 168, 255]
  const stemGreen = [111, 174, 156]
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N
      const v = (y + 0.5) / N
      const head = sm(1.15 - (((u - 0.5) / 0.16) ** 2 + ((v - 0.35) / 0.2) ** 2))
      const lp = sm(1.1 - (((u - 0.41) / 0.08) ** 2 + ((v - 0.22) / 0.12) ** 2)) * 0.9
      const rp = sm(1.1 - (((u - 0.59) / 0.08) ** 2 + ((v - 0.22) / 0.12) ** 2)) * 0.9
      const flower = Math.max(head, lp, rp)
      const stem = v > 0.52 && v < 0.95 ? sm(1 - Math.abs(u - 0.5 - (v - 0.52) * 0.04) / 0.018) * 0.95 : 0
      const lu = (u - 0.61) * Math.cos(0.6) + (v - 0.74) * Math.sin(0.6)
      const lv = -(u - 0.61) * Math.sin(0.6) + (v - 0.74) * Math.cos(0.6)
      const leaf = sm(1.05 - ((lu / 0.11) ** 2 + (lv / 0.035) ** 2)) * 0.9
      const f = Math.max(flower, stem, leaf)
      field[y * N + x] = f
      const c = f === flower ? (v < 0.3 ? mix(lilac, coral, sm(v / 0.3)) : mix(coral, pink, sm((v - 0.3) / 0.25))) : stemGreen
      colour.push(`rgb(${c[0]},${c[1]},${c[2]})`)
    }
  shape = { field, colour }
  return shape
}

/** One frame at `el` ms into the loop. `grain` adds the flickering specks over the bud (the design's film grain). */
function draw(ctx: CanvasRenderingContext2D, el: number, grain = true) {
  const { field, colour } = tulip()
  const p = el % LOOP_MS
  let reveal: number
  let logo: number
  let scatter: number
  if (p < 1000) {
    reveal = sm(p / 1000)
    logo = 0
    scatter = (1 - reveal) * 1.4
  } else if (p < 1600) {
    reveal = 1
    logo = sm((p - 1000) / 600)
    scatter = 0
  } else if (p < 2500) {
    reveal = 1
    logo = 1
    scatter = 0
  } else if (p < 3100) {
    reveal = 1
    logo = 1 - sm((p - 2500) / 600)
    scatter = 0
  } else {
    reveal = 1 - sm((p - 3100) / 700)
    logo = 0
    scatter = (1 - reveal) * 1.6
  }
  const spin = Math.sin(el / 900) * 0.04
  ctx.clearRect(0, 0, S, S)
  if (logo < 1) {
    ctx.save()
    ctx.globalAlpha = 1 - logo
    ctx.translate(S / 2, S / 2)
    ctx.rotate(spin)
    ctx.translate(-S / 2, -S / 2)
    const r = CELL * 0.42 * (1 - logo * 0.7)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const f = field[y * N + x]
        if (f < 0.02) continue
        // shimmering ordered dither: a cell shows when its field beats its Bayer threshold
        const pulse = 0.06 * Math.sin(el / 260 + (x + y) * 0.35)
        if (f * reveal + pulse <= (BAYER[y % 8][x % 8] + 0.5) / 64) continue
        const ang = (x * 12.9898 + y * 78.233) % 6.283
        const dist = scatter * 40 * (((x * 7 + y * 13) % 17) / 17)
        ctx.fillStyle = colour[y * N + x]
        ctx.beginPath()
        ctx.arc((x + 0.5) * CELL + Math.cos(ang) * dist, (y + 0.5) * CELL + Math.sin(ang) * dist, r, 0, 6.283)
        ctx.fill()
      }
    ctx.restore()
  }
  if (logo > 0) {
    ctx.save()
    ctx.globalAlpha = logo
    ctx.filter = 'blur(9px)'
    const g = ctx.createRadialGradient(160, 140, 4, 160, 112, 80)
    g.addColorStop(0, '#FF6B4A')
    g.addColorStop(0.55, '#F25FA8')
    g.addColorStop(1, 'rgba(201,168,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(160, 112, 56, 70, 0, 0, 6.283)
    ctx.fill()
    ctx.filter = 'blur(3px)'
    ctx.strokeStyle = '#6FAE9C'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(160, 170)
    ctx.lineTo(166, 304)
    ctx.stroke()
    ctx.fillStyle = '#86C5B0'
    ctx.filter = 'blur(5px)'
    ctx.beginPath()
    ctx.ellipse(196, 238, 34, 12, -0.6, 0, 6.283)
    ctx.fill()
    ctx.filter = 'none'
    if (grain) {
      ctx.globalAlpha = logo * 0.5
      // two batched paths instead of 1400 fill calls
      const light = new Path2D()
      const dark = new Path2D()
      for (let i = 0; i < 1400; i++) (Math.random() > 0.5 ? light : dark).rect(Math.random() * S, Math.random() * S, 1.3, 1.3)
      ctx.fillStyle = 'rgba(255,255,255,.9)'
      ctx.fill(light)
      ctx.fillStyle = 'rgba(18,18,18,.35)'
      ctx.fill(dark)
    }
    ctx.restore()
  }
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Runs the tulip on a canvas until unmount (or `active` turns false). `onFrame(el, p)` sees every frame.
 * Reduced motion: one still frame of the formed bud, no loop.
 */
function useTulip(ref: RefObject<HTMLCanvasElement | null>, active = true, onFrame?: (el: number, p: number) => void) {
  const frameRef = useRef(onFrame)
  useEffect(() => {
    frameRef.current = onFrame
  })
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx || !active) return
    if (reducedMotion()) {
      draw(ctx, 2000, false)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const el = now - t0
      draw(ctx, el)
      frameRef.current?.(el, el % LOOP_MS)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ref, active])
}

export function WillowLoader({ label = 'Loading', inline = false }: { label?: string; inline?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useTulip(canvas)
  if (inline)
    return (
      <div role="status" aria-live="polite" className="grid min-h-40 w-full place-items-center">
        <canvas ref={canvas} width={S} height={S} aria-hidden className="size-[112px]" />
        <span className="sr-only">{label}</span>
      </div>
    )
  // Fades in after a beat, so a page that opens quickly never flashes white.
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[10001] grid animate-[wFadeIn_.3s_ease_.25s_both] place-items-center bg-white [.proof-boot-dark_&]:bg-[#0a0a0a]">
      <canvas ref={canvas} width={S} height={S} aria-hidden className="size-[min(58vw,250px)] [.proof-boot-dark_&]:invisible" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

const INTRO_KEY = 'willow.intro'

function introSeen(): boolean {
  try {
    return sessionStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The landing's intro (once per browser session). It leaves only while the bud is fully formed, and only
 * once the page has loaded (or after 5 s regardless); a click or Esc skips it. `onDone` fires when the
 * page is fully revealed, or straight away when the intro is skipped (seen already, or reduced motion).
 */
export function WillowIntro({ onDone }: { onDone?: () => void }) {
  const [phase, setPhase] = useState<'on' | 'out' | 'gone'>(() => (introSeen() || reducedMotion() ? 'gone' : 'on'))
  const canvas = useRef<HTMLCanvasElement>(null)
  const ready = useRef(false)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(INTRO_KEY, '1')
    } catch {
      /* private mode: it may play again next time, which is harmless */
    }
  }, [])

  useEffect(() => {
    if (phase === 'gone') done.current?.()
    if (phase !== 'out') return
    const t = window.setTimeout(() => setPhase('gone'), 1250)
    return () => window.clearTimeout(t)
  }, [phase])

  // Ready: the page has loaded (+300 ms to settle), or 5 s have passed.
  useEffect(() => {
    if (phase !== 'on') return
    const mark = () => (ready.current = true)
    const timers = [window.setTimeout(mark, 5000)]
    if (document.readyState === 'complete') timers.push(window.setTimeout(mark, 300))
    else window.addEventListener('load', mark, { once: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPhase((p) => (p === 'on' ? 'out' : p))
    window.addEventListener('keydown', onKey)
    return () => {
      timers.forEach(window.clearTimeout)
      window.removeEventListener('load', mark)
      window.removeEventListener('keydown', onKey)
    }
  }, [phase])

  useTulip(canvas, phase !== 'gone', (el, p) => {
    if (ready.current && el > 2000 && p > 1700 && p < 2400) setPhase((s) => (s === 'on' ? 'out' : s))
  })

  if (phase === 'gone') return null
  const out = phase === 'out'
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading Willow"
      title="Skip intro"
      onClick={() => setPhase((s) => (s === 'on' ? 'out' : s))}
      className="fixed inset-0 z-[10001] grid place-items-center overflow-hidden"
      style={{ pointerEvents: out ? 'none' : 'auto' }}
    >
      {/* The white is the shadow of a circle; the exit grows the circle, so the page shows through a widening hole. */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[width,height] duration-[1150ms] ease-[cubic-bezier(.75,0,.2,1)]"
        style={{ width: out ? '300vmax' : 0, height: out ? '300vmax' : 0, boxShadow: '0 0 0 250vmax #FFFFFF' }}
      />
      <div className="relative flex flex-col items-center transition-[transform,opacity] ease-[cubic-bezier(.7,0,.2,1)]" style={{ transform: `scale(${out ? 7 : 1})`, opacity: out ? 0 : 1, transitionDuration: '1.1s, .7s', transitionDelay: '0s, .2s' }}>
        <canvas ref={canvas} width={S} height={S} aria-hidden className="size-[min(58vw,250px)]" />
      </div>
    </div>
  )
}
