import { Play } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { leaveDemo } from '../data/useData'
import { ApiError, api, type DemoSample } from '../lib/api'
import { SITE_LABEL } from '../lib/metrics'
import { useAuth } from '../lib/useAuth'
import { Button } from './Button'

export function SampleRuns({ samples, onStart }: { samples: DemoSample[]; onStart?: () => void }) {
  const { user, continueAsGuest, getIdToken } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (s: DemoSample) => {
    setBusy(s.id)
    try {
      if (!user) await continueAsGuest()
      leaveDemo()
      const res = await api.startSample(await getIdToken(), s.id)
      onStart?.()
      navigate(`/processing/${res.session_id}?site=${res.site}&n=${res.n_frames}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not start the sample. Try again.')
      setBusy(null)
    }
  }

  return (
    <ul className="divide-y divide-border border-y border-border">
      {samples.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 py-3">
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">{s.title}</span>
            <span className="block text-[13px] text-text-2">
              {SITE_LABEL[s.site]} · {s.n_frames} {s.capture_mode === 'calibrated_raw' ? 'RAW' : 'phone'} {s.n_frames === 1 ? 'photo' : 'photos'}
              {s.note ? ` · ${s.note}` : ''}
            </span>
            {s.credit ? <span className="block text-[12px] text-text-3">{s.credit}</span> : null}
          </span>
          <Button className="shrink-0" disabled={busy !== null} onClick={() => void run(s)}>
            <Play size={16} aria-hidden /> {busy === s.id ? 'Starting…' : 'Run'}
          </Button>
        </li>
      ))}
    </ul>
  )
}
