import './website.css'

import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Disclaimer } from '../../components/willow/Disclaimer'
import { useAuth } from '../../lib/useAuth'
import { HeroBloom, Lockup } from './Decor'
import { isReturning } from './entry'

/**
 * The first page (/): two ways in, no sign-in on it. Customers go through the front door (/start: straight
 * into the app when they have been here before, else onboarding, which makes their guest account at its
 * last step; `next` is carried along); retailers open Willow Proof (/retail). Signing in with Google stays
 * optional, later, on You and /signin. Laid out like the sign-in page it replaces: the bloom and the line
 * on the left, the frosted card on the right (stacked on a phone).
 */
export default function WaysIn() {
  const { user, loading } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next')
  const returning = !loading && isReturning(user)
  const customer = next ? `/start?next=${encodeURIComponent(next)}` : '/start'

  useEffect(() => {
    document.title = 'Willow: did your serum actually work?'
  }, [])

  return (
    <div className="w-sky relative grid min-h-dvh grid-cols-1 content-start min-[900px]:grid-cols-2 min-[900px]:content-stretch">
      <div className="relative flex flex-col justify-between gap-6 overflow-hidden px-[clamp(16px,3vw,40px)] pt-[clamp(14px,2.5vh,40px)] pb-2 min-[900px]:pb-[clamp(20px,3vw,40px)]">
        <HeroBloom className="absolute inset-0" mask="radial-gradient(70% 70% at 50% 50%, #000 40%, transparent 85%)" />
        <div className="relative self-start">
          <Lockup />
        </div>
        <p className="relative m-0 max-w-[440px] font-serif text-[clamp(30px,4vw,56px)] leading-none">
          Compare your skin with <span className="italic">your</span> skin.
        </p>
      </div>

      <div className="grid place-items-center px-[clamp(16px,4vw,48px)] pt-[clamp(12px,2vh,32px)] pb-[clamp(16px,3vh,40px)]">
        <main
          aria-labelledby="entry-h"
          className="flex w-full max-w-[440px] animate-rise flex-col gap-[clamp(12px,1.8vh,18px)] rounded-[32px] p-[clamp(18px,2.6vh,30px)] backdrop-blur-[26px] backdrop-saturate-[1.3]"
          style={{ background: 'rgba(250,250,248,.84)', boxShadow: '0 40px 80px -40px rgba(40,50,110,.45), inset 0 0 0 1px rgba(255,255,255,.6)' }}
        >
          <div className="flex flex-col gap-1.5">
            <h1 id="entry-h" className="m-0 font-serif text-h1 font-normal sm:text-[40px] sm:leading-none">
              {returning ? 'Welcome back' : 'Welcome to Willow'}
            </h1>
            <span className="text-[15px] leading-[1.45] text-ink-2">How are you using Willow today?</span>
          </div>

          <nav aria-label="Ways in" className="flex flex-col gap-2.5">
            <Link to={customer} className="cta-yellow group flex min-h-[76px] items-center gap-4 rounded-[22px] px-5 py-4 text-ink no-underline transition-transform active:scale-[.98]">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[17px] font-medium">For customers</span>
                <span className="text-[14px] leading-[1.4] text-ink/75">{returning ? 'Open your check-ins, baseline and routine.' : 'Track your own skin with photos, compared with your own baseline.'}</span>
              </span>
              <span aria-hidden className="grid size-10 flex-none place-items-center rounded-full bg-white/70 text-[18px] transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
            <Link to="/retail" className="group flex min-h-[76px] items-center gap-4 rounded-[22px] bg-selected px-5 py-4 text-inverse no-underline transition-transform active:scale-[.98]">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[17px] font-medium">For retailers</span>
                <span className="text-[14px] leading-[1.4] text-inverse/75">Willow Proof: how products do for real people, by skin profile.</span>
              </span>
              <span aria-hidden className="grid size-10 flex-none place-items-center rounded-full bg-white/15 text-[18px] transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          </nav>

          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[14px]">
            <Link to="/about" className="hit44 flex min-h-10 items-center text-ink underline underline-offset-4">
              About Willow
            </Link>
            <Link to="/terms" className="hit44 flex min-h-10 items-center text-ink-2 underline underline-offset-4">
              Terms and privacy
            </Link>
          </div>

          <Disclaimer />
        </main>
      </div>
    </div>
  )
}
