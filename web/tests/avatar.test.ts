/** `npm test`: the assistant avatar's motion model (components/assistant/avatarMotion.ts) is smooth and natural. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AVATAR_STATES, AvatarMotion, blinkCurve, damp, HAPPY_HOLD, type AvatarState, type Frame } from '../src/components/assistant/avatarMotion.ts'

// Seeded random, so every run sees the same blinks and glances.
function seeded(seed = 7) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function run(m: AvatarMotion, seconds: number, state: AvatarState, hz = 60, audio: number | null = null): Frame[] {
  const out: Frame[] = []
  for (let i = 0; i < Math.round(seconds * hz); i++) out.push(m.step(1 / hz, state, audio))
  return out
}

test('a critically damped spring settles without overshooting', () => {
  let x = 0
  let v = 0
  let prev = 0
  for (let i = 0; i < 120; i++) {
    ;[x, v] = damp(x, v, 10, 1 / 60, 0.4)
    assert.ok(x >= prev - 1e-9 && x <= 10 + 1e-9)
    prev = x
  }
  assert.ok(Math.abs(x - 10) < 0.01)
})

test('a blink closes in under 100 ms, holds, and opens in under 150 ms', () => {
  assert.equal(blinkCurve(0), 0)
  assert.ok(blinkCurve(0.04) > 0 && blinkCurve(0.04) < 1)
  assert.equal(blinkCurve(0.1), 1)
  assert.ok(blinkCurve(0.2) > 0 && blinkCurve(0.2) < 1)
  assert.equal(blinkCurve(0.26), 0)
  assert.ok(blinkCurve(0.3, true) > 0) // the slow variant takes longer
})

test('idle blinks every few seconds and keeps the body within a few units', () => {
  const frames = run(new AvatarMotion({ random: seeded() }), 30, 'idle')
  let blinks = 0
  for (let i = 1; i < frames.length; i++) if (frames[i].eyes[0].sy < 0.5 && frames[i - 1].eyes[0].sy >= 0.5) blinks++
  assert.ok(blinks >= 4 && blinks <= 11, `blinks: ${blinks}`)
  const ys = frames.map((f) => f.y)
  assert.ok(Math.max(...ys) - Math.min(...ys) < 16) // a gentle float, not a bounce
  assert.ok(frames.every((f) => Math.abs(f.tilt) < 2.5))
})

test('every state change is a blend: nothing jumps between two frames', () => {
  const m = new AvatarMotion({ random: seeded(3) })
  const frames: Frame[] = []
  for (const s of [...AVATAR_STATES, ...AVATAR_STATES.slice().reverse()]) frames.push(...run(m, 1.3, s, 60, s === 'speaking' ? 0.8 : null))
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]
    const b = frames[i]
    assert.ok(Math.abs(b.y - a.y) < 4, `body jumped at ${i}`)
    assert.ok(Math.abs(b.tilt - a.tilt) < 0.6, `tilt jumped at ${i}`)
    assert.ok(Math.abs(b.glow - a.glow) < 0.05, `glow jumped at ${i}`)
    for (const e of [0, 1] as const) {
      assert.ok(Math.abs(b.eyes[e].x - a.eyes[e].x) < 2.5 && Math.abs(b.eyes[e].y - a.eyes[e].y) < 2.5, `eye moved too far at ${i}`)
      // an eye closing into an arc takes ~250 ms (at most ~15% of the change in one 60 Hz frame)
      assert.ok(Math.abs(b.eyes[e].arc - a.eyes[e].arc) < 0.16 && Math.abs(b.eyes[e].lid - a.eyes[e].lid) < 0.08, `eye shape snapped at ${i}`)
      // an ear flick is quick but still a motion (a few degrees a frame at most), never a jump
      assert.ok(Math.abs(b.ears[e].rot - a.ears[e].rot) < 4 && Math.abs(b.ears[e].y - a.ears[e].y) < 2, `ear jumped at ${i}`)
    }
    assert.ok(Math.abs(b.head.x - a.head.x) < 1.5 && Math.abs(b.head.rot - a.head.rot) < 0.5, `head jumped at ${i}`)
  }
})

test('happy hops once with happy eyes, then blends back to idle on its own', () => {
  const m = new AvatarMotion({ random: seeded() })
  run(m, 2, 'idle')
  const hop = run(m, HAPPY_HOLD, 'happy')
  assert.ok(Math.min(...hop.map((f) => f.y)) < -10) // up
  assert.ok(hop.at(-1)!.eyes[0].arc > 0.9 && hop.at(-1)!.eyes[0].sag < 0) // arched-up eyes
  const after = run(m, 2, 'happy')
  assert.ok(after.at(-1)!.eyes[0].arc < 0.05) // round eyes again
})

test('speech moves the body only through a smoothed envelope', () => {
  const m = new AvatarMotion({ random: seeded() })
  run(m, 1, 'speaking', 60, 0)
  // a harsh on/off signal every frame still gives a smooth body
  const frames: Frame[] = []
  for (let i = 0; i < 120; i++) frames.push(m.step(1 / 60, 'speaking', i % 2 ? 1 : 0))
  for (let i = 1; i < frames.length; i++) assert.ok(Math.abs(frames[i].sy - frames[i - 1].sy) < 0.006)
  assert.ok(Math.max(...frames.map((f) => f.sy)) > 1.01) // and it does respond
})

test('sleepy and inactive settle the eyes; reduced motion stills the body but keeps the eyes', () => {
  const sleepy = run(new AvatarMotion({ random: seeded() }), 3, 'sleepy').at(-1)!
  assert.ok(sleepy.eyes[0].arc > 0.95 && sleepy.eyes[0].sag > 0)
  const inactive = run(new AvatarMotion({ random: seeded() }), 3, 'inactive').at(-1)!
  assert.ok(Math.abs(inactive.eyes[0].lid - 0.5) < 0.02)

  const still = run(new AvatarMotion({ random: seeded(), reducedMotion: true }), 20, 'idle')
  const ys = still.map((f) => f.y)
  assert.ok(Math.max(...ys) - Math.min(...ys) < 0.01)
  assert.ok(still.some((f) => f.eyes[0].sy < 0.5)) // it still blinks
})

test('motion is time-based: 60 Hz and 120 Hz land in the same place', () => {
  const a = run(new AvatarMotion({ random: seeded(11) }), 1.8, 'thinking', 60).at(-1)!
  const b = run(new AvatarMotion({ random: seeded(11) }), 1.8, 'thinking', 120).at(-1)!
  assert.ok(Math.abs(a.y - b.y) < 0.3 && Math.abs(a.tilt - b.tilt) < 0.05)
  assert.ok(Math.abs(a.eyes[0].x - b.eyes[0].x) < 0.6)
})

test('the head follows the gaze, a share of it, and the ears a little less', () => {
  const frames = run(new AvatarMotion({ random: seeded(5) }), 20, 'idle')
  const turned = frames.filter((f) => Math.abs(f.head.x) > 2)
  assert.ok(turned.length > 0) // glances turn the head
  for (const f of turned) {
    const look = f.eyes[0].x - 409 // the eyes' own share, in the head's frame
    assert.ok(Math.sign(look) === Math.sign(f.head.x) && Math.abs(f.head.x) < Math.abs(look) + 1e-9)
    assert.ok(Math.sign(f.head.rot) === Math.sign(f.head.x))
  }
})

test('ears flick now and then, droop when sleepy, perk when listening, trail a hop', () => {
  const idle = run(new AvatarMotion({ random: seeded(9) }), 40, 'idle')
  let flicks = 0
  for (let i = 1; i < idle.length; i++) for (const e of [0, 1] as const) if (Math.abs(idle[i].ears[e].rot) > 3 && Math.abs(idle[i - 1].ears[e].rot) <= 3) flicks++
  assert.ok(flicks >= 2 && flicks <= 16, `flicks: ${flicks}`)

  const sleepy = run(new AvatarMotion({ random: seeded() }), 4, 'sleepy').at(-1)!
  assert.ok(sleepy.ears[0].rot < -7 && sleepy.ears[1].rot > 7) // both tips out and down
  const listening = run(new AvatarMotion({ random: seeded() }), 4, 'listening').at(-1)!
  assert.ok(listening.ears[0].y < -3)

  const m = new AvatarMotion({ random: seeded() })
  run(m, 2, 'idle')
  const hop = run(m, 0.5, 'happy')
  const rots = hop.map((f) => f.ears[0].rot)
  assert.ok(Math.max(...rots) - Math.min(...rots) > 5) // the ear tips trail the jump, then settle
})

test('reduced motion keeps the ears still apart from their pose', () => {
  const frames = run(new AvatarMotion({ random: seeded(9), reducedMotion: true }), 30, 'idle')
  assert.ok(frames.every((f) => Math.abs(f.ears[0].rot) < 0.01 && Math.abs(f.ears[1].rot) < 0.01))
})
