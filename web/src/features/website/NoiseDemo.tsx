import { useState } from 'react'

import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { METRIC_META } from '../../lib/metrics'
import { compare, NOISE_METRICS, NOISE_SOURCE, PHOTOS, type NoiseMetric, type Photo } from './noiseReadings'

/*
 * "Same face, two photos" (judge tour): the contrast with score apps, shown on real measurements.
 * - What the judge came for: to see why a single photo-to-photo difference is not a change.
 * - Seen first: the two sentences side by side, the score app's "9 fewer blemishes" against Willow's "Within your
 *   normal range", with the band drawn under it.
 * - Controls: which two of the five photos (a pill that glides; choosing the photo already in the other slot swaps
 *   them) and which measure. Every number is the engine's (noiseReadings.ts); nothing here is Gemini's.
 * - Motion: the difference marker glides along the band (transform only), the readings and the score app's sentence
 *   cross-fade on a change while Willow's answer stays still (that steadiness is the point), the band's edges stay put (the scale is the band's), so nothing reflows while it moves.
 * Four tests: (1) it shows the noise a score app reports as change, on the person's own numbers; (2) "A score app"
 * and "Willow" are labelled in words, the band is labelled with its size; (3) it sits below the stops, nothing in
 * the way; (4) the tour's own glass card, serif heading, pills and tokens.
 */

const pairLabel = (p: Photo) => `Photo ${p}`

