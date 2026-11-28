import { useEffect, useRef } from 'react'

import type { VoiceState } from './session'

/**
 * The voice mode's orb: Willow's aura colours in a soft sphere that breathes, swells with the voice it hears
 * (the person's while listening, Wisp's while speaking) and drifts its colours from cool (listening) to warm
 * (speaking) when the state changes. Canvas 2D, gradients only (no blur filters), one rAF loop that writes to
 * the canvas and never to React. Colours ease toward each state's palette, so a state change flows, never
 * cuts. Reduced motion: a still orb, redrawn once per state.
 */
type RGB = [number, number, number]
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const CORAL = hex('#FF6B4A')
const PINK = hex('#F25FA8')
const APRICOT = hex('#FFB27A')
const SKY = hex('#3D7BFF')
const ICE = hex('#9CD3FF')
const VIOLET = hex('#7A5CFF')
const LILAC = hex('#D8B8FF')
const STONE = hex('#B8B5AE')
const MIST = hex('#E9E7E2')

// [base, blob a, blob b, blob c]; energy: how much it moves at rest. Neighbouring states never pair
// opposite hues at the same index (apricot to ice would pass through grey on the way).
const PALETTES: Record<VoiceState | 'muted', { colors: RGB[]; energy: number; spin: number }> = {
  connecting: { colors: [LILAC, ICE, VIOLET, MIST], energy: 0.25, spin: 0.18 },
  listening: { colors: [LILAC, SKY, ICE, VIOLET], energy: 0.45, spin: 0.22 },
  interrupted: { colors: [LILAC, SKY, ICE, VIOLET], energy: 0.6, spin: 0.3 },
  thinking: { colors: [LILAC, VIOLET, PINK, SKY], energy: 0.55, spin: 0.55 },
  speaking: { colors: [APRICOT, CORAL, PINK, LILAC], energy: 0.6, spin: 0.3 },
  reconnecting: { colors: [MIST, LILAC, STONE, ICE], energy: 0.25, spin: 0.35 },
  ending: { colors: [APRICOT, PINK, LILAC, ICE], energy: 0.35, spin: 0.2 },
  ended: { colors: [MIST, STONE, LILAC, MIST], energy: 0.05, spin: 0.05 },
  error: { colors: [MIST, STONE, APRICOT, MIST], energy: 0.05, spin: 0.05 },
  micDenied: { colors: [MIST, STONE, LILAC, MIST], energy: 0.05, spin: 0.05 },
  muted: { colors: [MIST, STONE, LILAC, ICE], energy: 0.15, spin: 0.1 },
}

const rgba = (c: number[], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`

export function Orb({ state, muted, levels, size, reduced }: { state: VoiceState; muted: boolean; levels: () => { input: number; output: number }; size: number; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const target = useRef({ state, muted })
  useEffect(() => {
    target.current = { state, muted }
  }, [state, muted])
  // reduced motion: no loop, one still frame per state
  const redraw = reduced ? `${state}:${muted}` : ''

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const box = size * 1.5 // room for the glow
    el.width = Math.round(box * dpr)
    el.height = Math.round(box * dpr)
    ctx.scale(dpr, dpr)
    const key = () => (target.current.muted && ['listening', 'interrupted'].includes(target.current.state) ? 'muted' : target.current.state)
    const cur = PALETTES[key()].colors.map((c) => [...c])
    let energy = PALETTES[key()].energy
    let spin = PALETTES[key()].spin
    let level = 0
    let phase = Math.random() * 10
    let last = performance.now()
    let raf = 0

    const draw = (t: number, dt: number) => {
      const p = PALETTES[key()]
      const k = reduced ? 1 : 1 - Math.exp(-dt / 0.32) // colours settle in under a second
      cur.forEach((c, i) => c.forEach((v, j) => (c[j] = v + (p.colors[i][j] - v) * k)))
      energy += (p.energy - energy) * k
      spin += (p.spin - spin) * k
      const st = target.current.state
      const lv = reduced ? 0 : st === 'speaking' || st === 'ending' ? levels().output : st === 'listening' || st === 'interrupted' ? levels().input : 0
      const want = Math.min(1, lv * 5)
      level += (want - level) * (1 - Math.exp(-dt / (want > level ? 0.05 : 0.22)))
      phase += dt * spin
      const breath = reduced ? 0 : Math.sin(t / 1000 * 1.1) * 0.012 * (0.4 + energy)
      const c = box / 2
      const r = (size / 2) * (1 + breath + level * 0.09)
      ctx.clearRect(0, 0, box, box)
      // glow
      const glow = ctx.createRadialGradient(c, c, r * 0.6, c, c, r * 1.45)
      glow.addColorStop(0, rgba(cur[1], 0.28 + level * 0.25))
      glow.addColorStop(1, rgba(cur[1], 0))
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, box, box)
      ctx.save()
      ctx.beginPath()
      ctx.arc(c, c, r, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = rgba(cur[0], 1)
      ctx.fillRect(c - r, c - r, r * 2, r * 2)
      // three colour fields drifting round the centre
      for (let i = 1; i < 4; i++) {
        const a = phase * (i % 2 ? 1 : -0.8) + (i * Math.PI * 2) / 3
        const wob = 0.32 + 0.1 * Math.sin(phase * 0.7 + i) * energy + level * 0.08
        const x = c + Math.cos(a) * r * wob
        const y = c + Math.sin(a) * r * wob
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * (0.95 + 0.1 * energy))
        g.addColorStop(0, rgba(cur[i], 0.95))
        g.addColorStop(1, rgba(cur[i], 0))
        ctx.fillStyle = g
        ctx.fillRect(c - r, c - r, r * 2, r * 2)
      }
      // the light: a soft highlight up and to the left, a rim of white
      const hi = ctx.createRadialGradient(c - r * 0.42, c - r * 0.5, 0, c - r * 0.42, c - r * 0.5, r * 0.9)
      hi.addColorStop(0, 'rgba(255,255,255,.75)')
      hi.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = hi
      ctx.fillRect(c - r, c - r, r * 2, r * 2)
      const rim = ctx.createRadialGradient(c, c, r * 0.82, c, c, r)
      rim.addColorStop(0, 'rgba(255,255,255,0)')
      rim.addColorStop(1, 'rgba(255,255,255,.55)')
      ctx.fillStyle = rim
      ctx.fillRect(c - r, c - r, r * 2, r * 2)
      ctx.restore()
    }

    if (reduced) {
      draw(0, 1)
      return
    }
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      draw(t, dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [size, reduced, levels, redraw])

  const box = size * 1.5
  return <canvas ref={canvas} aria-hidden style={{ width: box, height: box, margin: -(box - size) / 2 }} className="pointer-events-none block" />
}
