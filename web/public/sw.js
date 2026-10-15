/*
 * Willow service worker: check-in reminders only (Web Push from willow-api, api/app/reminders.py).
 * Registered when the person turns notifications on in You, unregistered when they turn them off.
 * No fetch handler: nothing is cached, the app always loads from the network.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Willow', {
      body: data.body || '',
      tag: data.tag || 'willow',
      data: { url: data.url || '/home' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only ever a page of this app (a path from the api's payload), else Home.
  const path = event.notification.data && event.notification.data.url
  const target = new URL(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : '/home', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(target).catch(() => undefined)
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})
