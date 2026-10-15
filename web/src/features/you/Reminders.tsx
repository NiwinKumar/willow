import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'

import { Toggle } from '../../components/ui/Toggle'
import { useOwner } from '../../data/hooks'
import { useCheckin } from '../../data/useCheckin'
import { api } from '../../lib/api'
import { useQuery } from '../../lib/query'
import { addToCalendar, currentSubscription, isIos, permission, PushBlocked, pushSupport, turnOffPush, turnOnPush } from '../../lib/reminders'
import { scheduleText } from '../../lib/schedule'
import { useAuth } from '../../lib/useAuth'

const outline = 'min-h-[46px] self-start rounded-pill bg-white px-[18px] text-[14px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.15)] hover:bg-ink/[.03] disabled:opacity-55'

/**
 * Reminders (You): the check-in schedule as a repeating calendar event, and notifications on this device
 * (Web Push from the api, sent at the check-in time on scheduled days unless the person already checked in).
 * The days and time themselves are set in the check-in schedule (profile.checkin). Home's "Set a reminder"
 * opens this card (#reminders).
 */
export function RemindersCard() {
  const { getIdToken } = useAuth()
  const uid = useOwner()
  const checkin = useCheckin()
  const location = useLocation()
  const ref = useRef<HTMLElement>(null)
  // enabled false: the api has no VAPID keys (local runs, before setup), so reminders are by calendar only.
  const key = useQuery(['push-key', uid], (t) => api.pushKey(t), { enabled: Boolean(uid), staleMs: 10 * 60_000 })
  const [support] = useState(pushSupport)
  const [on, setOn] = useState<boolean | null>(support === 'supported' ? null : false)
  const [blocked, setBlocked] = useState(() => support === 'supported' && permission() === 'denied')
  const [busy, setBusy] = useState<'push' | 'test' | 'calendar' | null>(null)

  useEffect(() => {
    if (location.hash === '#reminders') ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [location.hash])
  useEffect(() => {
    if (support !== 'supported') return
    currentSubscription()
      .then((s) => setOn(Boolean(s)))
      .catch(() => setOn(false))
  }, [support])

  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const pushReady = key.data?.enabled === true && Boolean(key.data.public_key)

  const onPush = async (want: boolean) => {
    setBusy('push')
    try {
      if (want) {
        await turnOnPush(getIdToken, key.data!.public_key!)
        setOn(true)
        setBlocked(false)
        toast('Notifications on for this device')
      } else {
        await turnOffPush(getIdToken)
        setOn(false)
        toast('Notifications off for this device')
      }
    } catch (e) {
      if (e instanceof PushBlocked) {
        setBlocked(permission() === 'denied')
        if (permission() !== 'denied') toast('Notifications stay off: the browser asked and nothing was allowed.')
      } else toast.error(want ? "Couldn't turn notifications on. Try again." : "Couldn't turn notifications off. Try again.")
    } finally {
      setBusy(null)
    }
  }

  const sendTest = async () => {
    setBusy('test')
    try {
      const r = await api.pushTest(await getIdToken())
      if (r.sent > 0) toast(`Test sent to ${r.sent === 1 ? 'one device' : `${r.sent} devices`}. It should arrive in a moment.`)
      else toast.error('No device took the test. Turn notifications off and on again on this device.')
    } catch {
      toast.error("Couldn't send a test notification. Try again.")
    } finally {
      setBusy(null)
    }
  }

  const calendar = async () => {
    if (!checkin) return
    setBusy('calendar')
    await addToCalendar(getIdToken, checkin).catch(() => toast.error("Couldn't make the calendar file. Try again."))
    setBusy(null)
  }

  let pushNote: string
  if (key.status === 'loading' || key.status === 'idle') pushNote = 'Checking…'
  else if (!pushReady) pushNote = "Notifications aren't set up for Willow yet, so reminders come from your calendar."
  else if (support === 'ios-install') pushNote = 'On iPhone and iPad, Willow can only send notifications once it is on your Home Screen (iOS 16.4 or later). In Safari tap Share, then Add to Home Screen, open Willow from there and turn this on.'
  else if (support === 'unsupported') pushNote = isIos() ? 'Notifications need iOS 16.4 or later, with Willow added to your Home Screen. The calendar works on any version.' : "This browser can't show notifications from Willow. The calendar works everywhere."
  else if (blocked) pushNote = 'Notifications are blocked for Willow in this browser’s site settings. Allow them there, then turn this on.'
  else if (!checkin) pushNote = 'Choose your check-in days and time first.'
  else pushNote = on ? 'On · one notification at your check-in time on check-in days, unless you have already checked in.' : 'Off on this device.'
  // Turning off always works; turning on needs keys on the api, a browser that can, permission and a schedule.
  const canToggle = busy === null && on !== null && (on || (pushReady && support === 'supported' && !blocked && Boolean(checkin)))

  return (
    <section ref={ref} id="reminders" aria-label="Reminders" className="flex scroll-mt-24 flex-col gap-3 rounded-[36px] squircle bg-surface p-6">
      <span className="font-mono text-[12px] text-ink-2">■ REMINDERS</span>
      <span className="text-[20px]">{checkin ? scheduleText(checkin) : 'No check-in days yet'}</span>
      <span className="text-[14px] leading-normal text-[#3E3C38]">
        {checkin
          ? `Check-ins on the same days, at the same time, keep the light and your results comparable.${checkin.tz !== deviceTz ? ` Times are ${checkin.tz.replace(/_/g, ' ')} time.` : ''}`
          : 'Choose the days and time you check in, then add them to your calendar or turn on notifications here.'}
      </span>
      <button type="button" onClick={() => void calendar()} disabled={!checkin || busy === 'calendar'} aria-busy={busy === 'calendar' || undefined} className={outline}>
        {busy === 'calendar' ? 'Making the calendar file…' : 'Add to calendar'}
      </button>
      <span className="text-[13px] text-ink-2">One repeating event with an alert, for Google, Apple or Outlook calendars.</span>
      <div className="flex flex-col gap-2 rounded-[20px] bg-sunken px-4 py-2">
        <Toggle label="Notifications on this device" checked={Boolean(on)} disabled={!canToggle} onChange={(v) => void onPush(v)} description={pushNote} />
        {on && pushReady ? (
          <button type="button" onClick={() => void sendTest()} disabled={busy !== null} aria-busy={busy === 'test' || undefined} className={`${outline} mb-2 min-h-11`}>
            {busy === 'test' ? 'Sending…' : 'Send a test notification'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
