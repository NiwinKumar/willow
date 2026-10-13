import { useEffect, useState } from 'react'

import { BandBar } from '../components/BandBar'
import { api, type DemoStatus } from '../lib/api'
import { MEASURED_SITES, SITE_LABEL } from '../lib/metrics'

/** Versions read live from the running services, so this line is never stale. */
function Versions() {
  const [s, setS] = useState<DemoStatus | null>(null)
  useEffect(() => {
    let alive = true
    api.demoStatus().then((r) => alive && setS(r)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return (
    <p className="font-mono text-[13px]">
      engine {s?.engine.version ?? '…'} ({MEASURED_SITES.map((m) => SITE_LABEL[m].toLowerCase()).join(' and ')} measured today) · api {s?.api.version ?? '…'} · web {__APP_VERSION__} · {s?.gemini.model ?? 'Gemini'}
    </p>
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
          ['24', 'patches on the colour card'],
          ['11', 'cosmetic parameters, 0 scores'],
        ].map(([v, l]) => (
          <div key={l} className="rounded-(--radius-tile) bg-surface p-3">
            <dt className="font-mono text-[26px] font-medium leading-none">{v}</dt>
            <dd className="mt-1 text-[12px] text-text-2">{l}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-8 space-y-3 text-[15px] leading-relaxed text-text-2">
        <h2 className="text-[17px] font-semibold text-text">What a noise band is</h2>
        <p>Take five photos of the same skin a minute apart, moving the phone between each. The numbers will not be identical; the camera, the light and your hand all move a little. The spread of those five readings is your noise. Willow turns it into a band (1.96 × √2 × the spread, the minimum detectable change at 95%), and a later reading counts as real change only when it lands outside that band.</p>
        <div className="rounded-(--radius-tile) bg-surface p-3">
          <BandBar value={12.4} baseline={14.2} mdc95={1.1} verdict="real_change" reach={2} label="Example: a reading outside the band" />
          <p className="mt-1 text-[12px] text-text-3">Example: baseline 14.2, band ±1.1, today 12.4. Outside the band, so a real change.</p>
        </div>
        <h2 className="pt-4 text-[17px] font-semibold text-text">How a photo becomes numbers</h2>
        <p>A RAW (DNG) photo skips the phone's beautifying and HDR processing. A 24-patch colour card in the frame lets the engine fit a colour correction to each photo and report how well it fit. Face landmarks pick the regions (cheeks, forehead, under-eye) and mask out hair, eyes and lips. Each metric is computed per frame, then averaged across the frames that passed quality checks. Every threshold is relative to your own skin, never an absolute cut-off.</p>
        <h2 className="pt-4 text-[17px] font-semibold text-text">Why we never rank skin tone</h2>
        <p>Skin tone (ITA°) is reported as a description with its change, never a score, and no direction is called better. Lighter is not better. Redness is harder to read on deep skin tones; when the contrast is too low the metric is shown as indicative, and the report says so.</p>
        <h2 className="pt-4 text-[17px] font-semibold text-text">What Gemini does and does not do</h2>
        <p>Gemini labels the regions the engine found, explains the results in plain words, reads ingredient labels, checks routines against a rule table, and acts as a shopping advisor over a facts-only catalog. It never estimates a measurement, a skin tone, a skin age or a diagnosis. Every number in its explanation is checked against the measurements; a number that is not there is rejected.</p>
        <h2 className="pt-4 text-[17px] font-semibold text-text">Limits, stated plainly</h2>
        <p>Willow is a cosmetic measurement tool, not a medical assessment. It cannot measure hydration, firmness, UV damage or skin age, and does not try to. For a changing mole, bleeding or pain, see a dermatologist. Quick selfies are uncalibrated and shown as trends only.</p>
        <h2 className="pt-4 text-[17px] font-semibold text-text">Validation</h2>
        <p>Repeatability numbers per metric, the self-tanner split-forearm result and the per-tone-band checks are published here as they are measured during the build (Oct 13 to 17, 2026), including where Willow is weak.</p>
        <h2 className="pt-4 text-[17px] font-semibold text-text">Algorithm versions</h2>
        <Versions />
      </section>
    </article>
  )
}
