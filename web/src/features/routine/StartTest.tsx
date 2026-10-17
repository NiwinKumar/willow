import { useState } from 'react'

import { useMaybeShell } from '../../components/shell/ShellContext'
import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Chip'
import { TextField } from '../../components/ui/TextField'
import type { CaptureMode } from '../../data/types'
import { useData } from '../../data/useData'
import { ApiError } from '../../lib/api'
import { DEFAULT_TEST_DAYS, TEST_LENGTHS, VERDICT_AFTER_DAYS, useProductTestWrites } from './productTests'
import { failureText } from './writes'

export type TestPreset = { entry_id?: string; product_id?: string; name: string; /** Tied to a routine or catalog product: the name is that product's. */ fixedName?: boolean }

/**
 * "Start a forearm test" (design: product test band, "Self-tanner test"): name, length (7 to 56 days, 28 by
 * default), then straight into the treated-arm check-in so the first photos are the "before".
 */
export function StartTest({ preset, onCancel, onStarted }: { preset: TestPreset; onCancel?: () => void; onStarted?: () => void }) {
  const writes = useProductTestWrites()
  const shell = useMaybeShell()
  const data = useData()
  const [name, setName] = useState(preset.name)
  const [days, setDays] = useState<number>(DEFAULT_TEST_DAYS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The same capture mode as the forearm photos so far (a test compares like with like), else quick photos.
  const mode: CaptureMode = data.series('forearm_treated')?.sessions.at(-1)?.capture_mode ?? 'uncalibrated'

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await writes.start({ entry_id: preset.entry_id, product_id: preset.product_id, name: name.trim() || undefined, length_days: days })
      onStarted?.()
      shell?.startCheckIn('forearm_treated', mode)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? 'Another forearm test is running. End it on the product test page first.' : failureText(e, "Couldn't start the test. Nothing was saved; try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] leading-[1.5]">
        Use it on a small square on one forearm and leave the same square on the other forearm untouched. Photograph both arms together before the first use, then every few days. Willow gives a verdict after day {VERDICT_AFTER_DAYS}.
      </p>
      {preset.fixedName ? null : <TextField label="What you are testing" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Self-tanner" />}
      <div className="flex flex-col gap-1.5">
        <span id="test-length" className="text-[13px] opacity-80">
          Length
        </span>
        <div role="group" aria-labelledby="test-length" className="flex flex-wrap gap-1.5">
          {TEST_LENGTHS.map((d) => (
            <Chip key={d} selected={days === d} onToggle={() => setDays(d)}>
              {d} days
            </Chip>
          ))}
        </div>
        {days < VERDICT_AFTER_DAYS ? <span className="text-[13px] opacity-80">A {days}-day test ends before day {VERDICT_AFTER_DAYS}, so Willow won’t give a verdict for it. Choose {VERDICT_AFTER_DAYS} days or more for one.</span> : null}
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-avoid-bg px-3.5 py-2.5 text-[13px] text-avoid">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="ink" loading={busy} disabled={!preset.fixedName && !name.trim()} onClick={() => void start()}>
          Start and photograph both arms
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Not now
          </Button>
        ) : null}
      </div>
    </div>
  )
}
