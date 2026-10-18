import { createContext, useContext } from 'react'

import type { CaptureMode, Site } from '../../data/types'
import type { TrackPlace } from '../../lib/track'

/**
 * What any screen inside the app shell can ask the shell to do. The shell owns the check-in picker, the
 * check-in flow overlay, the advisor panel (one chat, one panel) and toasts.
 */
export type AdvisorSeed = { id: number; text: string; context?: string }

export type ShellApi = {
  /** Open the check-in sheet: today's check-in of every tracked place, the only way to check in. `add`
   * puts places on the person's list first (a product test adds both forearms). */
  openCheckIn: () => void
  closeCheckIn: () => void
  checkInOpen: boolean
  /** Start the check-in flow directly (the sheet's Start): /check-in?site=&mode=&places= over the current page. */
  startCheckIn: (site: Site, mode: CaptureMode, opts?: { sample?: string; places?: TrackPlace[]; upload?: boolean }) => void
  /** Open the advisor panel; with `text`, that question is asked straight away. `context` labels the chip. */
  openAdvisor: (text?: string, context?: string) => void
  closeAdvisor: () => void
  advisorOpen: boolean
  advisorSeed: AdvisorSeed | null
}

export const ShellContext = createContext<ShellApi | null>(null)

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell outside AppShell')
  return ctx
}

/** Like useShell, but null outside the shell (the website, retail) instead of throwing. */
export function useMaybeShell(): ShellApi | null {
  return useContext(ShellContext)
}
