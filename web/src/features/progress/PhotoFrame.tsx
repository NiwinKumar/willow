import type { ReactNode } from 'react'

import type { Session } from '../../data/types'
import { photoSize, type Box } from './frame'
import { useImageStatus } from './useImageStatus'

/**
 * The person's own photo, framed (4:5). States: loading (shimmer), failed to load, no preview (RAW reference
 * without a preview, or deleted after 30 days). Children draw over it in percentage coordinates.
 */
export function PhotoFrame({ session, box, alt, missing, children, rounded = 'rounded-[32px]' }: { session: Session; box: Box; alt: string; missing: string; children?: ReactNode; rounded?: string }) {
  const url = session.preview?.url ?? null
  const size = photoSize(session)
  const status = useImageStatus(url)
  const ready = status === 'ready'
  const broken = status === 'failed'
  return (
    <div className={`relative aspect-[4/5] overflow-hidden squircle ${rounded}`} style={{ background: 'repeating-linear-gradient(135deg, #E2DFD9 0 8px, #ECEAE5 8px 16px)' }}>
      {url && !broken ? (
        <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={alt} className="absolute inset-0 size-full">
          <image
            href={url}
            width={size.width}
            height={size.height}
            preserveAspectRatio="xMidYMid slice"
            className="transition-opacity duration-200"
            style={{ opacity: ready ? 1 : 0 }}
          />
        </svg>
      ) : null}
      {url && !ready && !broken ? <span aria-hidden className="skeleton absolute inset-0 rounded-none opacity-60" /> : null}
      {!url || broken ? (
        <span className="absolute inset-0 grid place-items-center p-8 text-center">
          <span className="max-w-[80%] rounded-[20px] bg-white/85 px-4 py-3 text-[14px]">{broken ? 'The photo could not be loaded. Reload the page to try again.' : missing}</span>
        </span>
      ) : null}
      {ready ? children : null}
    </div>
  )
}
