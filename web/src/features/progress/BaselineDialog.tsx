import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import type { Session } from '../../data/types'
import { useData } from '../../data/useData'
import { ApiError, api } from '../../lib/api'
import { clockOf, fmtDate } from '../../lib/format'
import { useAuth } from '../../lib/useAuth'
import { usedFrames } from './model'

/**
 * "Make {day} your baseline?" (design confirm dialog): POST /v1/baselines/{site}, then every session is read
 * again (later sessions are compared with the new one). Works for RAW and Quick: each mode has its own.
 */
/** `withTime`: the day has several check-ins, so the time says which one becomes the baseline. */
export function BaselineDialog({ session, withTime = false, open, onClose }: { session: Session; withTime?: boolean; open: boolean; onClose: () => void }) {
  const data = useData()
  const { getIdToken } = useAuth()
  const [precedes, setPrecedes] = useState(false)
  const [saving, setSaving] = useState(false)
  const day = `${fmtDate(session.created_at, { day: 'numeric', month: 'long' })}${withTime ? `, ${clockOf(session.created_at)}` : ''}`
  const used = usedFrames(session)
  const close = () => {
    setPrecedes(false)
    onClose()
  }
  const go = async () => {
    setSaving(true)
    try {
      await api.setBaseline(await getIdToken(), session.site, session.id)
      await data.refresh()
      toast(`Baseline changed to ${day}`)
      close()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not change the baseline. Try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Sheet open={open} onClose={close} title="Change baseline" hideTitle variant="modal" size="sm">
      <div className="flex flex-col gap-4">
        <h2 className="m-0 text-[28px] leading-[1.1] font-normal tracking-[-0.02em]">Make {day} your baseline?</h2>
        <p className="m-0 leading-[1.55] text-ink-2">
          Every later {session.capture_mode === 'uncalibrated' ? 'Quick' : 'RAW'} check-in will be compared with this one instead. Earlier check-ins keep the comparison they had. A baseline should come before you start the products you’re testing.
        </p>
        {used < 3 ? (
          <p className="m-0 rounded-[16px] bg-[var(--action-primary)] px-3.5 py-3 text-[14px] leading-[1.45]">
            This check-in has {used === 1 ? 'one usable photo' : `${used} usable photos`}, so there will be no normal range. Willow will show values but can’t call any change real until a baseline with 3 or more usable photos exists.
          </p>
        ) : null}
        <label className="flex cursor-pointer items-start gap-3 leading-[1.45]">
          <input type="checkbox" checked={precedes} onChange={() => setPrecedes((p) => !p)} className="m-0 size-[22px] shrink-0 accent-[var(--action-selected)]" />
          This check-in was taken before I started the products I’m testing.
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="ink" size="lg" className="flex-1" disabled={!precedes} loading={saving} onClick={() => void go()}>
            Set as baseline
          </Button>
          <Button variant="outline" size="lg" className="flex-1" disabled={saving} onClick={close}>
            Keep current
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