export function NoiseDemo() {
  const [a, setA] = useState<Photo>(1)
  const [b, setB] = useState<Photo>(2)
  const [metric, setMetric] = useState<NoiseMetric>('blemishes')
  const c = compare(metric, a, b)
  const label = METRIC_META[metric].label
  const pick = (slot: 'a' | 'b', p: Photo) => {
    // the same photo twice says nothing: the other slot takes this one's old photo instead
    if (slot === 'a') {
      if (p === b) setB(a)
      setA(p)
    } else {
      if (p === a) setA(b)
      setB(p)
    }
  }
  const photoOptions = PHOTOS.map((p) => ({ value: String(p), label: String(p) }))
  return (
    <section aria-labelledby="noise-h" className="glass mt-2 grid gap-6 rounded-[36px] p-[clamp(20px,3vw,32px)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] md:gap-8">
      <div className="flex min-w-0 flex-col gap-4">
        <h2 id="noise-h" className="m-0 font-serif text-[clamp(28px,3vw,40px)] font-normal leading-[1.05]">
          Same face, two photos.
        </h2>
        <p className="m-0 text-[14px] leading-[1.5] text-ink-2 [text-wrap:pretty]">
          Mei’s five week-one photos were taken in one sitting, so nothing about her skin changed between them. The engine measured each one on its own. Any difference between two of them is the photo, not the skin.
        </p>
        <div className="flex flex-col gap-3">
          <PhotoPicker label="First" value={a} options={photoOptions} onChange={(p) => pick('a', p)} />
          <PhotoPicker label="Second" value={b} options={photoOptions} onChange={(p) => pick('b', p)} />
        </div>
        <p className="m-0 text-[12px] leading-[1.45] text-ink-2">
          Mei is simulated: generated photos, real measurements by the engine (version {NOISE_SOURCE.engine}). Gemini never produces these numbers.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-4 rounded-[28px] bg-white/70 p-[clamp(16px,2.4vw,24px)]">
        <div role="radiogroup" aria-label="Measure" className="flex flex-wrap gap-1.5">
          {NOISE_METRICS.map((m) => {
            const on = m === metric
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMetric(m)}
                className={`hit44 min-h-9 rounded-pill px-3.5 text-[13px] transition-[background-color,color,scale] duration-200 ease-standard active:scale-[.97] ${on ? 'bg-selected text-inverse' : 'bg-canvas text-ink hover:bg-white'}`}
              >
                {METRIC_META[m].label}
              </button>
            )
          })}
        </div>

        <dl className="m-0 grid grid-cols-2 gap-2">
          {[
            [pairLabel(a), c.a],
            [pairLabel(b), c.b],
          ].map(([k, v], i) => (
            <div key={i} className="flex flex-col gap-0.5 rounded-[18px] bg-canvas px-3.5 py-2.5">
              <dt className="text-[12px] text-ink-2">
                {k} · {label.toLowerCase()}
              </dt>
              <dd key={`${metric}-${v}`} className="m-0 text-[22px] leading-tight tracking-[-0.01em] tnum animate-[wFadeIn_.32s_var(--ease-standard)_both]">
                {v}
              </dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <div className="flex flex-col gap-1 rounded-[18px] border border-dashed border-ink/20 px-3.5 py-3">
            <span className="text-[12px] text-ink-2">A score app would say</span>
            <span key={`${metric}-${a}-${b}`} className="min-h-[2.5em] text-[15px] leading-[1.25] text-ink sm:text-[17px] animate-[wRise_.4s_var(--ease-standard)_both]">
              {c.scoreApp}
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-[18px] bg-selected px-3.5 py-3 text-inverse">
            <span className="text-[12px] opacity-80">Willow says</span>
            <span key={String(c.inside)} className="min-h-[2.5em] text-[15px] leading-[1.25] sm:text-[17px] animate-[wRise_.4s_var(--ease-standard)_both]">
              {c.willow}
            </span>
          </div>
        </div>

        <Band position={c.position} bandShare={c.bandShare} band={c.band} diff={c.diff} inside={c.inside} label={label} />

        <p className="m-0 text-[13px] leading-[1.5] text-ink-2 [text-wrap:pretty]">
          {c.fromRoom
            ? `Her photos of one sitting vary by up to ${c.spread} on ${label.toLowerCase()} (95%); a new room’s light can move it further, so her normal range is ${c.band}.`
            : `Her photos of one sitting vary by up to ${c.band} on ${label.toLowerCase()} (95%).`}{' '}
          Every pair of the five, on every measure here, stays inside that range, which is why Willow compares each check-in with her own normal range, never with one earlier photo.
        </p>
      </div>
    </section>
  )
}

function PhotoPicker({ label, value, options, onChange }: { label: string; value: Photo; options: { value: string; label: string }[]; onChange: (p: Photo) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="w-[52px] shrink-0 text-[14px]">{label}</span>
      <SegmentedControl label={`${label} photo`} size="sm" options={options} value={String(value)} onChange={(v) => onChange(Number(v) as Photo)} className="min-w-0 flex-1 md:max-w-[260px]" />
    </div>
  )
}

/**
 * The difference on a track scaled to 1.4 bands: the shaded middle is the normal range (its edges never move for a
 * metric, so only the marker travels), the marker sits at the difference and glides when the pair or measure changes.
 */
function Band({ position, bandShare, band, diff, inside, label }: { position: number; bandShare: number; band: string; diff: string; inside: boolean; label: string }) {
  return (
    <figure className="m-0 flex flex-col gap-1.5" aria-label={`${label}: the two photos differ by ${diff}; the normal range is ${band}; ${inside ? 'inside' : 'outside'} it`}>
      <div aria-hidden className="relative h-11">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink/15" />
        <div
          className="absolute inset-y-1.5 left-1/2 w-full origin-center rounded-pill bg-willow-400/25 transition-transform duration-500 ease-standard"
          style={{ transform: `translateX(-50%) scaleX(${bandShare})` }}
        />
        <div className="absolute inset-y-1 left-1/2 w-px bg-ink/30" />
        {/* the marker's box is the track's width, so translateX in % of it is a position on the track */}
        <div className="absolute inset-0 transition-transform duration-[560ms] ease-standard will-change-transform" style={{ transform: `translateX(${position * 50}%)` }}>
          <span className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ink shadow-[0_2px_8px_rgba(0,0,0,.25)]" />
        </div>
      </div>
      <figcaption className="flex justify-between gap-2 font-mono text-[11px] text-ink-2 tnum">
        <span>normal range {band}</span>
        <span>difference {diff}</span>
      </figcaption>
    </figure>
  )
}
