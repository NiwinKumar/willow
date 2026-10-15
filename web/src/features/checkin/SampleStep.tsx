import { WillowLoader } from '../../components/willow/WillowLoader'
import { useSamples } from '../../lib/useSamples'
import { plural, SITE_NAME } from './model'
import { MonoEyebrow, SerifTitle } from './parts'

/**
 * Step "samples": the hosted, consented sample photos (GET /v1/demo/samples). Running one copies its
 * photos into a session of this person on the server and measures them for real; nothing is uploaded.
 */
export function SampleStep({ busy, error, onRun, onOwn }: { busy: string | null; error: string | null; onRun: (id: string) => void; onOwn: () => void }) {
  const samples = useSamples()
  return (
    <main className="relative mx-auto flex max-w-[900px] animate-rise flex-col gap-4 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <div>
        <MonoEyebrow>Sample run</MonoEyebrow>
        <div className="mt-3">
          <SerifTitle id="ck-title" size="md">
            Run the pipeline on sample photos
          </SerifTitle>
        </div>
      </div>
      <p className="m-0 leading-normal text-[#3E3C38]">The photos are copied into your own account and measured for real: the engine on Cloud Run, then a Gemini explanation with every number checked.</p>
      {samples.state === 'loading' ? <WillowLoader inline label="Loading the sample photos" /> : null}
      {samples.state === 'error' || (samples.state === 'ready' && samples.samples.length === 0) ? (
        <p className="m-0 rounded-[26px] bg-surface/60 p-6 text-center text-ink-2">Sample photos are not available right now.</p>
      ) : null}
      {samples.state === 'ready' && samples.samples.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {samples.samples.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3.5 rounded-[26px] bg-surface/[.92] p-4 shadow-[0_20px_40px_-36px_rgba(0,0,0,.4)]">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[17px]">{s.title}</span>
                <span className="text-[13px] text-ink-2">
                  {SITE_NAME[s.site]} · {plural(s.n_frames, s.capture_mode === 'calibrated_raw' ? 'RAW photo' : 'phone photo')}
                  {s.note ? ` · ${s.note}` : ''}
                </span>
                {s.credit ? <span className="text-[12px] text-ink-2">{s.credit}</span> : null}
              </span>
              <button type="button" disabled={busy !== null} onClick={() => onRun(s.id)} className="min-h-11 rounded-pill bg-selected px-5 text-[15px] text-inverse">
                {busy === s.id ? 'Starting…' : 'Run'}
              </button>
            </li>
          ))}
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
    </main>
  )
}
