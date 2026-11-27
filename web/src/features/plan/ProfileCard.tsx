import { useState } from 'react'

import { LogoMark } from '../../components/willow/Logo'
import { localDay } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { usePlan } from './draft'
import type { PlanSkin, SkinProfile } from './planApi'
import { primary, secondary } from './styles'
import { Frame } from './ui'

/** The card's ground per skin type (aura hues: decoration only, never data). */
const GROUND: Record<PlanSkin, string> = {
  oily: 'radial-gradient(120% 90% at 0% 0%, #F6DE5C 0%, transparent 55%), radial-gradient(90% 90% at 100% 100%, #FFB27A 0%, transparent 60%), #F7F1E4',
  combination: 'radial-gradient(120% 90% at 0% 0%, #D8B8FF 0%, transparent 55%), radial-gradient(90% 90% at 100% 100%, #FFB27A 0%, transparent 60%), #F5EEF0',
  dry: 'radial-gradient(120% 90% at 0% 0%, #9CD3FF 0%, transparent 55%), radial-gradient(90% 90% at 100% 100%, #D8B8FF 0%, transparent 60%), #EEF1F7',
  normal: 'radial-gradient(120% 90% at 0% 0%, #B8E986 0%, transparent 55%), radial-gradient(90% 90% at 100% 100%, #9CD3FF 0%, transparent 60%), #EEF3EA',
}

const rise = (i: number) => ({ animation: `wRise .5s var(--ease-standard) ${420 + i * 70}ms both` })

/** (f) The person's skin profile from the plan: title, traits, focus, what is left out and why, cautions. */
export function ProfileStep() {
  const { result, draft, go } = usePlan()
  if (!result) return null
  return (
    <Frame
      title="Here's what Willow heard"
      sub="From your answers only. Your check-ins measure the rest."
      actions={
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" className={`${primary} sm:flex-1`} onClick={() => go('routine')}>
            See your routine <span aria-hidden>→</span>
          </button>
          <button type="button" className={`${secondary} sm:w-auto`} onClick={() => go('skin')}>
            Change answers
          </button>
        </div>
      }
    >
      <ProfileCard profile={result.profile} skin={draft.skin_type ?? 'normal'} />
    </Frame>
  )
}

export function ProfileCard({ profile, skin }: { profile: SkinProfile; skin: PlanSkin }) {
  const [today] = useState(localDay)
  return (
    <article
      aria-label="Your skin profile"
      className="relative overflow-hidden rounded-[32px] p-[clamp(16px,3vh,26px)] text-ink"
      style={{ background: GROUND[skin], boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.8), inset 0 0 60px rgba(255,255,255,.4), 0 40px 80px -40px rgba(0,0,0,.4)', animation: 'wPlanCard .8s var(--ease-spring) both' }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent)', animation: 'wPlanSheen 1.3s var(--ease-standard) .7s both' }} />
      <header className="relative flex items-center justify-between gap-3" style={rise(0)}>
        <span className="font-mono text-[10.5px] tracking-[.08em] text-ink-2">■ SKIN PROFILE · {fmtDate(today, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()}</span>
        <span className="flex items-center gap-1.5 text-[15px] font-light tracking-[-0.03em]">
          <LogoMark size={20} />
          willow
        </span>
      </header>
      <h2 className="relative mt-2 mb-0 font-serif text-[clamp(28px,4.4vh,40px)] leading-[1.05] font-normal" style={rise(1)}>
        {profile.title}
      </h2>

      {profile.traits.length ? (
        <ul className="relative m-0 mt-3 grid list-none gap-1.5 p-0 sm:grid-cols-2">
          {profile.traits.map((t, i) => (
            <li key={t.id} className="rounded-[18px] bg-white/60 px-3.5 py-2.5 backdrop-blur-[8px]" style={rise(2 + i)}>
              <span className="block text-[14.5px]">{t.label}</span>
              {t.detail ? <span className="mt-0.5 block text-[12.5px] leading-[1.35] text-ink-2">{t.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative mt-3 flex flex-col gap-2.5">
        {profile.focus.length ? <Row label="Focus" items={profile.focus} i={2 + profile.traits.length} tone="ink" /> : null}
        {profile.avoid.length ? <Row label="Left out" items={profile.avoid} i={3 + profile.traits.length} tone="soft" /> : null}
        {profile.cautions.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" style={rise(4 + profile.traits.length)}>
            {profile.cautions.map((c) => (
              <li key={c} className="flex gap-2 text-[13px] leading-[1.4]">
                <span aria-hidden className="text-ink-2">◌</span>
                {c}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  )
}

function Row({ label, items, i, tone }: { label: string; items: string[]; i: number; tone: 'ink' | 'soft' }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" style={rise(i)}>
      <span className="mr-1 w-[5.6em] whitespace-nowrap font-mono text-[10.5px] tracking-[.08em] text-ink-2">{label.toUpperCase()}</span>
      {items.map((x) => (
        <span key={x} className={`rounded-pill px-3 py-1 text-[13px] ${tone === 'ink' ? 'bg-selected text-inverse' : 'bg-white/70 text-ink'}`}>
          {tone === 'soft' ? <span aria-hidden className="mr-1 text-ink-2">⊘</span> : null}
          {x}
        </span>
      ))}
    </div>
  )
}
