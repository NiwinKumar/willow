/** `npm test`: a built plan replaces a guest's sample routine (features/routine/sampleRoutine.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RoutineEntry } from '../src/data/types.ts'
import { planSave } from '../src/features/routine/sampleRoutine.ts'

const entry = (id: string, product_id: string, extra: Partial<RoutineEntry> & { sample?: boolean } = {}): RoutineEntry =>
  ({ id, product_id, custom_name: product_id, brand: '', category: 'serum', key_actives: [], inci: [], started_at: '2026-11-01', ended_at: null, slots: ['pm'], concerns: [], source: 'catalog', ...extra }) as RoutineEntry

test('a guest plan removes every sample entry and adds every pick, a pick the sample had included', () => {
  const sample = [entry('r1', 'cleanser', { sample: true }), entry('r2', 'retinol', { sample: true }), entry('r3', 'old', { sample: true, ended_at: '2026-11-10' })]
  const plan = planSave(sample, ['cleanser', 'sunscreen', 'moisturiser', 'serum'])
  assert.deepEqual(plan.add, ['cleanser', 'sunscreen', 'moisturiser', 'serum'])
  assert.deepEqual(plan.removeSample, ['r1', 'r2', 'r3'])
})

test('the person’s own current products are kept and not added twice; a stopped one is added again', () => {
  const own = [entry('r1', 'cleanser'), entry('r2', 'serum', { ended_at: '2026-11-10' })]
  const plan = planSave(own, ['cleanser', 'serum', 'serum'])
  assert.deepEqual(plan.add, ['serum'])
  assert.deepEqual(plan.removeSample, [])
})
