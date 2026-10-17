/**
 * The shadow cat's motion model: pure maths, no DOM, so it can be tested (`web/tests/avatar.test.ts`).
 *
 * Every frame the avatar asks one `AvatarMotion` for a `Frame`: the body's transform, the glow's opacity and
 * each eye's shape, all in the asset pack's 1024-unit space (README: button centre 512,512; open eyes at
 * 409,505 and 615,505, radius 30). Nothing is ever swapped: each state is a *target pose*, and every value
 * of the pose glides to its target on a critically damped spring, so a state change is a blend from wherever
 * the creature is at that moment (no reset, no snapping, no jump in eye direction). On top of the pose run
 * slow time-based cycles (float, sway, breathing, glow), a blink scheduler, a glance scheduler, a springy
 * one-shot bounce for "happy", and a smoothed speech envelope from `audioLevel`. All timings are in seconds
 * of real time, so motion is the same at 60, 120 or 144 Hz.
 *
 * The creature moves as one animal, not as a picture with moving eyes:
 *   - the head follows the gaze: when the eyes glance, the head turns a little after them and the ears (further
 *     back) a little less, so a glance reads as a small turn of a solid head;
 *   - the ears carry follow-through: they hang on springs behind the body, so a hop or a turn makes them trail
 *     and settle a moment later;
 *   - the ears have their own life: a flick now and then (one ear, sometimes twice), perked when listening, one
 *     swivelled back when thinking, drooping when sleepy.
 */

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'sleepy' | 'inactive'
export const AVATAR_STATES: AvatarState[] = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'sleepy', 'inactive']

/** Every continuous value a state sets. Units: eye and body offsets in pack units (of 1024), angles in degrees. */
export type Pose = {
  /** body offset (+ down) */
  y: number
  /** forward lean: a touch taller and nearer, 0 = upright, 1 = attentive */
  lean: number
  /** resting tilt */
  tilt: number
  /** breathing depth (fraction of scale) */
  breathe: number
  /** float distance */
  float: number
  /** speed of the slow cycles (1 = idle) */
  pace: number
  /** glow layer opacity */
  glow: number
  /** resting gaze */
  gx: number
  gy: number
  /** eye radius (30, 32 attentive) */
  r: number
  /** upper lid: share of the eye covered from the top (0.5 = half-lidded) */
  lid: number
  /** lid slope, inner corners down (focused) */
  lidTilt: number
  /** 0 = round eyes, 1 = drawn as arcs (closed, sleepy, happy) */
  arc: number
  /** arc depth: + sags down (closed 34, sleepy 20), − arches up (happy) */
  sag: number
  /** arc stroke width */
  stroke: number
  /** how far glances go (0 = none) */
  glance: number
  /** blinks per idle blink (0 = none, 0.7 = slower, rarer) */
  blink: number
  /** how much the voice moves the body (1 speaking, a trace otherwise) */
  voice: number
  /** ear angle, outward (deg): + droops out, − perks in */
  ears: number
  /** ears up (−) or down (+), pack units */
  earY: number
  /** 0..1: the right ear swivels back (half turned away, like a cat listening behind itself) */
  swivel: number
  /** how often the ears flick (0 = never, 1 = idle) */
  twitch: number
}

