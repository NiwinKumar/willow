import { lazy, Suspense } from 'react'

import { useMediaQuery } from '../../lib/useMediaQuery'
import { WillowLoader } from '../willow/WillowLoader'

const CheckInFlow = lazy(() => import('../../features/checkin/CheckInFlow'))

/**
 * The check-in flow over the app (/check-in): a large centred sheet on desktop, full screen on phones
 * (APP_PLAN.md). The flow itself decides when it may close (never silently during upload or measuring).
 */
export function CheckInOverlay() {
  const phone = useMediaQuery('(max-width: 639px)')
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
