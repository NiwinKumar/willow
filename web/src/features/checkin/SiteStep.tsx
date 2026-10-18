import { useState } from 'react'

import type { CaptureMode, Session, Site } from '../../data/types'
import { MEASURED_SITES } from '../../lib/metrics'
import { baselineLine, neededFor, pad2, SITE_CARD, SITE_MEASURES, SITE_NAME, sitesFor } from './model'
import { MonoEyebrow, SerifTitle } from './parts'

/**
 * Step "site" (CAP 04): the places with their real baseline line, and the photo count this
 * check-in needs. Reached from the guide's ← or when the check-in opens without a place.
 */
export function SiteStep({ site, mode, sessionsOf, known, onSite, onContinue }: { site: Site; mode: CaptureMode; sessionsOf: (s: Site) => Session[]; known: boolean; onSite: (s: Site) => void; onContinue: () => void }) {
  const n = known ? neededFor(sessionsOf(site), mode) : null
  const first = n === 5
  const [today] = useState(() => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase())
  return (
    <div className="relative mx-auto flex max-w-[1180px] animate-rise flex-col gap-[22px] px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <MonoEyebrow>New session · {today}</MonoEyebrow>
          <div className="mt-3">
            <SerifTitle id="ck-title">What are you photographing?</SerifTitle>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-3.5">
        {sitesFor(mode).map((s) => {
          const on = s === site
          const line = known ? baselineLine(sessionsOf(s), mode).text : 'Checking…'
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => onSite(s)}
              className="relative flex h-[270px] flex-col justify-between rounded-[36px] p-[22px] text-left transition-[translate] duration-[350ms] ease-standard hover:-translate-y-1"
              style={{ background: SITE_CARD[s].bg, color: SITE_CARD[s].fg, boxShadow: `${on ? '0 0 0 2.5px var(--text-primary)' : '0 0 0 0 transparent'}, inset 0 0 40px 6px rgba(255,255,255,.35), 0 24px 50px -36px rgba(0,0,0,.45)` }}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="rounded-pill bg-white/50 px-2.5 py-1.5 font-mono text-[11px] tracking-[.06em]">{MEASURED_SITES.includes(s) ? 'MEASURED' : 'SAVED · NOT MEASURED YET'}</span>
                <span aria-hidden className={`grid size-[30px] flex-none place-items-center rounded-full text-[14px] text-inverse transition-[background] ${on ? 'bg-selected' : 'bg-white/45'}`}>
                  {on ? '✓' : ''}
                </span>
              </span>
              <span className="flex flex-col gap-1.5">
                <span className="text-[24px] tracking-[-0.02em]">{SITE_NAME[s]}</span>
                <span className="text-[14px] leading-[1.35] opacity-85">{SITE_MEASURES[s]}</span>
                <span className="font-mono text-[12px] opacity-85">{line}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="m-0 px-1 text-[13px] text-ink-2">Testing a product? Set both forearm baselines before you start using it: the control arm separates the product from shared drift.</p>

      <div className="flex flex-wrap items-center justify-between gap-3.5 rounded-lg bg-surface/85 px-5 py-[18px]">
        <span className="flex items-center gap-3.5">
          <span className="font-dot text-[44px] leading-none">{n === null ? '··' : pad2(n)}</span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[17px]">{n === null ? 'Checking your baselines…' : first ? `First session · ${n} photos for a baseline` : `Later session · ${n} photos`}</span>
            <span className="text-[14px] text-ink-2">
              {SITE_NAME[site]}
            </span>
          </span>
        </span>
        <button type="button" disabled={n === null} onClick={onContinue} className="min-h-[58px] rounded-pill bg-selected px-[30px] text-[17px] text-inverse transition-[translate] duration-200 hover:translate-x-[3px]">
          Continue <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  )
}