export const POSES: Record<AvatarState, Pose> = {
  // Very restrained continuous life.
  idle: { y: 0, lean: 0, tilt: 0, breathe: 0.012, float: 6, pace: 1, glow: 0.14, gx: 0, gy: 0, r: 30, lid: 0, lidTilt: 0, arc: 0, sag: 34, stroke: 10, glance: 1, blink: 1, voice: 0.3, ears: 0, earY: 0, swivel: 0, twitch: 1 },
  // Attentive: a little lifted and leaning in, slightly larger eyes (the pack's "attentive"), steadier gaze.
  listening: { y: -5, lean: 1, tilt: 0, breathe: 0.01, float: 3.5, pace: 1.1, glow: 0.24, gx: 0, gy: 0, r: 32, lid: 0, lidTilt: 0, arc: 0, sag: 34, stroke: 10, glance: 0.45, blink: 1.1, voice: 0.3, ears: -4, earY: -5, swivel: 0, twitch: 1.3 },
  // Pondering: a slight tilt, eyes drifting up and to the side, slower, rarer blinks.
  thinking: { y: -2, lean: 0.2, tilt: -3, breathe: 0.01, float: 5, pace: 0.7, glow: 0.18, gx: 4, gy: -6, r: 30, lid: 0.08, lidTilt: 0, arc: 0, sag: 34, stroke: 10, glance: 1, blink: 0.7, voice: 0.3, ears: 1, earY: 0, swivel: 1, twitch: 0.5 },
  // The voice moves the body (speech envelope); the pose itself is attentive and calm.
  speaking: { y: -3, lean: 0.6, tilt: 0, breathe: 0.008, float: 3.5, pace: 1.15, glow: 0.24, gx: 0, gy: 0, r: 31, lid: 0, lidTilt: 0, arc: 0, sag: 34, stroke: 10, glance: 0.5, blink: 1, voice: 1, ears: -2, earY: -2, swivel: 0, twitch: 0.6 },
  // Soft happy eyes (the pack's closed arc, arched up) and a lift; the bounce is a separate impulse.
  happy: { y: -6, lean: 0.4, tilt: 0, breathe: 0.012, float: 4, pace: 1.1, glow: 0.28, gx: 0, gy: -2, r: 30, lid: 0, lidTilt: 0, arc: 1, sag: -24, stroke: 11, glance: 0, blink: 0, voice: 0.3, ears: -3, earY: -4, swivel: 0, twitch: 0 },
  // Settled low, slow deep breaths, the pack's sleepy arcs.
  sleepy: { y: 10, lean: -0.6, tilt: 1.5, breathe: 0.02, float: 2, pace: 0.5, glow: 0.06, gx: 0, gy: 2, r: 30, lid: 0, lidTilt: 0, arc: 1, sag: 20, stroke: 12, glance: 0, blink: 0, voice: 0.1, ears: 10, earY: 8, swivel: 0, twitch: 0.35 },
  // Present but resting: half-lidded (the pack's "half lidded"), almost still.
  inactive: { y: 6, lean: -0.3, tilt: 0, breathe: 0.008, float: 1, pace: 0.5, glow: 0, gx: 0, gy: 2, r: 30, lid: 0.5, lidTilt: 0, arc: 0, sag: 34, stroke: 10, glance: 0, blink: 0.4, voice: 0.1, ears: 5, earY: 4, swivel: 0, twitch: 0.5 },
}

const KEYS = Object.keys(POSES.idle) as (keyof Pose)[]
// How long each value takes to settle (s): eye shapes are quicker than the body, glow the slowest.
const RESPONSE: Partial<Record<keyof Pose, number>> = { lid: 0.24, lidTilt: 0.24, arc: 0.26, sag: 0.3, stroke: 0.3, r: 0.3, gx: 0.45, gy: 0.45, glow: 0.6, ears: 0.45, earY: 0.45, swivel: 0.5 }
const BODY_RESPONSE = 0.5

/** The happy state plays once, then the creature blends back into idle while the prop still says "happy". */
export const HAPPY_HOLD = 1.4

/** Exact critically damped spring step (no overshoot, stable at any frame time). */
export function damp(x: number, v: number, target: number, dt: number, response: number): [number, number] {
  const w = (2 * Math.PI) / response
  const d = x - target
  const e = Math.exp(-w * dt)
  const k = v + w * d
  return [target + (d + k * dt) * e, (v - w * k * dt) * e]
}

/** Blink amount 0..1 for time `t` (s) into a blink: close quickly, hold, open a little slower. */
export function blinkCurve(t: number, slow = false): number {
  const close = slow ? 0.14 : 0.085
  const hold = slow ? 0.08 : 0.04
  const open = slow ? 0.22 : 0.13
  if (t <= 0) return 0
  if (t < close) return (t / close) ** 2 // ease in: lids accelerate shut
  if (t < close + hold) return 1
  const u = (t - close - hold) / open
  if (u >= 1) return 0
  return 1 - (1 - (1 - u) ** 3) // ease out: lids slow as they reach open
}
export const blinkLength = (slow: boolean) => (slow ? 0.44 : 0.255)

