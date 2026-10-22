/** `npm test`: the journeys' narration script (features/journey/voice.json) and its clips (public/voice). */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('..', import.meta.url).pathname
const { lines } = JSON.parse(readFileSync(`${root}src/features/journey/voice.json`, 'utf8')) as { lines: { id: string; take: string; text: string; show?: string; ms?: number }[] }
const ids = new Set(lines.map((l) => l.id))
const src = (p: string) => readFileSync(`${root}src/features/journey/${p}`, 'utf8')

test('every line has one id, a clip and its length', () => {
  assert.equal(ids.size, lines.length)
  for (const l of lines) {
    assert.ok(existsSync(`${root}public/voice/${l.id}.mp3`), `${l.id}.mp3`)
    assert.ok((l.ms ?? 0) > 500, `${l.id} length`)
  }
})

test('a slide shows the start of what it says, word for word', () => {
  for (const l of lines) if (l.show) assert.ok(l.text.startsWith(l.show), l.id)
})

test('every line a walkthrough or a slide speaks is in the script', () => {
  const used = [...`${src('meiSegments.ts')}${src('brandSegments.ts')}`.matchAll(/v\('([\w-]+)'\)|checkIn\(\d, '([\w-]+)'\)|askWisp\([^)]*'([\w-]+)'\)|compare\('([\w-]+)'\)/g)].map((m) => m.slice(1).find(Boolean) as string)
  assert.ok(used.length > 50)
  for (const id of used) assert.ok(ids.has(id), id)
  for (const id of ['mei-problem', 'mei-intro', 'mei-c1', 'mei-c2', 'mei-c3', 'mei-c4', 'mei-c5', 'mei-gains', 'mei-retail', 'mei-end']) assert.ok(ids.has(id), id)
  for (const k of ['intro', 'proof', 'compare', 'customers', 'ask', 'sell', 'value', 'end']) assert.ok(ids.has(`brand-${k}`), k)
})
