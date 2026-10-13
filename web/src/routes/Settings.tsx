import { deleteUser } from 'firebase/auth'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '../components/Button'
import { Sheet } from '../components/Sheet'
import { useData } from '../data/useData'
import { api } from '../lib/api'
import { fmtDate } from '../lib/format'
import { prefs } from '../lib/prefs'
import { useAuth } from '../lib/useAuth'

export function Settings() {
  const { user, signOutUser, getIdToken } = useAuth()
  const data = useData()
  const navigate = useNavigate()
  const consent = prefs.consent()
  const [confirm, setConfirm] = useState(false)
  const [optIn, setOptIn] = useState(consent?.aggregate_opt_in ?? false)
  const [deleteDate] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString())
  const [deleting, setDeleting] = useState(false)

  async function deleteEverything() {
    setDeleting(true)
    try {
      if (data.mode === 'live' && user) {
        await api.deleteMe(await getIdToken())
        try {
          await deleteUser(user)
        } catch {
          // Google accounts may need a recent sign-in to be removed; the data is gone either way.
          await signOutUser()
        }
      }
      prefs.clearAll()
      setConfirm(false)
      toast('Deleted: photos, results and your account.')
      navigate('/')
    } catch {
      toast.error('Could not delete right now. Nothing was removed; try again.')
    } finally {
      setDeleting(false)
    }
  }
  return (
    <div className="mx-auto max-w-[36rem] px-5 pb-20 pt-4 sm:px-8">
      <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Settings</h1>

      <section className="mt-6 rounded-(--radius-tile) border border-border bg-surface p-4" aria-labelledby="receipt">
        <h2 id="receipt" className="text-[17px] font-semibold">Privacy receipt</h2>
        <dl className="mt-3 space-y-2 text-[15px]">
          {[
            ['Account', user ? (user.isAnonymous ? 'Guest (anonymous)' : user.email ?? 'Google') : 'Not signed in'],
            ['Photos', `Private bucket, us-central1. Next automatic deletion by ${fmtDate(deleteDate)}.`],
            ['Measurements', 'Kept in your account until you delete them.'],
            ['Face identification', 'None. Regions are found for measurement only; no identity template is computed.'],
            ['Consent', consent ? `Version ${consent.version}, accepted ${fmtDate(consent.accepted_at)}` : 'Not recorded on this device'],
            ['Mode', data.mode === 'demo' ? 'Demo: sample journey, nothing saved to a real account' : 'Live'],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[120px_1fr] gap-2">
              <dt className="text-text-2">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-4 rounded-(--radius-tile) border border-border bg-surface p-4">
        <label className="flex cursor-pointer items-start justify-between gap-3">
          <span>
            <span className="block text-[15px] font-semibold">Help improve recommendations</span>
            <span className="block text-[13px] text-text-2">Anonymized numbers only, never photos, never your name. Groups under 10 people are never shown.</span>
          </span>
          <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-text)]" checked={optIn} onChange={(e) => { setOptIn(e.target.checked); if (consent) prefs.setConsent({ ...consent, aggregate_opt_in: e.target.checked }); toast(e.target.checked ? 'Sharing on' : 'Sharing off') }} />
        </label>
      </section>

      <section className="mt-4 rounded-(--radius-tile) border border-border bg-surface p-4">
        <h2 className="text-[17px] font-semibold">Capture settings</h2>
        <p className="mt-1 text-[13px] text-text-2">Lightroom setup {prefs.lightroomDone() ? 'done' : 'not done yet'}. Resetting it shows the setup card again and should go with a new baseline.</p>
        <Button variant="secondary" className="mt-3 !min-h-10" onClick={() => { prefs.setLightroomDone(false); toast('Setup card will show again') }}>Show the Lightroom setup again</Button>
      </section>

      <section className="mt-4 rounded-(--radius-tile) border border-danger/40 bg-surface p-4">
        <h2 className="text-[17px] font-semibold">Delete my data</h2>
        <p className="mt-1 text-[13px] text-text-2">Removes photos, results and your account. Minutes, not days. There is no undo.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" className="!min-h-10 !text-danger" onClick={() => setConfirm(true)}>Delete my data</Button>
          {user ? <Button variant="quiet" className="!min-h-10" onClick={() => void signOutUser()}>Sign out</Button> : null}
        </div>
      </section>

      <Sheet open={confirm} onOpenChange={setConfirm} title="Delete everything?">
        <p className="text-[15px] text-text-2">This removes photos, results and your account. There is no undo.</p>
        <div className="mt-4 flex gap-2">
          <Button className="!bg-danger" disabled={deleting} onClick={() => void deleteEverything()}>{deleting ? 'Deleting…' : 'Delete'}</Button>
          <Button variant="secondary" onClick={() => setConfirm(false)}>Keep my data</Button>
        </div>
        {data.mode === 'demo' ? <p className="mt-3 text-[12px] text-text-3">Demo: nothing is stored on the server, so this clears this device only.</p> : null}
      </Sheet>
    </div>
  )
}