export type Eye = {
  /** centre (pack units) */
  x: number
  y: number
  r: number
  /** vertical scale of the round eye (blinks, closing into an arc) */
  sy: number
  /** top lid cut, as a share of the eye's height */
  lid: number
  /** lid slope (deg, already mirrored for this eye) */
  lidTilt: number
  /** round-eye opacity and arc opacity */
  disc: number
  arc: number
  sag: number
  stroke: number
}

export type Ear = {
  /** rotation about the ear's base (deg, clockwise +), offsets in pack units, horizontal scale (swivel) */
  rot: number
  x: number
  y: number
  sx: number
}

export type Frame = {
  /** the whole creature: offsets in pack units, tilt in degrees, scales as factors */
  x: number
  y: number
  tilt: number
  sx: number
  sy: number
  glow: number
  /** the head (and face) within the creature: follows the gaze */
  head: { x: number; y: number; rot: number }
  ears: [Ear, Ear]
  /** eyes, in the head's frame */
  eyes: [Eye, Eye]
}

// How much of the gaze the head and the ears follow (the eyes do the rest), and the head's turn per unit.
const HEAD_FOLLOW = 0.35
const EAR_FOLLOW = 0.2
const HEAD_TURN = 0.15

/** Underdamped spring step (semi-implicit, small substeps): for follow-through and flicks. */
function wobble(x: number, v: number, target: number, dt: number, period: number, zeta: number): [number, number] {
  const w = (2 * Math.PI) / period
  for (let left = dt; left > 0; left -= 1 / 240) {
    const h = Math.min(left, 1 / 240)
    v += (-w * w * (x - target) - 2 * zeta * w * v) * h
    x += v * h
  }
  return [x, v]
}

const EYE_X: [number, number] = [409, 615]
const EYE_Y = 505

type Rand = () => number

/**
 * One creature's motion state. `step(dt, state, audio)` advances it by `dt` seconds and returns the frame to
 * draw. `audio` is the raw 0..1 speech level (or null): it is smoothed here, never drawn raw.
 */
export class AvatarMotion {
  private pose: Pose
  private vel: Record<keyof Pose, number>
  private t = 0
  private phase = 0
  private state: AvatarState | null = null
  private since = 0
  // happy bounce: an underdamped spring kicked upward on entry
  private bounce = 0
  private bounceV = 0
  // speech envelope, then a second smoothing stage (no frame-rate ripple)
  private env = 0
  private envSmooth = 0
  private envV = 0
  // blink
  private blinkAt: number
  private blinkStart = -10
  private blinkSlow = false
  private blinkAgain = false
  // glance: target, smoothed value, schedule
  private glanceTo: [number, number] = [0, 0]
  private glanceX = 0
  private glanceY = 0
  private glanceVx = 0
  private glanceVy = 0
  private glanceNext: number
  private glanceBack = Infinity
  // ears: lag springs that trail the body (follow-through) and a flick spring per ear
  private lagY = 0
  private lagYV = 0
  private lagX = 0
  private lagXV = 0
  private flick: [number, number] = [0, 0]
  private flickV: [number, number] = [0, 0]
  private flickNext: number
  private flickAgain: 0 | 1 | null = null
  private reduced: boolean
  private rand: Rand

  constructor(opts: { state?: AvatarState; reducedMotion?: boolean; random?: Rand } = {}) {
    this.rand = opts.random ?? Math.random
    this.reduced = !!opts.reducedMotion
    this.pose = { ...POSES[opts.state ?? 'idle'] }
    this.vel = Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<keyof Pose, number>
    this.blinkAt = 1.5 + this.rand() * 3
    this.glanceNext = 2 + this.rand() * 3
    this.flickNext = 3 + this.rand() * 5
    this.lagY = this.pose.y
  }

  setReducedMotion(on: boolean) {
    this.reduced = on
  }

  /** The state actually shown: "happy" plays for HAPPY_HOLD seconds, then idle. */
  shown(state: AvatarState): AvatarState {
    return state === 'happy' && this.state === 'happy' && this.t - this.since > HAPPY_HOLD ? 'idle' : state
  }

