import { Camera, FlaskConical, ShieldCheck, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '../components/Button'
import { Sheet } from '../components/Sheet'
import { CONSENT_VERSION, nextPath, prefs } from '../lib/prefs'

const cards = [
  {
    id: 'photos',
    icon: Camera,
    title: 'Your photos',
    body: 'Stored privately in your own space, in the US. Deleted automatically after 30 days. Measurements and a small aligned preview are kept so you can see your trend.',
    more: 'Photos go to a private Cloud Storage bucket in us-central1 with a 30-day lifecycle rule. Only the processing service reads them. The aligned preview is a small JPEG of the same frame the measurements were taken from; it stays with your results so the timeline has something to show. Nothing is used to train models.',
  },
  {
    id: 'measure',
    icon: FlaskConical,
    title: 'How we measure',
    body: 'Classical image analysis measures colour, spots, redness and texture against your own earlier photos. An AI assistant explains results and only repeats numbers we measured. It never guesses a skin age, score or diagnosis.',
    more: 'Every number comes from computer vision on your own photos: on the forearm a white reference (plain paper or a colour card) corrects the colour of the light, pen dots or face landmarks pick the regions, and a baseline of five photos (at least three must pass) gives your personal noise band. Phone and face photos use the camera’s own colour, so they are shown as trends. Gemini writes the explanation from those numbers; any digit it invents is rejected before you see it.',
  },
  {
    id: 'medical',
    icon: ShieldCheck,
    title: 'Not medical',
    body: 'Cosmetic tracking only. Willow cannot assess moles or skin conditions. For changing moles, see a dermatologist.',
    more: 'Willow is not a medical device and makes no diagnosis. If something looks concerning, such as a changing mole, bleeding or pain, see a dermatologist. The assistant will say the same.',
  },
] as const

export function Start() {
  const [optIn, setOptIn] = useState(false)
  const [more, setMore] = useState<(typeof cards)[number] | null>(null)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  return (
    <div className="mx-auto max-w-[36rem] px-5 pb-16 pt-4 sm:px-8">
      <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Before your first photo</h1>
      <p className="mt-2 text-[15px] text-text-2">Four things to know. Tap any for the detail.</p>
      <ul className="mt-6 space-y-3">
        {cards.map((c) => (
          <li key={c.id} className="rounded-(--radius-tile) border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <c.icon size={20} aria-hidden className="mt-0.5 shrink-0 text-willow-700" />
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold">{c.title}</h2>
                <p className="mt-1 text-[15px] leading-relaxed text-text-2">{c.body}</p>
                <button type="button" onClick={() => setMore(c)} aria-label={`Learn more: ${c.title}`} className="mt-2 min-h-11 text-[13px] font-medium text-willow-700 underline-offset-2 hover:underline">
                  Learn more
                </button>
              </div>
            </div>
          </li>
        ))}
        <li className="rounded-(--radius-tile) border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <Users size={20} aria-hidden className="mt-0.5 shrink-0 text-willow-700" />
            <div className="min-w-0 flex-1">
              <label className="flex cursor-pointer items-start justify-between gap-3">
                <span>
                  <span className="text-[15px] font-semibold">Optional: help improve recommendations</span>
                  <span className="mt-1 block text-[15px] leading-relaxed text-text-2">Share anonymized results (numbers only, never photos, never your name) to improve product recommendations and retailer insights. Change this any time in Settings.</span>
                </span>
                <span className="relative mt-1 inline-flex h-7 w-12 shrink-0 items-center">
                  <input type="checkbox" className="peer sr-only" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
                  <span aria-hidden className="h-7 w-12 rounded-full bg-noise-500/60 transition-colors peer-checked:bg-willow-600 peer-focus-visible:ring-2 peer-focus-visible:ring-signal-500" />
                  <span aria-hidden className="absolute left-1 h-5 w-5 rounded-full bg-surface shadow transition-transform duration-150 ease-(--ease-out) peer-checked:translate-x-5" />
                </span>
              </label>
            </div>
          </div>
        </li>
      </ul>
      <p className="mt-6 text-[13px] text-text-2">You can delete everything from Settings, “Delete my data”. Minutes, not days.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          onClick={() => {
            prefs.setConsent({ version: CONSENT_VERSION, accepted_at: new Date().toISOString(), aggregate_opt_in: optIn })
            navigate(`/goals?next=${encodeURIComponent(nextPath(params.get('next'), '/capture'))}`)
          }}
        >
          Agree and continue
        </Button>
        <Link to="/science" className="inline-flex min-h-11 items-center px-2 text-[15px] text-text-2 hover:text-text">
          Read how it works
        </Link>
      </div>
      <Sheet open={more !== null} onOpenChange={(o) => !o && setMore(null)} title={more?.title ?? ''}>
        <p className="text-[15px] leading-relaxed text-text-2">{more?.more}</p>
      </Sheet>
    </div>
  )
}
