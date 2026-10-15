import { type DemoStatus } from '../lib/api'
import { useDemoStatus } from '../lib/useDemoStatus'

/** checked: pinged live by the api; otherwise only its configuration is shown. */
type Row = { name: string; where: string; detail: string; ok: boolean | null; checked: boolean }

function rows(s: DemoStatus | null, gaveUp: boolean): Row[] {
  const pending = s === null
  return [
    { name: 'Web app', where: 'Firebase Hosting + Firebase Auth', detail: 'you are on it', ok: true, checked: true },
    { name: 'API', where: s?.api.runtime ?? 'Cloud Run', detail: s ? `v${s.api.version}` : '', ok: pending ? null : s.api.status === 'ok', checked: true },
    {
      name: 'Measurement engine',
      where: 'Cloud Run (private), OpenCV + rawpy',
      detail:
        s?.engine.status === 'ok'
          ? `v${s.engine.version}${s.engine.latency_ms ? (s.engine.latency_ms > 3000 ? ` · answered in ${Math.round(s.engine.latency_ms / 1000)} s (it was waking up)` : ` · answered in ${s.engine.latency_ms} ms`) : ''}`
          : s?.engine.status === 'waking'
            ? gaveUp
              ? 'still waking up (it sleeps when idle); it starts on the first measurement'
              : 'waking up (it sleeps when idle); checking again in a few seconds'
            : s
              ? 'not answering right now'
              : '',
      // waking is not a failure: shown as pending, like a check still running
      ok: pending || s.engine.status === 'waking' ? null : s.engine.status === 'ok',
      checked: true,
    },
    { name: 'Gemini', where: s?.gemini.endpoint ?? 'Vertex AI', detail: s ? `${s.gemini.model} · configured; called on every answer` : '', ok: pending ? null : true, checked: false },
    { name: 'Sessions and routines', where: 'Firestore + Cloud Storage', detail: s ? `${s.storage.bucket} · configured` : '', ok: pending ? null : true, checked: false },
    {
      name: 'Retailer insights',
      where: 'BigQuery',
      detail: s?.bigquery.status === 'ok' ? `${s.bigquery.people} people (${s.bigquery.synthetic} synthetic, labelled)` : s ? 'unavailable' : '',
      ok: pending ? null : s.bigquery.status === 'ok',
      checked: true,
    },
    { name: 'Product catalog', where: 'facts only, no ads', detail: s ? `${s.catalog.products} products` : '', ok: pending ? null : true, checked: true },
  ]
}

/** Live check of every service behind the demo, from /v1/demo/status (cached a minute by the api). */
export function SystemStatus() {
  // While the engine wakes, the status is asked again every 12 s (at most 4 times).
  const { status, failed, waking, gaveUp } = useDemoStatus()
  return (
    <div>
      <ul className="divide-y divide-border border-y border-border" aria-busy={!status && !failed}>
        {rows(status, gaveUp).map((r) => (
          <li key={r.name} className="flex items-start gap-3 py-2.5">
            <span
              aria-hidden
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.ok === null ? (failed ? 'bg-danger' : 'animate-pulse bg-border') : !r.ok ? 'bg-warn' : r.checked ? 'bg-willow-500' : 'border border-willow-500'}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-[15px] font-medium">{r.name}</span>
                <span className="text-[12px] text-text-3">{r.where}</span>
              </span>
              {r.detail ? <span className="block font-mono text-[12px] text-text-2">{r.detail}</span> : null}
            </span>
            <span className="sr-only">{r.ok === null ? (failed ? 'status unknown' : r.name === 'Measurement engine' && waking ? (gaveUp ? 'still waking up' : 'waking up, checking again') : 'checking') : r.ok ? 'running' : 'not responding'}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-text-3">{failed ? 'Could not reach the API for a status check.' : status ? `Filled dots answered a live check at ${new Date(status.checked_at).toLocaleTimeString()}; hollow dots show configuration.` : 'Checking each service…'}</p>
    </div>
  )
}
