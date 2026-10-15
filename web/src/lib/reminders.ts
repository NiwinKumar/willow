/**
 * Check-in reminders on this device: the calendar file (from the api, else built here) and Web Push.
 * The service worker (public/sw.js) is registered only when the person turns notifications on, and
 * unregistered when they turn them off; it shows notifications and caches nothing.
 */
import { api } from './api'
import { icsFor, type Checkin } from './schedule'

/** Save the repeating check-in event. The api's file carries the schedule's time zone; offline, a local one. */
export async function addToCalendar(getIdToken: () => Promise<string>, checkin: Checkin): Promise<void> {
  let blob: Blob
  try {
    blob = await api.reminderIcs(await getIdToken())
  } catch {
    blob = new Blob([icsFor(checkin, window.location.origin)], { type: 'text/calendar' })
  }
  const url = URL.createObjectURL(new Blob([blob], { type: 'text/calendar' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'willow-check-in.ics'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * supported: can turn on here. ios-install: iPhone/iPad in Safari, where web push only reaches a web app
 * added to the Home Screen (iOS 16.4+). unsupported: this browser has no Web Push (or iOS before 16.4).
 */
export type PushSupport = 'supported' | 'ios-install' | 'unsupported'

export const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function pushSupport(): PushSupport {
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (isIos() && !installed()) return 'ios-install'
  return has ? 'supported' : 'unsupported'
}

export const permission = (): NotificationPermission => ('Notification' in window ? Notification.permission : 'denied')

/** This device's subscription, if reminders were turned on here. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

export class PushBlocked extends Error {}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const sameKey = (sub: PushSubscription, key: Uint8Array) => {
  const k = sub.options.applicationServerKey
  if (!k) return false
  const a = new Uint8Array(k)
  return a.length === key.length && a.every((b, i) => b === key[i])
}

/**
 * Ask for permission (call straight from the tap: Safari needs the gesture), register the worker,
 * subscribe with the api's VAPID key and save the subscription on the account.
 */
export async function turnOnPush(getIdToken: () => Promise<string>, publicKey: string): Promise<void> {
  const answer = await Notification.requestPermission()
  if (answer !== 'granted') throw new PushBlocked(answer)
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  const key = keyBytes(publicKey)
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await api.pushSubscribe(await getIdToken(), sub.toJSON())
}

/** Forget this device on the account, drop the subscription and the worker. */
export async function turnOffPush(getIdToken: () => Promise<string>): Promise<void> {
  const sub = await currentSubscription()
  if (sub) {
    await api.pushUnsubscribe(await getIdToken(), sub.endpoint)
    await sub.unsubscribe().catch(() => false)
  }
  const reg = await navigator.serviceWorker?.getRegistration('/')
  await reg?.unregister()
}
