import type { MetricId, Site } from '../../data/types'
import { CLOSE_UPS, METRIC_META } from '../../lib/metrics'
import { CHIP_DOT, serviceChips, useDemoStatus } from '../../lib/useDemoStatus'
import { glide } from './scroll'

/** "a, b and c" */
function list(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : (items[0] ?? '')
}

const ALL = Object.keys(METRIC_META) as MetricId[]
/** Readable metric names for prose: "Skin tone (ITA°)" reads as "skin tone". */
const name = (id: MetricId) => (id === 'dark_circles' ? 'under-eye darkness' : METRIC_META[id].label.replace(/\s*\(.*\)$/, '').toLowerCase())
const measuredAt = (sites: Site[]) => ALL.filter((id) => METRIC_META[id].sites.some((s) => sites.includes(s)))

const FACE = measuredAt(['face_full'])
const CLOSE_UP = measuredAt(CLOSE_UPS)
const CLOSE_ONLY = CLOSE_UP.filter((id) => !FACE.includes(id))
const FOREARM = measuredAt(['forearm_treated', 'forearm_control'])

/** Method constants, all documented in docs/METRICS.md and docs/CAPTURE_PROTOCOL.md. */
const STATS: [string, string][] = [
  ['5', 'photos in a baseline, repositioned between each'],
  ['95%', 'confidence behind each noise band'],
  [String(ALL.length), 'skin measurements, and no scores'],
  ['30', 'days before original photos are deleted'],
]

/** Versions read live from the running services (GET /v1/demo/status), so this line is never stale. */
function RunningNow() {
  const { status: s, failed, waking, gaveUp } = useDemoStatus()
  const pending = !s && !failed
  const engine = s?.engine.version ?? (pending ? '…' : waking ? (gaveUp ? 'asleep' : 'waking up') : 'unavailable')
  return (
    <div className="flex flex-col gap-2.5">
      <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ RUNNING NOW</span>
      <p className="m-0 font-mono text-[13px] leading-relaxed text-ink" aria-live="polite">
        engine {engine} · api {s?.api.version ?? (pending ? '…' : 'unavailable')} · web {__APP_VERSION__} · {s?.gemini.model ?? 'Gemini'}
        {s ? ` · catalog ${s.catalog.products} products` : ''}
      </p>
      {s ? (
        <ul aria-label="Live service checks" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {serviceChips(s, gaveUp)
            .filter((c) => c.key !== 'api' && c.key !== 'catalog')
            .map((c) => (
              <li key={c.key} className="flex items-center gap-2 rounded-pill bg-white px-3 py-1.5 text-[12.5px]">
                <span aria-hidden className="size-2 rounded-full" style={{ background: CHIP_DOT[c.state] }} />
                {c.label}
                <span className="font-mono text-[11px] text-ink-2">{c.note}</span>
              </li>
            ))}
        </ul>
      ) : null}
      {failed ? <p className="m-0 text-[13px] text-ink-2">The services did not answer a version check just now; reload to ask again.</p> : null}
    </div>
  )
}

/**
 * "Measured · then explained": what each kind of photo measures (derived from the metric table, never a
 * hand-written list), the noise band in one paragraph with its formula, the spot diary rule and the
 * versions running right now. The App's "How this is measured" links land here (/science).
 */
export function ScienceSection({ className = '' }: { className?: string }) {
  return (
    <section id="science" className={`flex justify-center pt-[clamp(72px,10vw,140px)] ${className}`}>
      <h2 className="sr-only">The science</h2>
      <div className="w-full max-w-[1080px] overflow-hidden rounded-[clamp(36px,5vw,56px)] bg-surface shadow-[0_40px_80px_-50px_rgba(0,0,0,.3)]">
        <div
          className="relative grid h-[clamp(300px,42vw,520px)] place-items-center overflow-hidden"
          style={{
            background:
              'radial-gradient(40% 50% at 25% 30%, #7C83F0 0%, transparent 70%), radial-gradient(45% 50% at 80% 25%, #F2B53A 0%, transparent 70%), radial-gradient(50% 50% at 20% 85%, #FF5A3A 0%, transparent 70%), radial-gradient(60% 50% at 70% 80%, #4F9B6A 0%, transparent 70%), #1E3B33',
            filter: 'saturate(1.1)',
          }}
        >
          <div aria-hidden className="absolute inset-[-10%] backdrop-blur-[40px]" />
          <p className="relative m-0 px-5 text-center text-[clamp(22px,3.4vw,42px)] font-light tracking-[.06em] text-white">MEASURED&nbsp;&nbsp;·&nbsp;&nbsp;THEN&nbsp;&nbsp;EXPLAINED</p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-8 p-[clamp(28px,4vw,48px)]">
          <div className="flex flex-col items-start gap-[22px]">
            <h3 className="m-0 text-[clamp(22px,2.2vw,28px)] font-normal leading-[1.25] tracking-[-0.01em]">Numbers come from image measurement. Gemini explains them and never invents one.</h3>
            <a
              href="#limits"
              onClick={(e) => {
                e.preventDefault()
                glide('limits')
              }}
              className="cta-yellow rounded-pill px-6 py-[13px] text-[15px] text-ink no-underline transition-[filter] hover:brightness-105"
            >
              Read the science and limits
            </a>
          </div>
          <p className="m-0 text-[16px] leading-[1.6] text-ink-2">
            Face check-ins measure {list(FACE.map(name))}. Faces carry no colour reference, so face readings are labelled indicative. Cheek and nose close-ups add {list(CLOSE_ONLY.map(name))}, with the iris setting the scale. Forearm tests measure {list(FOREARM.map(name))}, and are labelled measured when a RAW photo has a white reference beside the skin. Thresholds are relative to your own skin, so no tone is treated as better than another.
          </p>

          <dl className="col-span-full m-0 grid grid-cols-2 gap-3 border-t border-line pt-5 sm:grid-cols-4">
            {STATS.map(([v, l]) => (
              <div key={l} className="flex flex-col gap-1.5">
                <dt className="font-dot text-[40px] leading-none">{v}</dt>
                <dd className="m-0 text-[13px] leading-snug text-ink-2">{l}</dd>
              </div>
            ))}
          </dl>

          <div className="col-span-full flex flex-col gap-2.5 border-t border-line pt-5">
            <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ NOISE BAND</span>
            <p className="m-0 max-w-[760px] text-[16px] leading-[1.6] text-ink-2">
              Five photos of the same skin never give identical numbers: the camera, the light and your hand all move a little. Their spread is your noise. The band is the larger of 1.96 × √2 × the spread and a 95% range for one new photo, which is wider when there are few photos, with a floor per measurement so a near-identical set cannot make it too narrow. A band needs at least three usable photos. A later reading counts as a real change only when it lands outside it.
            </p>
            <p className="m-0 overflow-x-auto font-mono text-[13px] text-ink">band = max(1.96 · √2 · sd, t₀.₉₇₅,ₙ₋₁ · sd · √(1 + 1/n))</p>
          </div>

          <div className="col-span-full flex flex-col gap-2.5 border-t border-line pt-5">
            <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ SPOT DIARY</span>
            <p className="m-0 max-w-[760px] text-[16px] leading-[1.6] text-ink-2">
              Each face photo places every spot on a standard face, so the same spot is recognised next time even if your head is turned a little. A spot joins the diary once two check-ins show it, or two photos of one check-in do. It only counts as gone after two good check-ins in a row without it, because a single photo can miss a spot.
            </p>
          </div>

          <div className="col-span-full border-t border-line pt-5">
            <RunningNow />
          </div>
        </div>
      </div>
    </section>
  )
}
