/**
 * The brewing dish as one continuous scene, drawn on a canvas (no React render per frame). The same set of
 * dots lives through every stage: they bloom out of the centre while the catalog is read, then each filter
 * passes through as a ripple of light from the centre outwards. Dots the filter drops drift outwards, shrink
 * and fade where the ripple reaches them; the survivors close the gaps by themselves (a small physics model:
 * each dot springs to its own radius, neighbours push apart, the whole colony turns slowly) and take on the
 * next stage's colour a beat later. At the end the survivors gather into the picks' slots and are absorbed there.
 *
 * Units: the dish is a unit circle (centre 0,0, radius 1); `draw` maps it to pixels. Times are performance.now() ms.
 */
export type Rgb = readonly [number, number, number]

type Dot = {
  x: number
  y: number
  vx: number
  vy: number
  /** radius now, alpha now */
  r: number
  a: number
  /** Survives stage s while rank < that stage's count. */
  rank: number
  /** 0..1, fixed per dot: spreads timings so nothing moves in lockstep. */
  j: number
  /** Target radius from the centre (the colony's own place for it); the next one, from the moment the ripple reaches it. */
  rho: number
  nr: number
  ra: number
  born: number
  /** Colour: from c0 to c1, starting at ct. */
  c0: Rgb
  c1: Rgb
  ct: number
  /** When the filter reaches it and drops it (Infinity: kept). */
  out: number
  pushed: boolean
  /** Resolve: the slot it gathers into, -1 before. */
  slot: number
  absorbed: number
}

type Wave = { t: number; c: Rgb }

