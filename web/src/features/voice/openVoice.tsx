import { createRoot, type Root } from 'react-dom/client'

import { advisorInDemo, advisorToken } from '../advisor/chatStore'
import { VoiceSession } from './session'
import { VoiceMode } from './VoiceMode'

let root: Root | null = null

/**
 * Opens Wisp's voice mode over the app. Call it from the tap itself: the session's audio is started
 * synchronously here (iOS only lets a gesture start audio). It mounts on its own root, outside the chat, so
 * nothing in voice mode can add to the chat's messages. Whose data: the signed-in person's, or the demo journey's
 * when Wisp is on it (the chat store knows which).
 */
export function openVoice() {
  if (root) return
  const demo = advisorInDemo()
  const make = () => {
    const s = new VoiceSession({ demo, token: advisorToken, lang: navigator.language || 'en' })
    s.start()
    return s
  }
  const initial = make()
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const host = document.createElement('div')
  document.body.appendChild(host)
  const r = createRoot(host)
  root = r
  r.render(
    <VoiceMode
      initial={initial}
      make={make}
      onClosed={() => {
        r.unmount()
        host.remove()
        root = null
        back?.focus()
      }}
    />,
  )
}
