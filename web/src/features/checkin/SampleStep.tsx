import { WillowLoader } from '../../components/willow/WillowLoader'
import type { Session } from '../../data/types'
import { useSamples } from '../../lib/useSamples'
import { plural, SITE_NAME } from './model'
import { MonoEyebrow, SerifTitle } from './parts'

/** The run of a sample that is this account's sample baseline (the api compares later sample runs with it). */
export const sampleBaseline = (sessions: Session[], sampleId: string) => sessions.find((s) => s.sample_id === sampleId && s.is_baseline && s.status === 'done') ?? null

/**
 * Step "samples": the hosted, consented sample photos (GET /v1/demo/samples). Running one copies its
 * photos into a session of this person on the server and measures them for real; nothing is uploaded.
 * The first run of a first-week sample is the sample baseline; a later-week sample (`after`) is then
 * compared with it, so it is offered once that baseline exists.
 */
export function SampleStep({ busy, error, sessions, onRun, onView, onOwn }: { busy: string | null; error: string | null; sessions: Session[]; onRun: (id: string) => void; onView: (sessionId: string) => void; onOwn: () => void }) {
  const samples = useSamples()
  const list = samples.state === 'ready' ? samples.samples : []
  return (
    <div className="relative mx-auto flex max-w-[900px] animate-rise flex-col gap-4 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <div>
        <MonoEyebrow>Sample run</MonoEyebrow>
        <div className="mt-3">
          <SerifTitle id="ck-title" size="md">
            Run the pipeline on sample photos
          </SerifTitle>
        </div>
      </div>
      <p className="m-0 leading-normal text-[#3E3C38]">
        The photos are copied into your own account and measured for real: the engine on Cloud Run, then a Gemini explanation with every number checked. The first run becomes the sample baseline; a later week is then compared with it. Each run takes about a minute.
      </p>
      {samples.state === 'loading' ? <WillowLoader inline label="Loading the sample photos" /> : null}
      {samples.state === 'error' || (samples.state === 'ready' && samples.samples.length === 0) ? (
        <p className="m-0 rounded-[26px] bg-surface/60 p-6 text-center text-ink-2">Sample photos are not available right now.</p>
      ) : null}
      {list.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {list.map((s) => {
            const base = sampleBaseline(sessions, s.id)
            const first = s.after ? list.find((x) => x.id === s.after) : undefined
            const waits = Boolean(s.after) && !sampleBaseline(sessions, s.after ?? '')
            // the comparison is the point: once the baseline exists, the sample after it is the main button
            const lead = !waits && !base && (Boolean(s.after) || !list.some((x) => x.after && sampleBaseline(sessions, x.after)))
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3.5 rounded-[26px] bg-surface/[.92] p-4 shadow-[0_20px_40px_-36px_rgba(0,0,0,.4)]">
                <span className="flex min-w-0 flex-1 basis-[220px] flex-col gap-1">
                  <span className="text-[17px]">{s.title}</span>
                  <span className="text-[13px] text-ink-2">
                    {SITE_NAME[s.site]} · {plural(s.n_frames, 'photo')}
                    {s.note ? ` · ${s.note}` : ''}
                  </span>
                  {base ? <span className="text-[13px]">Measured: this run is your sample baseline</span> : null}
                  {waits ? <span className="text-[13px]">Runs after “{first?.title ?? 'the first sample'}”, which becomes its baseline</span> : null}
                  {s.credit ? <span className="text-[12px] text-ink-2">{s.credit}</span> : null}
                </span>
                <span className="flex flex-wrap gap-2">
                  {base ? (
                    <button type="button" onClick={() => onView(base.id)} className="min-h-11 rounded-pill border border-ink/15 bg-white px-5 text-[15px]">
                      See the baseline
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy !== null || waits}
                    onClick={() => onRun(s.id)}
                    className={`min-h-11 rounded-pill px-5 text-[15px] disabled:opacity-45 ${lead ? 'bg-selected text-inverse' : 'border border-ink/15 bg-white'}`}
                  >
                    {busy === s.id ? 'Starting…' : base ? 'Run again' : 'Run'}
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 rounded-[20px] bg-surface/80 px-[18px] py-3.5 text-[15px]">
          {error}
        </p>
      ) : null}
      <p className="m-0 text-[14px] text-ink-2">
        Want to measure yourself?{' '}
        <button type="button" onClick={onOwn} className="min-h-11 font-medium text-ink underline underline-offset-4">
          Take a selfie
        </button>
      </p>
    </div>
  )
}