const WAVE = 620 // ms for the ripple to cross the dish
const FADE = 760 // ms for a dropped dot to fade
const TINT = 620 // ms for a colour change
const ease = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3)
const mix = (a: Rgb, b: Rgb, p: number): Rgb => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p]
const rgba = (c: Rgb, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`

/** A small fixed-seed random source (mulberry32), so the dish lays out the same way every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class BrewScene {
  private dots: Dot[] = []
  private waves: Wave[] = []
  private slots: { x: number; y: number; glow: number }[] = []
  private ctx: CanvasRenderingContext2D | null
  private px = 0
  private dpr = 1
  private raf = 0
  private last = 0
  /** How many dots the colony is sized for now, and the catalog's count (for the colony's radius). */
  private n = 0
  private d0 = 0
  private omega = 0.55
  private resolving = false
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
  }

  resize(cssPx: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.px = cssPx
    this.canvas.width = Math.round(cssPx * this.dpr)
    this.canvas.height = Math.round(cssPx * this.dpr)
    this.draw(performance.now())
  }

  start() {
    if (this.raf) return
    this.last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      // two sub-steps keep the springs stable at 30 fps too
      this.step(dt / 2, now)
      this.step(dt / 2, now)
      this.draw(now)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  /** While the catalog is read: a pool of dots blooms out of the centre and turns slowly. */
  seed(count: number, colour: Rgb, now: number) {
    const rand = seeded(count * 131 + 7)
    this.n = count
    this.d0 = count
    this.dots = Array.from({ length: count }, (_, i) => {
      const a = rand() * Math.PI * 2
      const r0 = 0.02 + rand() * 0.04
      return { x: Math.cos(a) * r0, y: Math.sin(a) * r0, vx: 0, vy: 0, r: 0, a: 0, rank: i, j: rand(), rho: 0, nr: 0, ra: 0, born: now + Math.sqrt(i / count) * 520, c0: colour, c1: colour, ct: now, out: Infinity, pushed: false, slot: -1, absorbed: 0 }
    })
    this.layout()
  }

  /**
   * The catalog is known: `d0` dots stay (the rest fade where they are) and each gets its rank, a fixed
   * shuffle that decides which filter drops it. Works whether or not `seed` ran first.
   */
  catalog(d0: number, seedKey: number, colour: Rgb, now: number) {
    const rand = seeded(seedKey)
    const ranks = Array.from({ length: d0 }, (_, i) => i)
    for (let i = ranks.length - 1; i > 0; i--) {
      const k = Math.floor(rand() * (i + 1))
      ;[ranks[i], ranks[k]] = [ranks[k], ranks[i]]
    }
    if (!this.dots.length) this.seed(d0, colour, now)
    this.dots.forEach((d, i) => {
      if (i < d0) {
        d.rank = ranks[i]
        this.tint(d, colour, now + d.j * 260)
      } else d.out = now + d.j * 300
    })
    this.d0 = d0
    this.n = d0
    this.omega = 0.18
    this.layout()
  }

  /** One filter passes: a ripple from the centre; dots ranked at or above `alive` leave where it reaches them. */
  filter(alive: number, colour: Rgb, now: number) {
    this.waves.push({ t: now, c: colour })
    for (const d of this.dots) {
      if (d.out !== Infinity) continue
      const reach = now + Math.min(1, Math.hypot(d.x, d.y)) * WAVE * 0.85 + d.j * 90
      if (d.rank >= alive) d.out = reach
      else {
        d.ra = reach
        this.tint(d, colour, reach + 120)
      }
    }
    this.n = alive
    this.omega = Math.max(0.08, this.omega * 0.8)
    this.layout()
  }

  /** The survivors gather into `slots` (unit coords) and are absorbed there, one slot each by angle. */
  resolve(slots: { x: number; y: number }[], colour: Rgb, now: number) {
    this.resolving = true
    this.slots = slots.map((s) => ({ ...s, glow: 0 }))
    this.waves.push({ t: now, c: colour })
    for (const d of this.dots) {
      if (d.out !== Infinity) continue
      let best = 0
      let bd = Infinity
      slots.forEach((s, k) => {
        const dd = Math.hypot(s.x - d.x, s.y - d.y)
        if (dd < bd) {
          bd = dd
          best = k
        }
      })
      d.slot = best
      d.ct = now + d.j * 240 // reused as the moment it sets off
      this.tint(d, colour, now)
    }
  }

  /** Reduced motion: jump straight to where the scene comes to rest. */
  settle(now: number) {
    for (const d of this.dots) {
      d.born = 0
      d.ct = 0
      d.c0 = d.c1
      if (d.out !== Infinity) d.out = -1e9
    }
    this.waves = []
    for (let i = 0; i < 400; i++) this.step(1 / 60, now + 1e6)
    this.draw(now + 1e6)
  }

  /** Each live dot's place: its order by distance from the centre, spread evenly over the colony's disc. */
  private layout() {
    const live = this.dots.filter((d) => d.rank < this.n && d.out === Infinity)
    live.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.j - b.j)
    const R = this.radius()
    live.forEach((d, k) => {
      d.nr = R * Math.sqrt((k + 0.5) / live.length)
    })
  }

  private radius() {
    return 0.76 * Math.max(0.42, Math.sqrt(this.n / Math.max(1, this.d0)))
  }

  private spacing() {
    return (this.radius() * 1.8) / Math.sqrt(Math.max(1, this.n))
  }

  private tint(d: Dot, c: Rgb, at: number) {
    d.c0 = this.colourOf(d, at)
    d.c1 = c
    d.ct = at
  }

  private colourOf(d: Dot, now: number): Rgb {
    return mix(d.c0, d.c1, ease((now - d.ct) / TINT))
  }

  private step(dt: number, now: number) {
    if (dt <= 0) return
    const s = this.spacing()
    const rTarget = Math.min(0.085, s * 0.36)
    const live: Dot[] = []
    for (const d of this.dots) {
      const leaving = d.out <= now
      if (this.resolving && d.slot >= 0 && !leaving) {
        // gather into the slot: a critically damped spring once its moment comes, absorbed on arrival
        const slot = this.slots[d.slot]
        if (now >= d.ct) {
          const k = 46
          d.vx += (k * (slot.x - d.x) - 2 * Math.sqrt(k) * d.vx) * dt
          d.vy += (k * (slot.y - d.y) - 2 * Math.sqrt(k) * d.vy) * dt
        }
        d.x += d.vx * dt
        d.y += d.vy * dt
        const dist = Math.hypot(slot.x - d.x, slot.y - d.y)
        if (dist < 0.07 && !d.absorbed) {
          d.absorbed = now
          slot.glow = Math.min(1, slot.glow + 0.35)
        }
        const ab = d.absorbed ? ease((now - d.absorbed) / 280) : 0
        d.a = Math.min(1, d.a + dt * 4) * (1 - ab)
        d.r += (rTarget * (1 - 0.6 * ab) - d.r) * Math.min(1, dt * 8)
        continue
      }
      if (leaving) {
        // dropped: drift outwards (and a touch up), shrink and fade
        const len = Math.hypot(d.x, d.y) || 1
        if (!d.pushed) {
          d.pushed = true
          const kick = 0.5 + d.j * 0.45
          d.vx += (d.x / len) * kick - (d.y / len) * 0.12
          d.vy += (d.y / len) * kick + (d.x / len) * 0.12 - 0.15
        }
        const damp = Math.exp(-1.6 * dt)
        d.vx *= damp
        d.vy *= damp
        d.x += d.vx * dt
        d.y += d.vy * dt
        const p = ease((now - d.out) / FADE)
        d.a = Math.min(d.a, 1 - p)
        d.r = Math.max(0, d.r * (1 - dt * 1.4))
        continue
      }
      if (now >= d.ra) d.rho = d.nr
      live.push(d)
    }
    // neighbours push apart (short range), so the gaps left by dropped dots close by themselves
    const kr = 70
    for (let i = 0; i < live.length; i++) {
      const a = live[i]
      for (let k = i + 1; k < live.length; k++) {
        const b = live[k]
        const dx = b.x - a.x
        const dy = b.y - a.y
        if (dx > s || dx < -s || dy > s || dy < -s) continue
        const dd = Math.hypot(dx, dy) || 1e-4
        if (dd >= s) continue
        const f = (kr * (s - dd)) / s / dd
        a.vx -= dx * f * dt
        a.vy -= dy * f * dt
        b.vx += dx * f * dt
        b.vy += dy * f * dt
      }
    }
    const damp = Math.exp(-8 * dt)
    for (const d of live) {
      const len = Math.hypot(d.x, d.y) || 1e-4
      // a spring to its own radius (no pile-up at the centre), and a slow turn
      const f = 26 * (d.rho - len)
      d.vx += ((d.x / len) * f - d.y * this.omega * 3) * dt
      d.vy += ((d.y / len) * f + d.x * this.omega * 3) * dt
      d.vx *= damp
      d.vy *= damp
      d.x += d.vx * dt
      d.y += d.vy * dt
      const grown = now >= d.born ? Math.min(1, (now - d.born) / 420) : 0
      d.a += (grown - d.a) * Math.min(1, dt * 10)
      d.r += (rTarget * (0.4 + 0.6 * ease(grown)) - d.r) * Math.min(1, dt * 5)
    }
  }

  private draw(now: number) {
    const ctx = this.ctx
    if (!ctx || !this.px) return
    const W = this.px
    const R = W * 0.44
    const cx = W / 2
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, W, W)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cx, W * 0.47, 0, Math.PI * 2)
    ctx.clip()
    // the filter passing: a soft ripple of light from the centre outwards
    this.waves = this.waves.filter((w) => now - w.t < WAVE * 1.6)
    for (const w of this.waves) {
      const p = ease((now - w.t) / (WAVE * 1.5))
      const rr = R * (0.05 + p * 1.1)
      const a = 0.55 * Math.pow(1 - p, 1.4)
      const g = ctx.createRadialGradient(cx, cx, Math.max(0, rr - R * 0.16), cx, cx, rr + R * 0.04)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.75, `rgba(255,255,255,${a.toFixed(3)})`)
      g.addColorStop(0.9, rgba(mix(w.c, [255, 255, 255], 0.35), a * 0.6))
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cx, rr + R * 0.04, 0, Math.PI * 2)
      ctx.fill()
    }
    // a soft bloom where the picks gather
    for (const s of this.slots) {
      if (s.glow <= 0.01) continue
      s.glow *= 0.985
      const x = cx + s.x * R
      const y = cx + s.y * R
      const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.34)
      g.addColorStop(0, `rgba(255,255,255,${(0.75 * s.glow).toFixed(3)})`)
      g.addColorStop(0.5, `rgba(184,233,134,${(0.35 * s.glow).toFixed(3)})`)
      g.addColorStop(1, 'rgba(184,233,134,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, R * 0.34, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const d of this.dots) {
      if (d.a < 0.01 || d.r < 0.002) continue
      const c = this.colourOf(d, now)
      const x = cx + d.x * R
      const y = cx + d.y * R
      const r = d.r * R
      // a small glass bead: a white catch-light, the stage colour, a deeper rim
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r)
      g.addColorStop(0, rgba([255, 255, 255], 0.95 * d.a))
      g.addColorStop(0.45, rgba(c, 0.78 * d.a))
      g.addColorStop(1, rgba(mix(c, [15, 59, 58], 0.45), 0.9 * d.a))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}
