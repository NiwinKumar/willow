/**
 * One voice conversation with Wisp (api /v1/voice/live, app/live.py): the WebSocket, the audio, and the
 * state the overlay shows. Nothing here touches the chat: no message is created and nothing is stored.
 *
 * State is derived, never set by hand: connecting until Wisp's greeting starts; speaking while audio is
 * scheduled; thinking after the person's words were heard (or a tool runs) until the answer's audio starts;
 * interrupted for a moment after the person talks over Wisp; listening otherwise. The store changes only on
 * events (a few times a second at most), so React re-renders are cheap; levels are read by the orb directly.
 */
import { DEV_UID } from '../../lib/devAuth'
import { api } from '../../lib/api'
import { createAudio, type Audio } from './audio'

export type VoiceState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'reconnecting' | 'ending' | 'ended' | 'error' | 'micDenied'
export type Caption = { role: 'you' | 'wisp'; text: string }
export type VoiceSnapshot = {
  state: VoiceState
  muted: boolean
  /** a tool is reading the person's data for the answer on its way */
  checking: boolean
  captions: Caption[]
  message: string | null
  maxSeconds: number | null
}

type ServerEvent = { type: string; role?: 'you' | 'wisp'; text?: string; message?: string; code?: string; max_seconds?: number; reason?: string; name?: string }

const INTERRUPTED_MS = 700
const THINKING_MAX_MS = 20_000

export class VoiceSession {
  private ws: WebSocket | null = null
  private audio: Audio | null = null
  private listeners = new Set<() => void>()
  private snap: VoiceSnapshot = { state: 'connecting', muted: false, checking: false, captions: [], message: null, maxSeconds: null }
  private ready = false
  private greeted = false
  private awaiting = false
  /** a tool ran for the answer on its way ("Looking it up" until its audio starts) */
  private toolPending = false
  /** the turn that asked for a tool ends before the answer's turn: that end is not the answer's */
  private toolTurn = false
  private interruptedUntil = 0
  private terminal: 'ended' | 'error' | 'micDenied' | null = null
  private reconnecting = false
  private ending = false
  private timers: number[] = []
  private thinkTimer = 0
  private closed = false
  private readonly opts: { demo: boolean; token: () => Promise<string>; lang: string }

  constructor(opts: { demo: boolean; token: () => Promise<string>; lang: string }) {
    this.opts = opts
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  snapshot = () => this.snap
  levels = () => this.audio?.levels() ?? { input: 0, output: 0 }

  private patch(p: Partial<VoiceSnapshot>) {
    this.snap = { ...this.snap, ...p }
    this.listeners.forEach((l) => l())
  }

  private derive() {
    const now = performance.now()
    let state: VoiceState
    if (this.terminal) state = this.terminal
    else if (this.reconnecting) state = 'reconnecting'
    else if (!this.ready || !this.greeted) state = 'connecting'
    else if (this.audio?.playing()) state = this.ending ? 'ending' : 'speaking'
    else if (this.ending) state = 'ending'
    else if (now < this.interruptedUntil) state = 'interrupted'
    else if (this.awaiting) state = 'thinking'
    else state = 'listening'
    if (state !== this.snap.state || this.snap.checking !== (this.toolPending && this.awaiting)) this.patch({ state, checking: this.toolPending && this.awaiting })
  }

  /** Call from the tap: the audio context is made synchronously (iOS), then the mic and the socket. */
  start() {
    const audio = createAudio()
    this.audio = audio
    audio.onIdle(() => this.derive())
    void this.connect(audio)
  }

  private async connect(audio: Audio) {
    // With the microphone already allowed, Wisp's session opens while the mic starts (Vertex takes seconds
    // to connect); otherwise the mic is asked for first, so a "no" never opens a session or counts one.
    const granted = await navigator.permissions?.query({ name: 'microphone' as PermissionName }).then((p) => p.state === 'granted', () => false)
    const mic = audio.startMic((pcm) => {
      if (this.ready && !this.snap.muted && this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm)
    })
    if (granted) void this.openSocket()
    try {
      await mic
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      this.fail(denied ? 'micDenied' : 'error', denied ? null : 'The microphone could not be started.')
      return
    }
    if (!granted) void this.openSocket()
  }

  private async openSocket() {
    if (this.closed || this.terminal) return
    let token = ''
    if (!this.opts.demo && !DEV_UID) {
      try {
        token = await this.opts.token()
      } catch {
        this.fail('error', 'Sign in again to talk to Wisp.')
        return
      }
    }
    if (this.closed || this.terminal) return
    const ws = new WebSocket(api.voiceLiveUrl(this.opts.demo))
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => ws.send(JSON.stringify({ type: 'start', lang: this.opts.lang, ...(DEV_UID ? { dev_uid: DEV_UID } : { token }) }))
    ws.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      if (typeof e.data !== 'string') {
        this.greeted = true
        this.awaiting = false
        this.toolPending = false
        this.toolTurn = false
        this.audio?.play(e.data)
        this.derive()
        return
      }
      this.onEvent(JSON.parse(e.data) as ServerEvent)
    }
    ws.onclose = () => {
      if (!this.terminal && !this.closed) this.fail(this.ending ? 'ended' : 'error', this.ending ? null : 'The connection to Wisp closed.')
    }
  }

