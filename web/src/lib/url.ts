import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Report view state lives in the URL: ?t=<session index>&m=<metric id>&layer=1 */
export function useViewState() {
  const [params, setParams] = useSearchParams()
  // No ?t= means the latest session (Number('') would be 0, the baseline).
  const rawT = params.get('t')
  const t = rawT === null || rawT === '' ? Number.NaN : Number(rawT)
  const m = params.get('m') ?? null
  const layer = params.get('layer') === '1'
  const demo = params.get('demo') === '1'
  const set = useCallback(
    (patch: { t?: number | null; m?: string | null; layer?: boolean | null }, replace = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (patch.t !== undefined) {
            if (patch.t === null) next.delete('t')
            else next.set('t', String(patch.t))
          }
          if (patch.m !== undefined) {
            if (patch.m === null) next.delete('m')
            else next.set('m', patch.m)
          }
          if (patch.layer !== undefined) {
            if (patch.layer) next.set('layer', '1')
            else next.delete('layer')
          }
          return next
        },
        { replace },
      )
    },
    [setParams],
  )
  return { t: Number.isFinite(t) ? t : null, m, layer, demo, set }
}
