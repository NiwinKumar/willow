import { Info, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { leaveDemo, useData } from '../data/useData'
import { Sheet } from './Sheet'

export function DemoBar() {
  const [about, setAbout] = useState(false)
  const navigate = useNavigate()
  const data = useData()
  return (
    <div role="status" className="flex min-h-10 items-center justify-between gap-3 bg-warn/18 px-5 text-[13px] text-warn-text sm:px-8">
      <span className="truncate">
        <strong className="font-semibold">Demo mode</strong> · {data.demoSource === 'real' ? "our team's measured test" : 'illustrative sample journey'} · nothing is saved to a real account
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => setAbout(true)} className="inline-flex min-h-11 items-center gap-1 rounded-(--radius-control) px-2 hover:bg-warn/20" aria-label="About the demo data">
          <Info size={16} aria-hidden /> About
        </button>
        <button
          type="button"
          onClick={() => {
            leaveDemo()
            navigate('/')
          }}
          className="inline-flex min-h-11 items-center gap-1 rounded-(--radius-control) px-2 hover:bg-warn/20"
        >
          <RotateCcw size={16} aria-hidden /> Reset
        </button>
      </span>
      <Sheet open={about} onOpenChange={setAbout} title="About the demo data">
        <div className="space-y-3 text-[15px] leading-relaxed text-text-2">
          {data.demoSource === 'real' ? (
            <p>You are looking at real measurements: our team's consented photos, analysed by the same engine and api as anyone's, in a read-only demo account. The retailer view uses a synthetic cohort and says so.</p>
          ) : (
            <>
              <p>You are looking at an illustrative sample journey generated from the engine's contract fixture: a face baseline with six weekly check-ins and a self-tanner split-forearm test over four days.</p>
              <p>The shape is real (five reference photos, a personal noise band per metric, verdicts only when a change clears it). The photos are drawn illustrations. To see real measurements, run the pipeline on sample photos from the judge tour, or take a selfie. The retailer view uses a synthetic cohort and says so.</p>
            </>
          )}
          <p>Nothing you do here is saved to a real account. Reset returns to the start.</p>
        </div>
      </Sheet>
    </div>
  )
}
