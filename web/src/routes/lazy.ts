/**
 * Every page except the landing loads on demand, so the first visit downloads only what it shows.
 * prefetchRoutes() warms the likely next pages in idle time, so moving on still feels instant.
 */
import { lazy } from 'react'

/**
 * After a deploy, a tab opened earlier asks for page files that no longer exist. Reload once
 * (remembered for a minute so a real outage cannot loop) to pick up the new version.
 */
export function fresh<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((err: unknown) => {
      const key = 'willow.chunkReload'
      let last = 0
      try {
        last = Number(sessionStorage.getItem(key) ?? 0)
        sessionStorage.setItem(key, String(Date.now()))
      } catch {
        /* private mode */
      }
      if (Date.now() - last > 60_000) window.location.reload()
      throw err
    })
}

const pages = {
  Advisor: fresh(() => import('./Advisor')),
  Capture: fresh(() => import('./Capture')),
  Goals: fresh(() => import('./Goals')),
  Judge: fresh(() => import('./Judge')),
  Processing: fresh(() => import('./Processing')),
  QuickCapture: fresh(() => import('./QuickCapture')),
  Report: fresh(() => import('./Report')),
  Retailer: fresh(() => import('./Retailer')),
  Routine: fresh(() => import('./Routine')),
  Science: fresh(() => import('./Science')),
  Settings: fresh(() => import('./Settings')),
  Start: fresh(() => import('./Start')),
  UploadTest: fresh(() => import('./UploadTest')),
}

export const Advisor = lazy(() => pages.Advisor().then((m) => ({ default: m.Advisor })))
export const Capture = lazy(() => pages.Capture().then((m) => ({ default: m.Capture })))
export const Goals = lazy(() => pages.Goals().then((m) => ({ default: m.Goals })))
export const Judge = lazy(() => pages.Judge().then((m) => ({ default: m.Judge })))
export const Processing = lazy(() => pages.Processing().then((m) => ({ default: m.Processing })))
export const QuickCapture = lazy(() => pages.QuickCapture().then((m) => ({ default: m.QuickCapture })))
export const Report = lazy(() => pages.Report().then((m) => ({ default: m.Report })))
export const Retailer = lazy(() => pages.Retailer().then((m) => ({ default: m.Retailer })))
export const Routine = lazy(() => pages.Routine().then((m) => ({ default: m.Routine })))
export const Science = lazy(() => pages.Science().then((m) => ({ default: m.Science })))
export const Settings = lazy(() => pages.Settings().then((m) => ({ default: m.Settings })))
export const Start = lazy(() => pages.Start().then((m) => ({ default: m.Start })))
export const UploadTest = lazy(() => pages.UploadTest().then((m) => ({ default: m.UploadTest })))

/** Warm the pages a visitor is likely to open next, once the browser is idle. */
export function prefetchRoutes(names: (keyof typeof pages)[]) {
  const run = () => names.forEach((n) => void pages[n]().catch(() => undefined))
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 })
  else setTimeout(run, 1500)
}
