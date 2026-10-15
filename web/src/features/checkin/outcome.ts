import type { AnalysisState } from './useAnalysis'

/** What a measuring run came to, in the design's outcome words plus the real cases it did not draw. */
export type Outcome = 'run' | 'success' | 'rejected' | 'unmeasured' | 'timeout' | 'offline' | 'limit' | 'missing' | 'gone' | 'failed'

export function outcomeOf(s: AnalysisState): Outcome {
  if (s.kind === 'idle' || s.kind === 'running') return 'run'
  if (s.kind === 'offline') return 'offline'
  if (s.kind === 'done') {
    if (s.view.session.measured === false || !s.view.result) return 'unmeasured'
    return s.view.result.quality.passed ? 'success' : 'rejected'
  }
  if (s.status === 429) return 'limit'
  if (s.code === 'frames_missing') return 'missing'
  if (s.code === 'engine_timeout' || s.code === 'engine_unreachable') return 'timeout'
  if (s.status === 404) return 'gone'
  return 'failed'
}
