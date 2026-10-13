import { useEffect, useState } from 'react'

import { api, type DemoStatus } from '../lib/api'

type Row = { name: string; where: string; detail: string; ok: boolean | null }

function rows(s: DemoStatus | null): Row[] {
  const pending = s === null
  return [
    { name: 'Web app', where: 'Firebase Hosting + Firebase Auth', detail: 'you are on it', ok: true },
    { name: 'api', where: s?.api.runtime ?? 'Cloud Run', detail: s ? `v${s.api.version}` : '', ok: pending ? null : s.api.status === 'ok' },
    {
      name: 'Measurement engine',
      where: 'Cloud Run (private), OpenCV + rawpy',
      detail: s?.engine.status === 'ok' ? `v${s.engine.version}${s.engine.latency_ms ? ` · answered in ${s.engine.latency_ms} ms` : ''}` : s ? 'starting up or unreachable' : '',
      ok: pending ? null : s.engine.status === 'ok',
    },
    { name: 'Gemini', where: s?.gemini.endpoint ?? 'Vertex AI', detail: s?.gemini.model ?? '', ok: pending ? null : true },
    { name: 'Sessions and routines', where: 'Firestore + Cloud Storage', detail: s ? s.storage.bucket : '', ok: pending ? null : true },
    {
      name: 'Retailer insights',
      where: 'BigQuery',
      detail: s?.bigquery.status === 'ok' ? `${s.bigquery.people} people (${s.bigquery.synthetic} synthetic, labelled)` : s ? 'unavailable' : '',
      ok: pending ? null : s.bigquery.status === 'ok',
    },
    { name: 'Product catalog', where: 'facts only, no ads', detail: s ? `${s.catalog.products} products` : '', ok: pending ? null : true },
  ]
}

/** Live check of every service behind the demo, from /v1/demo/status (cached a minute by the api). */
export function SystemStatus() {
  const [status, setStatus] = useState<DemoStatus | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    api
      .demoStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])
  return (
    <div>
      <ul className="divide-y divide-border border-y border-border" aria-busy={!status && !failed}>
        {rows(status).map((r) => (
          <li key={r.name} className="flex items-start gap-3 py-2.5">
            <span
              aria-hidden
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.ok === null ? (failed ? 'bg-danger' : 'animate-pulse bg-border') : r.ok ? 'bg-willow-500' : 'bg-warn'}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-[15px] font-medium">{r.name}</span>
                <span className="text-[12px] text-text-3">{r.where}</span>
              </span>
              {r.detail ? <span className="block font-mono text-[12px] text-text-2">{r.detail}</span> : null}
            </span>
            <span className="sr-only">{r.ok === null ? 'checking' : r.ok ? 'running' : 'not responding'}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-text-3">{failed ? 'Could not reach the api for a status check.' : status ? `Checked live at ${new Date(status.checked_at).toLocaleTimeString()}.` : 'Checking each service…'}</p>
    </div>
  )
}