  step(dtIn: number, state: AvatarState, audio: number | null): Frame {
    // A long frame (tab in the background, a debugger) never makes the creature lurch: cap it.
    const dt = Math.min(Math.max(dtIn, 0), 1 / 15)
    this.t += dt
    if (state !== this.state) {
      if (state === 'happy' && !this.reduced) this.bounceV -= 160 // pack units/s, upward
      this.state = state
      this.since = this.t
    }
    const target = POSES[this.shown(state)]

    // 1. every pose value glides to its target (critically damped)
    for (const k of KEYS) {
      const [x, v] = damp(this.pose[k], this.vel[k], target[k], dt, RESPONSE[k] ?? BODY_RESPONSE)
      this.pose[k] = x
      this.vel[k] = v
    }
    const p = this.pose
    this.phase += dt * p.pace // accumulated, so a change of pace never jumps the cycle

    // 2. happy bounce: underdamped spring (damping ratio 0.5, ~0.42 s), small substeps for stability
    for (let left = dt; left > 0; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240)
      const w = (2 * Math.PI) / 0.42
      this.bounceV += (-w * w * this.bounce - 2 * 0.5 * w * this.bounceV) * h
      this.bounce += this.bounceV * h
    }

    // 3. speech envelope: quick attack, slower release, so syllables read as soft pulses, never jitter
    const level = audio == null ? 0 : Math.min(1, Math.max(0, audio))
    const tau = level > this.env ? 0.05 : 0.16
    this.env += (level - this.env) * (1 - Math.exp(-dt / tau))
    ;[this.envSmooth, this.envV] = damp(this.envSmooth, this.envV, this.env, dt, 0.14)
    const voice = Math.max(0, this.envSmooth) * p.voice

    // 4. blinks
    let blink = 0
    if (p.blink > 0.05 && p.arc < 0.5) {
      if (this.t >= this.blinkAt) {
        this.blinkStart = this.t
        this.blinkSlow = state === 'thinking' || state === 'inactive' || this.rand() < 0.15
        this.blinkAgain = !this.blinkSlow && this.rand() < 0.1
        this.blinkAt = this.blinkAgain ? this.t + 0.3 : this.t + (3 + this.rand() * 4) / p.blink
      }
      blink = blinkCurve(this.t - this.blinkStart, this.blinkSlow)
    } else {
      this.blinkAt = Math.max(this.blinkAt, this.t + 1 + this.rand() * 2)
    }

    // 5. glances: away for a moment, then back to the resting gaze
    if (this.t >= this.glanceBack) {
      this.glanceTo = [0, 0]
      this.glanceBack = Infinity
    }
    if (this.t >= this.glanceNext) {
      const g = p.glance
      if (g > 0.05) {
        const pick = state === 'thinking' ? THINK_GLANCES : GLANCES
        const [gx, gy] = pick[Math.floor(this.rand() * pick.length)]
        this.glanceTo = [gx * g, gy * g]
        const hold = state === 'thinking' ? 1 + this.rand() * 1.4 : 0.5 + this.rand() * 0.9
        this.glanceBack = this.t + hold
      }
      this.glanceNext = this.t + (state === 'thinking' ? 2.6 : 2.5 + this.rand() * 3.5) + (this.glanceBack === Infinity ? 0 : this.glanceBack - this.t)
    }
    ;[this.glanceX, this.glanceVx] = damp(this.glanceX, this.glanceVx, this.glanceTo[0], dt, state === 'thinking' ? 0.5 : 0.22)
    ;[this.glanceY, this.glanceVy] = damp(this.glanceY, this.glanceVy, this.glanceTo[1], dt, state === 'thinking' ? 0.5 : 0.22)

    // 6. the slow cycles (incommensurate periods, so the motion never visibly repeats)
    const m = this.reduced ? 0 : 1
    const tau2 = Math.PI * 2
    const ph = this.phase
    const float = Math.sin((tau2 * ph) / 4.2) * p.float * m
    const sway = (Math.sin((tau2 * ph) / 6.7 + 1.1) * 0.9 + Math.sin((tau2 * ph) / 11.3) * 0.4) * m
    const breath = Math.sin((tau2 * ph) / 3.6) * p.breathe * m
    const drift = Math.sin((tau2 * ph) / 8.9 + 0.4) * 1.5 * m
    const glowWave = 1 + 0.12 * Math.sin((tau2 * ph) / 5.3 + 2)

