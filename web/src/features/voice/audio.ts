/**
 * Audio for Wisp's voice mode: the microphone as 16 kHz 16-bit PCM frames (an AudioWorklet, off the main
 * thread), and Wisp's 24 kHz PCM played back gaplessly with a small jitter buffer. `flush()` stops playback
 * at once (barge-in, or a guard cutting a turn). Input and output levels feed the orb (no React re-render).
 *
 * The AudioContext must be made inside the tap (iOS plays audio only from a gesture): `createAudio()` is
 * called synchronously from the click handler.
 */

const FRAME = 640 // 40 ms at 16 kHz
const JITTER_S = 0.12 // first chunk after silence waits this long, so later chunks arrive in time

// The capture worklet: a one-pole low-pass (about 7 kHz) then decimation to 16 kHz, posted in 40 ms frames.
const WORKLET = `
class WillowCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.alpha = 1 - Math.exp(-2 * Math.PI * 7000 / sampleRate)
    this.y = 0
    this.pos = 0
    this.prev = 0
    this.buf = new Int16Array(${FRAME})
    this.n = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    const f = new Float32Array(ch.length)
    for (let i = 0; i < ch.length; i++) { this.y += this.alpha * (ch[i] - this.y); f[i] = this.y }
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos)
      const a = i < 0 ? this.prev : f[i]
      const b = i + 1 < f.length ? f[i + 1] : a
      const s = a + (b - a) * (this.pos - i)
      this.buf[this.n++] = Math.max(-1, Math.min(1, s)) * 0x7fff
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.buffer.slice(0))
        this.n = 0
      }
      this.pos += this.ratio
    }
    this.pos -= ch.length
    this.prev = f[f.length - 1]
    return true
  }
}
registerProcessor('willow-capture', WillowCapture)
`

export type Audio = {
  ctx: AudioContext
  /** Starts the microphone; frames go to `onFrame`. Throws the getUserMedia error (NotAllowedError...). */
  startMic: (onFrame: (pcm: ArrayBuffer) => void) => Promise<void>
  setMicEnabled: (on: boolean) => void
  play: (pcm: ArrayBuffer) => void
  flush: () => void
  playing: () => boolean
  /** Fires when the last scheduled chunk has played. */
  onIdle: (fn: () => void) => void
  /** RMS of the last few ms, 0..1: the person's voice, Wisp's voice. */
  levels: () => { input: number; output: number }
  close: () => void
}

function rms(an: AnalyserNode | null, buf: Float32Array<ArrayBuffer>): number {
  if (!an) return 0
  an.getFloatTimeDomainData(buf)
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
  return Math.sqrt(s / buf.length)
}

export function createAudio(): Audio {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx({ latencyHint: 'interactive' })
  void ctx.resume()
  const outAnalyser = ctx.createAnalyser()
  outAnalyser.fftSize = 512
  outAnalyser.connect(ctx.destination)
  let gain = ctx.createGain()
  gain.connect(outAnalyser)
  let inAnalyser: AnalyserNode | null = null
  let stream: MediaStream | null = null
  let node: AudioWorkletNode | null = null
  let next = 0
  const sources = new Set<AudioBufferSourceNode>()
  let idle: () => void = () => undefined
  const scratch = new Float32Array(512)

  return {
    ctx,
    async startMic(onFrame) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      const src = ctx.createMediaStreamSource(stream)
      node = new AudioWorkletNode(ctx, 'willow-capture')
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onFrame(e.data)
      inAnalyser = ctx.createAnalyser()
      inAnalyser.fftSize = 512
      src.connect(inAnalyser)
      src.connect(node)
      // a worklet only runs while connected to the graph: through a silent gain, never heard
      const mute = ctx.createGain()
      mute.gain.value = 0
      node.connect(mute).connect(ctx.destination)
    },
    setMicEnabled(on) {
      stream?.getAudioTracks().forEach((t) => (t.enabled = on))
    },
    play(pcm) {
      const n = pcm.byteLength >> 1
      if (!n) return
      const i16 = new Int16Array(pcm, 0, n)
      const f = new Float32Array(n)
      for (let i = 0; i < n; i++) f[i] = i16[i] / 32768
      const buf = ctx.createBuffer(1, n, 24000)
      buf.copyToChannel(f, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gain)
      const now = ctx.currentTime
      if (next < now + 0.02) next = now + (sources.size ? 0.02 : JITTER_S)
      src.start(next)
      next += buf.duration
      sources.add(src)
      src.onended = () => {
        sources.delete(src)
        if (!sources.size) idle()
      }
    },
    flush() {
      // a 30 ms fade instead of a click; new audio goes to a fresh gain at full volume
      const old = gain
      const now = ctx.currentTime
      old.gain.setTargetAtTime(0, now, 0.01)
      sources.forEach((s) => {
        s.onended = null
        try {
          s.stop(now + 0.05)
        } catch {
          /* already stopped */
        }
      })
      sources.clear()
      next = 0
      window.setTimeout(() => old.disconnect(), 120)
      gain = ctx.createGain()
      gain.connect(outAnalyser)
      idle()
    },
    playing: () => sources.size > 0,
    onIdle(fn) {
      idle = fn
    },
    levels: () => ({ input: rms(inAnalyser, scratch), output: rms(outAnalyser, scratch) }),
    close() {
      sources.forEach((s) => {
        try {
          s.stop()
        } catch {
          /* already stopped */
        }
      })
      sources.clear()
      node?.port.close()
      stream?.getTracks().forEach((t) => t.stop())
      void ctx.close().catch(() => undefined)
    },
  }
}
