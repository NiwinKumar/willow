/** `npm test` (node --test, Node strips the types): the "Looks soft" heuristic on synthetic images. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ABS_FLOOR, laplacianVariance, softFlags, toGrey } from '../src/features/checkin/sharpness.ts'

const W = 96
const H = 128

/** A fine texture with edges (skin pores, hair, eyelashes stand-in): sharp. */
function textured(seed = 1): Float32Array {
  const g = new Float32Array(W * H)
  let s = seed
  for (let i = 0; i < g.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const x = i % W
    const y = Math.floor(i / W)
    g[i] = 128 + 40 * Math.sin(x / 2.1) * Math.cos(y / 3.3) + ((s % 41) - 20)
  }
  return g
}

/** Box blur, `passes` times (a shaken or out-of-focus shot). */
function blurred(src: Float32Array, passes: number): Float32Array {
  let a = src
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(a.length)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0
        let n = 0
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
            sum += a[yy * W + xx]
            n++
          }
        }
        b[y * W + x] = sum / n
      }
    }
    a = b
  }
  return a
}

test('a flat image scores zero and a textured one scores high', () => {
  assert.equal(laplacianVariance(new Float32Array(W * H).fill(120), W, H), 0)
  assert.ok(laplacianVariance(textured(), W, H) > 100)
})

test('blur lowers the score below the absolute floor', () => {
  const sharp = laplacianVariance(textured(), W, H)
  const soft = laplacianVariance(blurred(textured(), 3), W, H)
  assert.ok(soft < sharp / 10, `${soft} vs ${sharp}`)
  assert.ok(soft < ABS_FLOOR, `blurred score ${soft}`)
})

test('toGrey uses luma weights', () => {
  const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
  const g = toGrey(px, 3, 1)
  assert.deepEqual(Array.from(g, (v) => Math.round(v)), [76, 150, 29])
})

test('softFlags: one shaken shot among sharp siblings, a lone very soft photo, unknowns never flagged', () => {
  assert.deepEqual(softFlags([80, 90, 20, 85]), [false, false, true, false])
  assert.deepEqual(softFlags([3]), [true])
  assert.deepEqual(softFlags([40]), [false])
  assert.deepEqual(softFlags([null, 70, null]), [false, false, false])
  assert.deepEqual(softFlags([]), [])
  // every photo equally soft-ish: nothing stands out, and none is under the floor
  assert.deepEqual(softFlags([12, 13, 11]), [false, false, false])
})