    const sy = 1 + breath + voice * 0.035 * m + p.lean * 0.012
    const sx = 1 - breath * 0.45 - voice * 0.012 * m + p.lean * 0.006
    const y = p.y * (this.reduced ? 0.4 : 1) + float + this.bounce * m - voice * 5 * m

    // 7. the head follows the gaze, a beat behind the eyes (the glance springs already ease it)
    const gazeX = p.gx + this.glanceX
    const gazeY = p.gy + this.glanceY
    const head = { x: gazeX * HEAD_FOLLOW, y: gazeY * 0.3 - voice * 2 * m, rot: gazeX * HEAD_TURN }

    // 8. ears: trail the body and the head on soft springs (follow-through), flick now and then
    ;[this.lagY, this.lagYV] = wobble(this.lagY, this.lagYV, y, dt, 0.34, 0.42)
    ;[this.lagX, this.lagXV] = wobble(this.lagX, this.lagXV, gazeX * EAR_FOLLOW, dt, 0.4, 0.5)
    // rising fast leaves the ear tips behind (they tip outward), dropping lifts them; a few degrees at most
    const flop = Math.max(-6, Math.min(9, (this.lagY - y) * 0.6)) * m
    if (this.t >= this.flickNext) {
      const i = this.flickAgain ?? (this.rand() < 0.5 ? 0 : 1)
      if (p.twitch > 0.05 && m) this.flickV[i] += 150 + this.rand() * 60 // deg/s outward
      // a quarter of flicks come as a quick double
      this.flickAgain = this.flickAgain == null && this.rand() < 0.25 ? i : null
      this.flickNext = this.t + (this.flickAgain != null ? 0.3 : (4 + this.rand() * 8) / Math.max(p.twitch, 0.2))
    }
    for (const i of [0, 1] as const) [this.flick[i], this.flickV[i]] = wobble(this.flick[i], this.flickV[i], 0, dt, 0.2, 0.38)
    const ear = (i: 0 | 1): Ear => {
      const out = p.ears + flop + this.flick[i] + (i === 1 ? 6 * p.swivel : 0)
      return { rot: i === 0 ? -out : out, x: this.lagX, y: p.earY + gazeY * 0.15, sx: i === 1 ? 1 - 0.12 * p.swivel : 1 }
    }

    return {
      x: drift,
      y,
      tilt: (p.tilt + sway) * (this.reduced ? 0.4 : 1),
      sx,
      sy,
      glow: Math.min(1, Math.max(0, p.glow * glowWave + voice * 0.12)),
      head,
      ears: [ear(0), ear(1)],
      eyes: [this.eye(0, blink, voice), this.eye(1, blink, voice)],
    }
  }

  private eye(i: 0 | 1, blink: number, voice: number): Eye {
    const p = this.pose
    const open = 1 - 0.92 * blink
    return {
      // in the head's frame: the head already carries part of the gaze
      x: EYE_X[i] + (p.gx + this.glanceX) * (1 - HEAD_FOLLOW),
      y: EYE_Y + (p.gy + this.glanceY) * 0.7,
      r: p.r + voice * 1.2,
      // closing into an arc also flattens the round eye, so the two read as one eye closing
      sy: Math.max(0.04, open * (1 - 0.9 * p.arc)),
      lid: p.lid,
      lidTilt: i === 0 ? p.lidTilt : -p.lidTilt,
      disc: 1 - p.arc,
      arc: p.arc,
      sag: p.sag,
      stroke: p.stroke,
    }
  }
}

// Glance targets (pack units, before the state's glance scale): sideways and a little up; thinking looks up.
const GLANCES: [number, number][] = [[-12, 0], [12, 0], [0, -8], [9, -7], [-9, -6]]
const THINK_GLANCES: [number, number][] = [[0, -12], [12, -11], [-10, -10], [14, -4]]

/** Arc eye path relative to the eye's centre (the pack's closed / sleepy shape: M -29 0 Q 0 sag 29 0). */
export const arcPath = (sag: number) => `M -29 0 Q 0 ${sag.toFixed(2)} 29 0`