  private onEvent(e: ServerEvent) {
    switch (e.type) {
      case 'ready':
        this.ready = true
        this.patch({ maxSeconds: e.max_seconds ?? null })
        break
      case 'caption':
        if (e.role && e.text) {
          this.addCaption(e.role, e.text)
          if (e.role === 'you') this.ask()
        }
        break
      case 'tool':
        this.toolPending = true
        this.toolTurn = true
        this.ask()
        break
      case 'interrupted':
        // the person spoke over Wisp: Gemini stopped, so does the speaker, now
        if (this.audio?.playing()) this.interruptedUntil = performance.now() + INTERRUPTED_MS
        this.audio?.flush()
        this.timers.push(window.setTimeout(() => this.derive(), INTERRUPTED_MS + 20))
        break
      case 'flush':
        this.audio?.flush()
        break
      case 'refused':
      case 'corrected':
        this.awaiting = true // the fixed line or the correction is on its way
        break
      case 'turn_complete':
        this.greeted = true
        if (this.toolTurn) this.toolTurn = false
        else if (!this.audio?.playing()) this.awaiting = false
        break
      case 'reconnecting':
        this.reconnecting = true
        this.audio?.flush()
        break
      case 'reconnected':
        this.reconnecting = false
        break
      case 'ending':
        this.ending = true
        break
      case 'ended':
        this.fail('ended', null)
        return
      case 'error':
        this.fail('error', e.message ?? 'Wisp’s voice is unavailable right now.')
        return
    }
    this.derive()
  }

  private ask() {
    this.awaiting = true
    window.clearTimeout(this.thinkTimer)
    this.thinkTimer = window.setTimeout(() => {
      this.awaiting = false
      this.derive()
    }, THINKING_MAX_MS)
  }

  private addCaption(role: 'you' | 'wisp', text: string) {
    const caps = [...this.snap.captions]
    const last = caps.at(-1)
    if (last && last.role === role) caps[caps.length - 1] = { role, text: last.text + text }
    else caps.push({ role, text: text.trimStart() })
    this.patch({ captions: caps.slice(-2) })
  }

  private fail(state: 'ended' | 'error' | 'micDenied', message: string | null) {
    this.terminal = state
    this.patch({ message })
    this.derive()
    this.teardown()
  }

  setMuted(muted: boolean) {
    this.audio?.setMicEnabled(!muted)
    if (muted && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'mute' }))
    this.patch({ muted })
  }

  private teardown() {
    this.timers.forEach((t) => window.clearTimeout(t))
    this.timers = []
    window.clearTimeout(this.thinkTimer)
    const ws = this.ws
    this.ws = null
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.onclose = null
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'end' }))
        ws.close(1000)
      } catch {
        /* already closing */
      }
    }
    // let a goodbye finish playing before the audio closes
    const audio = this.audio
    this.audio = null
    if (audio) window.setTimeout(() => audio.close(), audio.playing() && this.terminal === 'ended' ? 2500 : 0)
  }

  /** The person ended it (End, Esc, close). */
  end() {
    if (this.closed) return
    this.closed = true
    if (!this.terminal) this.terminal = 'ended'
    this.teardown()
  }
}
