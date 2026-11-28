import { dayOf, evidence, REPO_BLOB } from './data'
import { Ext, Section, tile } from './parts'

/** The `scale` key of evidence.json, written by api/scripts/loadtest/report.py from the load test's results files. */
type Run = {
  label: string
  people: number
  succeeded: number
  failed: number
  errors: Record<string, number>
  e2e_s: {
    p50: number | null
    p95: number | null
    p99: number | null
    max: number | null
  }
  wall_s: number
  max_place_in_line: number | null
  engine_s_p50: number | null
}
type Projection = {
  max_instances: number
  vcpu: number
  needs_quota_increase: boolean
  done_p50_s: number
  done_p95_s: number
  last_done_s: number
  per_hour: number
  burst_engine_usd: number
}
export type Scale = {
  tested_on: string
  where: string
  people: number
  photos: string
  measured: {
    no_line: Run
    line: Run
    other_no_line?: Run & { photos: string }
  }
  model_check: {
    workers: number
    engine_s_p50: number
    predicted_last_s: number
    measured_wall_s: number
  }
  production: {
    engine_s_median: number
    runs_seen: number
    engine_usd_per_checkin: number
    checkin_usd: number
    now_max_instances: number
    quota_vcpu: number
  }
  projection: Projection[]
}

const scale = (evidence as { scale?: Scale }).scale

/** 41 s, or 8.9 min from 90 s up. */
const span = (s: number | null) => (s === null ? 'n/a' : s >= 90 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`)

function RunTile({ r, title, note }: { r: Run; title: string; note: string }) {
  const errors = Object.values(r.errors).reduce((a, b) => a + b, 0)
  return (
    <div className={`flex flex-col gap-1.5 ${tile}`}>
      <span className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[15px] font-normal">{title}</h3>
        <span className="text-[12px] text-ink-2">measured locally</span>
      </span>
      <span className="text-[30px] leading-none tracking-[-0.02em] tnum">
        {r.succeeded} <span className="text-[.5em] tracking-normal">of {r.people} measured</span>
      </span>
      <span className="text-[13.5px] leading-[1.45] text-ink-2">
        {errors ? `${errors} saw an error screen. ` : 'Nobody saw an error. '}
        {r.succeeded ? `Done in ${span(r.e2e_s.p50)} for half, ${span(r.e2e_s.p95)} for 95%.` : ''}
      </span>
      <span className="text-[12.5px] leading-[1.45] text-ink-2">{note}</span>
    </div>
  )
}

/**
 * "200 at once": the load test (api/scripts/loadtest), measured on one laptop with and without the line in front of
 * the engine (api/app/engine_gate.py), and what production's own engine time gives at a few instance counts,
 * labelled as a projection. Left out when evidence.json has no `scale` key.
 */
export function ScaleSection() {
  if (!scale) return null
  const { no_line, line, other_no_line: other } = scale.measured
  const p = scale.production
  const c = scale.model_check
  return (
    <Section
      id="scale"
      title="200 people at once"
      lead={`${scale.people} people press Measure at the same moment, on ${dayOf(scale.tested_on)}: the real api and measurement engine on one laptop, then the same line applied to production’s own numbers.`}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <RunTile r={no_line} title="Without a line" note="As deployed: the engine takes one check-in per instance, and every request past that is turned away." />
        <RunTile
          r={line}
          title="With the line"
          note={`Extra check-ins wait their turn instead of failing${line.max_place_in_line ? ` (places in line up to ${line.max_place_in_line})` : ''}; a wait longer than one request is asked again by the app, keeping its place.`}
        />
      </div>
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
        Photos: {scale.photos}.{other ? ` With ${other.photos} and no line, ${other.succeeded} of ${other.people} were measured.` : ''} {c.workers} engine processes stood in for Cloud Run instances, {span(c.engine_s_p50)} per check-in under
        load. The line predicts the last of {scale.people} done at {span(c.predicted_last_s)}; it took {span(c.measured_wall_s)}.
      </p>

      <h3 className="m-0 pt-1 text-[17px] font-normal">In production, projected</h3>
      <p className="m-0 max-w-[640px] text-[13.5px] leading-[1.5] text-ink-2">
        Not measured on Cloud Run: production’s median of {p.engine_s_median} s per face check-in ({p.runs_seen} runs in the logs) put through the same line. Each instance measures one check-in at a time.
      </p>
      <div>
        <table className="w-full border-collapse text-left text-[13.5px] tnum">
          <thead>
            <tr className="text-[12px] text-ink-2">
              <th scope="col" className="py-1.5 pr-3 font-normal">
                Engine instances
              </th>
              <th scope="col" className="py-1.5 pr-3 font-normal">
                Half done
              </th>
              <th scope="col" className="py-1.5 pr-3 font-normal">
                All {scale.people} done
              </th>
              <th scope="col" className="hidden py-1.5 font-normal sm:table-cell">
                Per hour
              </th>
            </tr>
          </thead>
          <tbody>
            {scale.projection.map((r) => (
              <tr key={r.max_instances} className="border-t border-ink/10">
                <td className="py-2 pr-3">
                  {r.max_instances}
                  {r.max_instances === p.now_max_instances || r.needs_quota_increase ? (
                    <span className="block text-[12px] text-ink-2 sm:inline sm:text-[13.5px]">
                      <span className="hidden sm:inline"> · </span>
                      {r.max_instances === p.now_max_instances ? 'today' : 'needs more quota'}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3">{span(r.done_p50_s)}</td>
                <td className="py-2 pr-3">{span(r.last_done_s)}</td>
                <td className="hidden py-2 sm:table-cell">{r.per_hour.toLocaleString('en')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
        More instances only finish the burst sooner: Cloud Run bills each instance while it measures, so {scale.people} check-ins cost the same ${scale.projection[0]?.burst_engine_usd.toFixed(2)} of engine time at any count, and an idle
        instance above the minimum costs nothing. Past {p.now_max_instances} instances the region’s {p.quota_vcpu} vCPU quota has to be raised first. Gemini’s part and cold starts are not in these rows.{' '}
        <Ext href={`${REPO_BLOB}api/scripts/loadtest/report.py`}>How this is computed</Ext>
      </p>
    </Section>
  )
}
