/**
 * The routine-saved celebration's drift (Celebration.tsx): petals in the aura hues and slender willow leaves,
 * released from the garden when the first bud opens and then a few at a time as the others open. They lift
 * on warm air, sway, tumble (a flip drawn as a squash) and fade high up; after about five seconds the air is
 * still again. One canvas, sprites drawn once, transform-only per frame, no React render.
 */
type Leaf = { x: number; y: number; vx: number; vy: number; rot: number; spin: number; flip: number; flipV: number; sway: number; phase: number; size: number; born: number; life: number; depth: number; sprite: HTMLCanvasElement }

const PETAL_HUES = ['#FF6B4A', '#F25FA8', '#D8B8FF', '#FFB27A', '#FF9CCB', '#B79CFF']
const LEAF_HUES = ['#86C5B0', '#B8E986', '#6FAE9C']
const S = 64 // sprite px (drawn at up to 2x the largest size)

/** Drawn once; `soft` is the out-of-focus copy for the pieces nearest the eye (a blur per frame would cost too much). */
function sprite(draw: (c: CanvasRenderingContext2D) => void, soft = false): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = S
  cv.height = S
  const c = cv.getContext('2d')
  if (c) {
    if (soft) c.filter = 'blur(3px)'
    c.translate(S / 2, S / 2)
    if (soft) c.scale(0.8, 0.8)
    draw(c)
  }
  return cv
}

/** A petal: a soft teardrop, its colour deepening towards the base, with a pale tip. */
function petal(hue: string, soft = false) {
  return sprite((c) => {
    const g = c.createLinearGradient(0, -S * 0.42, 0, S * 0.42)
    g.addColorStop(0, 'rgba(255,255,255,.95)')
    g.addColorStop(0.35, hue)
    g.addColorStop(1, hue)
    c.fillStyle = g
    c.beginPath()
    c.moveTo(0, -S * 0.42)
    c.bezierCurveTo(S * 0.36, -S * 0.3, S * 0.3, S * 0.3, 0, S * 0.42)
    c.bezierCurveTo(-S * 0.3, S * 0.3, -S * 0.36, -S * 0.3, 0, -S * 0.42)
    c.fill()
  }, soft)
}

/** A willow leaf: long and slender, a lighter midrib. */
function leaf(hue: string, soft = false) {
  return sprite((c) => {
    c.fillStyle = hue
    c.beginPath()
    c.moveTo(0, -S * 0.46)
    c.quadraticCurveTo(S * 0.17, 0, 0, S * 0.46)
    c.quadraticCurveTo(-S * 0.17, 0, 0, -S * 0.46)
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,.55)'
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(0, -S * 0.38)
    c.lineTo(0, S * 0.4)
    c.stroke()
  }, soft)
}

export class Drift {
  private leaves: Leaf[] = []
  private ctx: CanvasRenderingContext2D | null
  private raf = 0
  private last = 0
  private w = 0
  private h = 0
  private dpr = 1
  private petals: HTMLCanvasElement[]
  private greens: HTMLCanvasElement[]
  private softPetals: HTMLCanvasElement[]
  private softGreens: HTMLCanvasElement[]
  private rand = Math.random
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.petals = PETAL_HUES.map((h) => petal(h))
    this.greens = LEAF_HUES.map((h) => leaf(h))
    this.softPetals = PETAL_HUES.map((h) => petal(h, true))
    this.softGreens = LEAF_HUES.map((h) => leaf(h, true))
    this.resize()
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.w = this.canvas.clientWidth
    this.h = this.canvas.clientHeight
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
  }

  /** `n` pieces from (x, y): a burst opens outwards and upwards; otherwise they lift gently from a strip `spread` wide. */
  release(x: number, y: number, n: number, burst: boolean, spread = 0) {
    const now = performance.now()
    for (let i = 0; i < n; i++) {
      const isLeaf = this.rand() < 0.35
      // depth: far pieces are small, faint and slow; near ones large, quicker and out of focus
      const depth = this.rand()
      const near = depth > 0.82
      const a = -Math.PI / 2 + (this.rand() - 0.5) * (burst ? Math.PI * 1.25 : 0.8)
      const speed = (burst ? 200 + this.rand() * 260 : 40 + this.rand() * 50) * (0.6 + depth * 0.7)
      const base = isLeaf ? 24 + this.rand() * 12 : 16 + this.rand() * 10
      const pick = <T,>(list: T[]) => list[Math.floor(this.rand() * list.length)]
      this.leaves.push({
        x: x + (this.rand() - 0.5) * spread,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        rot: this.rand() * Math.PI * 2,
        spin: (this.rand() - 0.5) * 2.4,
        flip: this.rand() * Math.PI * 2,
        flipV: 1.6 + this.rand() * 2.6,
        sway: (16 + this.rand() * 26) * (0.6 + depth * 0.6),
        phase: this.rand() * Math.PI * 2,
        size: base * (0.6 + depth * (near ? 1.1 : 0.6)),
        born: now + (burst ? this.rand() * 140 : 0),
        life: 3800 + this.rand() * 2000,
        depth,
        sprite: isLeaf ? pick(near ? this.softGreens : this.greens) : pick(near ? this.softPetals : this.petals),
      })
    }
    // far pieces first, so near ones pass in front
    this.leaves.sort((p, q) => p.depth - q.depth)
    this.start()
  }

  start() {
    if (this.raf) return
    this.last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      this.step(dt, now)
      this.draw(now)
      // Stop when the air is still: nothing left to draw.
      this.raf = this.leaves.length ? requestAnimationFrame(tick) : 0
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private step(dt: number, now: number) {
    this.leaves = this.leaves.filter((l) => now - l.born < l.life)
    for (const l of this.leaves) {
      if (now < l.born) continue
      // air drag towards a slow upward drift, with a sway across it
      const k = Math.exp(-1.8 * dt)
      l.vx *= k
      l.vy = l.vy * k + -(16 + 22 * l.depth) * (1 - k)
      const t = (now - l.born) / 1000
      l.x += (l.vx + Math.cos(t * 1.7 + l.phase) * l.sway) * dt
      l.y += l.vy * dt
      l.rot += l.spin * dt
      l.flip += l.flipV * dt
    }
  }

  private draw(now: number) {
    const c = this.ctx
    if (!c) return
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    c.clearRect(0, 0, this.w, this.h)
    for (const l of this.leaves) {
      const age = now - l.born
      if (age < 0) continue
      const a = Math.min(1, age / 260) * Math.min(1, (l.life - age) / 1100)
      if (a <= 0) continue
      c.save()
      c.globalAlpha = a * (0.55 + 0.4 * l.depth)
      c.translate(l.x, l.y)
      c.rotate(l.rot)
      // the tumble: a flip seen edge-on never fully vanishes
      c.scale(0.25 + 0.75 * Math.abs(Math.cos(l.flip)), 1)
      c.drawImage(l.sprite, -l.size / 2, -l.size / 2, l.size, l.size)
      c.restore()
    }
  }
}
