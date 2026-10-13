import { Check, Circle, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { CaptureMode, Site } from '../data/types'
import { useData } from '../data/useData'
import { BASELINE_SITES, DONT_VARY, WHY_FIVE, baselineState, photoSteps } from '../lib/baselineGuide'
import { fmtDate, plural } from '../lib/format'
import { MEASURED_SITES, SITE_LABEL } from '../lib/metrics'

/** Shown when this session will become the person's baseline: why 5 photos, and how to take them. */
export function FirstSessionGuide({ site, mode, n = 5 }: { site: Site; mode: CaptureMode; n?: number }) {
  const steps = photoSteps(site, mode)
  return (
    <section className="rounded-(--radius-tile) border border-willow-500/40 bg-surface p-4" aria-labelledby="first-session">
      <h2 id="first-session" className="text-[17px] font-semibold leading-snug">This is your first one, so it becomes your baseline.</h2>
      <p className="mt-1 text-[15px] text-text-2">Your baseline is the before that later photos are compared with. Take {n} photos so Willow can tell real change from noise.</p>
      <ul className="mt-3 space-y-2 text-[15px]">
        <li>
          <span className="font-medium">Every photo: </span>
          {steps.same}
        </li>
        <li>
          <span className="font-medium">Between photos: </span>
          {steps.between}
        </li>
        <li className="text-text-2">{DONT_VARY}</li>
      </ul>
      <p className="mt-3 text-[13px] text-text-2">{WHY_FIVE}</p>
    </section>
  )
}

/** Which places have a baseline in this capture mode: the face and both forearm squares. */
export function BaselineChecklist({ mode, current, onPick }: { mode: CaptureMode; current?: Site; onPick?: (site: Site) => void }) {
  const data = useData()
  const quick = mode === 'uncalibrated'
  return (
    <section aria-labelledby="baselines">
      <h2 id="baselines" className="text-[17px] font-semibold">Your baselines{quick ? ' (quick selfie)' : ''}</h2>
      <p className="mt-1 text-[13px] text-text-2">Set one for each place you track. For a product test, set both forearms before you start using the product.</p>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {BASELINE_SITES.map((site) => {
          const st = baselineState(data.series(site)?.sessions ?? [], mode)
          return (
            <li key={site} className="flex min-h-12 items-center gap-3 py-2">
              {st.state === 'set' ? (
                <Check size={20} aria-hidden className="shrink-0 text-willow-700" />
              ) : st.state === 'saved' ? (
                <Clock size={20} aria-hidden className="shrink-0 text-text-2" />
              ) : (
                <Circle size={20} aria-hidden className="shrink-0 text-text-3" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{SITE_LABEL[site]}</span>
                <span className="block text-[13px] text-text-2">{describe(st, site)}</span>
              </span>
              {st.state === 'none' && site !== current ? (
                onPick ? (
                  <button type="button" onClick={() => onPick(site)} className="min-h-11 shrink-0 rounded-(--radius-control) border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
                    Set it
                  </button>
                ) : (
                  <Link to={`/capture?site=${site}${quick ? '&mode=quick' : ''}`} className="inline-flex min-h-11 shrink-0 items-center rounded-(--radius-control) border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
                    Set it
                  </Link>
                )
              ) : null}
              {st.state === 'none' && site === current ? <span className="shrink-0 text-[13px] text-text-2">This session</span> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function describe(st: ReturnType<typeof baselineState>, site: Site): string {
  if (st.state === 'set') return `Set ${fmtDate(st.session.created_at)} · ${plural(st.session.n_frames, 'photo', 'photos')}`
  if (st.state === 'saved') return 'Photos saved. The first session becomes your baseline once this place is measured.'
  return MEASURED_SITES.includes(site) ? 'No baseline yet' : 'No baseline yet. Photos are saved now and measured once this place is ready.'
}
