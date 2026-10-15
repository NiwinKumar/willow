import { BandBar } from '../components/BandBar'
import { measuredPlaces } from '../lib/metrics'
import { useDemoStatus } from '../lib/useDemoStatus'

/** Versions read live from the running services, so this line is never stale. */
function Versions() {
  const { status: s, failed, waking, gaveUp } = useDemoStatus()
  // Never a "…" that stays: say what is known once the check has answered (or failed).
  const pending = !s && !failed
  const engine = s?.engine.version ?? (pending ? '…' : waking ? (gaveUp ? 'asleep' : 'waking up') : 'unavailable')
  return (
    <>
      <p className="font-mono text-[13px]">
        engine {engine} · api {s?.api.version ?? (pending ? '…' : 'unavailable')} · web {__APP_VERSION__} · {s?.gemini.model ?? 'Gemini'}
      </p>
      <p className="mt-1 text-[13px]">The engine measures {measuredPlaces()} photos today.</p>
      {failed ? <p className="mt-1 text-[12px] text-text-3">The services did not answer a version check just now; reload to ask again.</p> : null}
    </>
  )
}

export function Science() {
  return (
    <article className="mx-auto max-w-[36rem] px-5 pb-20 pt-4 sm:px-8">
      <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Every number comes from calibrated computer vision. Gemini writes the explanation; it never produces a measurement.</h1>
      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['5', 'reference photos per baseline'],
          ['95%', 'confidence behind each noise band'],
          ['1', 'white reference beside every forearm photo'],
          // Face: tone, spots, evenness, redness, blemishes, under-eye, lines, shine, glow; close-ups add pores and texture.
          ['11', 'skin measurements across face and close-ups, and no scores'],
        ].map(([v, l]) => (
          <div key={l} className="rounded-(--radius-tile) bg-surface p-3">
            <dt className="font-mono text-[26px] font-medium leading-none">{v}</dt>
            <dd className="mt-1 text-[12px] text-text-2">{l}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-8 space-y-3 text-[15px] leading-relaxed text-text-2">
        <h2 className="text-[17px] font-semibold text-text">What a noise band is</h2>
        <p>Take five photos of the same skin a minute apart, moving the phone between each. The numbers will not be identical; the camera, the light and your hand all move a little. The spread of those readings is your noise. Willow turns it into a band: the larger of 1.96 × √2 × the spread and a 95% range for one new photo (wider when there are few photos), with a minimum spread per measurement so a near-identical set cannot make the band too narrow. A band needs at least three usable photos. A later reading counts as real change only when it lands outside that band.</p>
        <div className="rounded-(--radius-tile) bg-surface p-3">
          <BandBar value={12.4} baseline={14.2} mdc95={1.1} verdict="real_change" reach={2} label="Example: a reading outside the band" />
          <p className="mt-1 text-[12px] text-text-3">Example: baseline 14.2, band ±1.1, today 12.4. Outside the band, so a real change.</p>
        </div>
        <h2 className="pt-4 text-[17px] font-semibold text-text">How a photo becomes numbers</h2>
        <p>A RAW (DNG) photo skips the phone's beautifying and HDR processing. On the forearm, a white reference in the frame (a sheet of plain paper, or a 24-patch colour card) lets the engine correct each photo for the colour of the light; face photos use the camera's own colour for now, so face results are shown as trends. On the forearm, four pen dots mark the same 4 cm square every time; on the face, landmarks pick the regions (cheeks, forehead, under-eye) and mask out hair, eyes and lips. Cheek and nose close-ups are taken about 10 cm from the face with one eye in view: the iris is about the same size in every adult, so it sets the scale for pores and texture. Each metric is computed per frame, then averaged across the frames that passed quality checks. On the face, a dark spot or blemish seen in only one photo is not counted. Every threshold is relative to your own skin, never an absolute cut-off.</p>
        <h2 className="pt-4 text-[17px] font-semibold text-text">Why we never rank skin tone</h2>
        <p>Skin tone (ITA°) is reported as a description with its change, never a score, and no direction is called better. Lighter is not better. Redness is harder to read on deep skin tones; when the contrast is too low the metric is shown as indicative, and the report says so.</p>
        <h2 className="pt-4 text-[17px] font-semibold text-text">What Gemini does and does not do</h2>
        <p>Gemini names the spots the engine found, explains the results in plain words, reads ingredient labels, checks routines against a rule table, and acts as a shopping advisor over a facts-only catalog. It never estimates a measurement, a skin tone, a skin age or a diagnosis. Every number in its explanation is checked against the measurements; a number that is not there is rejected.</p>
        <h2 className="pt-4 text-[17px] font-semibold text-text">Limits, stated plainly</h2>
        <p>Willow is a cosmetic measurement tool, not a medical assessment. It does not measure hydration, firmness, UV damage or skin age. Lines are measured but always shown as a trend, because the light changes how deep they look. For a changing mole, bleeding or pain, see a dermatologist. Phone photos are uncalibrated and shown as trends only.</p>
        <h2 className="pt-4 text-[17px] font-semibold text-text">Validation</h2>
        <p>Willow makes no accuracy claim against a lab instrument. What it checks instead is repeatability: every baseline measures how much your own photos vary, and a change is called real only when it is bigger than that. Readings that are less dependable (blemish counts, lines, shine, glow, and redness on deep skin tones) are marked indicative wherever they appear.</p>
        <h2 className="pt-4 text-[17px] font-semibold text-text">Algorithm versions</h2>
        <Versions />
      </section>
    </article>
  )
}
