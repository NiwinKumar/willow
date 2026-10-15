import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useMediaQuery } from '../../lib/useMediaQuery'
import { WillowLoader } from '../willow/WillowLoader'

const CheckInFlow = lazy(() => import('../../features/checkin/CheckInFlow'))

/**
 * The check-in flow over the app (/check-in): a large centred sheet on desktop, full screen on phones
 * (APP_PLAN.md). The flow itself decides when it may close (never silently during upload or measuring).
 */
export function CheckInOverlay() {
  const phone = useMediaQuery('(max-width: 639px)')
  // The control that opened the flow (read before the page behind turns inert). The picker's own button is
  // gone by then, so a check-in started from the picker returns focus to the shell's Check in button.
  const [opener] = useState(() => {
    const a = document.activeElement
    return a instanceof HTMLElement && a !== document.body && !a.closest('dialog') ? a : null
  })
  // Only when the flow closes back onto the page it was drawn over (a finished check-in opens its result instead).
  const { state } = useLocation()
  const [under] = useState(() => (state as { background?: { pathname?: string } } | null)?.background?.pathname ?? '/home')
  useEffect(
    () => () => {
      window.setTimeout(() => {
        const a = document.activeElement
        if ((a && a !== document.body) || window.location.pathname !== under) return
        const trigger = [...document.querySelectorAll<HTMLElement>('button[aria-label="Check in"]')].find((b) => b.getClientRects().length > 0)
        ;(opener?.isConnected ? opener : trigger)?.focus({ preventScroll: true })
      }, 0)
    },
    [opener, under],
  )
  return (
    <>
      <div aria-hidden className="fixed inset-0 z-[60] animate-fade bg-[rgba(18,18,18,.3)] backdrop-blur-[8px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Check in"
        className="fixed z-[61] flex animate-sheet flex-col overflow-hidden squircle bg-canvas"
        style={{
          inset: phone ? 0 : 'clamp(12px,3vh,32px) clamp(12px,4vw,64px)',
          borderRadius: phone ? 0 : 36,
          boxShadow: '0 60px 120px -40px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.6)',
        }}
      >
        <Suspense fallback={<WillowLoader inline label="Opening check-in" />}>
          <CheckInFlow />
        </Suspense>
      </div>
    </>
  )
}
