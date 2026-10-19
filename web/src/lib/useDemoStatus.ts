import { useEffect, useState } from 'react'

import { api, type DemoStatus, type LiveCheck } from './api'

/** One service as the status chips show it. `note` always says the state in words (never colour alone). */
export type ServiceChip = { key: 'api' | 'engine' | 'gemini' | 'storage' | 'bigquery' | 'catalog'; label: string; state: 'ok' | 'degraded' | 'down' | 'waking' | 'info'; note: string }

/** Dot colour per state (design tokens). */
export const CHIP_DOT: Record<ServiceChip['state'], string> = {
  ok: 'var(--willow-400)',
  degraded: 'var(--aura-apricot)',
  waking: 'var(--aura-apricot)',
  down: 'var(--aura-coral)',
  info: 'var(--signal-noise)',
}

function live(c: LiveCheck, okNote: string): Pick<ServiceChip, 'state' | 'note'> {
  const ms = typeof c.latency_ms === 'number' ? `${c.latency_ms} ms` : ''
  if (c.status === 'ok') return { state: 'ok', note: [okNote, ms].filter(Boolean).join(' · ') }
  if (c.status === 'degraded') return { state: 'degraded', note: [c.reason === 'busy' ? 'busy' : c.reason === 'slow' ? 'slow' : 'partly working', ms].filter(Boolean).join(' · ') }
  if (c.status === 'unreachable') return { state: 'down', note: 'unreachable' }
  return { state: 'info', note: okNote ? `${okNote} · not checked` : 'not checked' } // an older api: configuration only
}

/**
 * The status chips (You's service status, the website's judge and science sections), from GET /v1/demo/status:
 * the api, the engine, and the live Gemini, storage and BigQuery checks with their latency (cached 60 s).
 */
export function serviceChips(s: DemoStatus, gaveUp: boolean): ServiceChip[] {
  const e = s.engine
  const engine: Pick<ServiceChip, 'state' | 'note'> =
    e.status === 'ok'
      ? { state: 'ok', note: [e.version, e.latency_ms !== undefined ? `${e.latency_ms} ms` : ''].filter(Boolean).join(' · ') }
      : e.status === 'waking'
        ? { state: 'waking', note: gaveUp ? 'asleep · wakes on first run' : 'waking · about 35 s' }
        : { state: 'down', note: 'unreachable' }
  const bq = s.bigquery
  const warehouse = live({ status: bq.status === 'ok' || bq.status === 'degraded' ? bq.status : bq.status === 'unavailable' || bq.status === 'unreachable' ? 'unreachable' : undefined, latency_ms: bq.latency_ms, reason: bq.reason }, bq.people !== undefined ? `${bq.people} people` : '')
  return [
    { key: 'api', label: 'Willow api', state: s.api.status === 'ok' ? 'ok' : 'down', note: s.api.version },
    { key: 'engine', label: 'Measurement engine', ...engine },
    { key: 'gemini', label: 'Gemini', ...live(s.gemini, s.gemini.model) },
    { key: 'storage', label: 'Photo storage', ...live(s.storage, '') },
    { key: 'bigquery', label: 'Retail warehouse', ...warehouse },
    { key: 'catalog', label: 'Catalog', state: 'info', note: `${s.catalog.products} products` },
  ]
}

const WAKE_RETRY_MS = 12_000
const WAKE_RETRIES = 4
/** The api caches its live checks for 60 s, so every screen shares one answer for that long. */
const STATUS_TTL_MS = 60_000

let shared: { promise: Promise<DemoStatus>; at: number } | null = null

/** /v1/demo/status, shared by every mounted reader: an answer (or a request on its way) under `maxAgeMs` old is reused. */
function readStatus(maxAgeMs: number): Promise<DemoStatus> {
  if (shared && Date.now() - shared.at < maxAgeMs) return shared.promise
  const entry = { promise: api.demoStatus(), at: Date.now() }
  shared = entry
  // A failure is never reused: the next reader asks again.
  entry.promise.catch(() => {
    if (shared === entry) shared = null
  })
  return entry.promise
}

/**
 * /v1/demo/status, asked again while the engine is waking (it sleeps when idle): every 12 s, at
 * most 4 more times, then the latest answer stays. `failed`: the api never answered at all;
 * `gaveUp`: the engine was still waking after the last try.
 */
export function useDemoStatus(): { status: DemoStatus | null; failed: boolean; waking: boolean; gaveUp: boolean } {
  const [status, setStatus] = useState<DemoStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState(false)
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    let retries = 0
    const ask = async () => {
      try {
        // A wake retry wants a newer answer than the one that said "waking" (another reader's retry may already be on its way).
        const s = await readStatus(retries === 0 ? STATUS_TTL_MS : WAKE_RETRY_MS / 2)
        if (!alive) return
        setStatus(s)
        if (s.engine.status === 'waking' && retries < WAKE_RETRIES) {
          retries++
          timer = window.setTimeout(() => void ask(), WAKE_RETRY_MS)
        } else setDone(true)
      } catch {
        if (!alive) return
        // A retry that fails keeps the last answer; only a first failure means "unknown".
        if (retries === 0) setFailed(true)
        setDone(true)
      }
    }
    void ask()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])
  const waking = status?.engine.status === 'waking'
  return { status, failed, waking, gaveUp: waking && done }
}
