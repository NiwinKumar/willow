import { deleteUser } from 'firebase/auth'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '../components/Button'
import { Sheet } from '../components/Sheet'
import { useData } from '../data/useData'
import { api } from '../lib/api'
import { fmtDate } from '../lib/format'
import { authErrorText } from '../lib/authErrors'
import { syncConsent } from '../lib/consent'
import { CONSENT_VERSION, prefs } from '../lib/prefs'
import { useAuth } from '../lib/useAuth'

export function Settings() {
  const { user, signOutUser, getIdToken, signInWithGoogle } = useAuth()
  const data = useData()
  const navigate = useNavigate()
  const consent = prefs.consent()
  const [confirm, setConfirm] = useState(false)
  const [optIn, setOptIn] = useState(consent?.aggregate_opt_in ?? false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function deleteEverything() {
    setDeleting(true)
    let serverDone = false
    try {
      if (!user) {
        prefs.clearAll()
        setConfirm(false)
        toast('Not signed in, so there was nothing stored on the server. This device is cleared.')
        return
      }
      // Signed in, the server copy goes too, even while looking at the demo.
      await api.deleteMe(await getIdToken())
      serverDone = true
      let accountGone = true
      try {
        await deleteUser(user)
      } catch {
        // Google may ask for a recent sign-in before removing the sign-in itself; the data is gone.
        accountGone = false
        await signOutUser()
      }
      prefs.clearAll()
      setConfirm(false)
      toast(accountGone ? 'Deleted: photos, results and your account.' : 'Deleted your photos and results, and signed you out. Your Google sign-in itself is managed by Google.')
      navigate('/')
    } catch {
      toast.error(serverDone ? 'Your data was deleted, but signing out did not finish. Close the tab to finish.' : 'Deletion did not finish. Try again; anything not yet removed is removed then.')
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
            ['Photos', 'Private bucket, us-central1. Each photo is deleted automatically 30 days after upload.'],
            ['Measurements', 'Kept in your account until you delete them.'],
            ['Face identification', 'None. Regions are found for measurement only; no identity template is computed.'],
            ['Consent', consent ? `Accepted ${fmtDate(consent.accepted_at)} (terms of ${/^\d{4}-\d{2}-\d{2}$/.test(consent.version) ? fmtDate(consent.version, { day: 'numeric', month: 'short', year: 'numeric' }) : consent.version})` : 'Not recorded on this device'],
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
            <span className="block text-[13px] text-text-2">Anonymized numbers only, never photos, never your name. Groups under 10 people are never shown.{consent ? '' : ' Available once you have accepted the terms before your first photo.'}</span>
          </span>
          <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-text)]" checked={optIn} disabled={!consent} onChange={(e) => {
            const on = e.target.checked
            setOptIn(on)
            prefs.setConsent({ ...(consent ?? { version: CONSENT_VERSION, accepted_at: new Date().toISOString() }), aggregate_opt_in: on })
            if (data.mode === 'live' && user) {
              syncConsent(user.uid, getIdToken)
                .then(() => toast(on ? 'Sharing on, saved to your account' : 'Sharing off, saved to your account'))
                .catch(() => toast.error('Saved on this device; your account will update when you are back online.'))
            } else toast(on ? 'Sharing on' : 'Sharing off')
          }} />
        </label>
      </section>

      <section className="mt-4 rounded-(--radius-tile) border border-border bg-surface p-4">
        <h2 className="text-[17px] font-semibold">Capture settings</h2>
        <p className="mt-1 text-[13px] text-text-2">RAW camera setup (Lightroom): {prefs.lightroomDone() ? 'done on this device' : 'not done yet'}. If you change the setup, take a new baseline so later photos stay comparable.</p>
        <Button variant="secondary" className="mt-3 !min-h-11" onClick={() => { prefs.setLightroomDone(false); toast('The setup steps will show on your next RAW capture.') }}>Show the setup steps again</Button>
      </section>

      {user?.isAnonymous ? (
        <section className="mt-4 rounded-(--radius-tile) border border-border bg-surface p-4">
          <h2 className="text-[17px] font-semibold">Keep your results</h2>
          <p className="mt-1 text-[13px] text-text-2">You are using a guest account on this device. Sign in with Google to keep your sessions and routine, and to open them on another device.</p>
          <Button
            className="mt-3 !min-h-11"
            onClick={() =>
              signInWithGoogle()
                .then(() => toast('Signed in with Google. Your sessions and routine are kept with it.'))
                .catch((e) => {
                  const t = authErrorText(e)
                  if (t) toast.error(t)
                })
            }
          >
            Keep them with Google
          </Button>
        </section>
      ) : null}

      <section className="mt-4 rounded-(--radius-tile) border border-danger/40 bg-surface p-4">
        <h2 className="text-[17px] font-semibold">Delete my data</h2>
        <p className="mt-1 text-[13px] text-text-2">Removes photos, results and your account. Minutes, not days. There is no undo.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" className="!min-h-11 !text-danger" onClick={() => setConfirm(true)}>Delete my data</Button>
          {user ? <Button variant="quiet" className="!min-h-11" onClick={() => (user.isAnonymous ? setConfirmSignOut(true) : void signOutUser())}>Sign out</Button> : null}
        </div>
      </section>

      <Sheet open={confirmSignOut} onOpenChange={setConfirmSignOut} title="Sign out of the guest account?">
        <p className="text-[15px] text-text-2">A guest account has no password. Once you sign out you cannot get back to its sessions and routine.</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => { setConfirmSignOut(false); void signOutUser() }}>Sign out anyway</Button>
          <Button variant="secondary" onClick={() => setConfirmSignOut(false)}>Stay signed in</Button>
        </div>
      </Sheet>
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
