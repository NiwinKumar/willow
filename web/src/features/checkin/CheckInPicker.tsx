import type { CaptureMode, Site } from '../../data/types'

/** STUB: replaced by the design port (Willow App.dc.html check-in side sheet). */
export default function CheckInPicker({ onClose, onStart }: { open: boolean; onClose: () => void; preset?: { site?: Site; mode?: CaptureMode }; onStart: (site: Site, mode: CaptureMode) => void }) {
  return (
    <div className="fixed inset-0 z-[90] bg-surface p-6">
      <button type="button" onClick={() => onStart('face_full', 'uncalibrated')}>Face</button>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  )
}
