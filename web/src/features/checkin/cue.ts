/**
 * Sound and voice for the back camera: the person holds the phone to their cheek and can't see the screen,
 * so a short tone marks each photo and a calm voice says what to do. Browsers only play sound after a tap:
 * `unlockCues` runs inside one (the "Start camera" button). Off when the person mutes it (kept on this device).
 */
let ctx: AudioContext | null = null
const KEY = 'willow.voice'

export function voiceOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}
export function setVoice(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* blocked storage: this page load only */
  }
  if (!on) window.speechSynthesis?.cancel()
}

/** Call inside a tap: lets later tones and speech play on iOS. */
export function unlockCues() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AC) {
      ctx ??= new AC()
      void ctx.resume()
    }
    // iOS speaks only after a first utterance started by a tap.
    const s = window.speechSynthesis
    if (s && !s.speaking) s.speak(new SpeechSynthesisUtterance(''))
  } catch {
    /* no audio here: the screen still shows every step */
  }
}

/** A short soft tone (the shutter); `done` plays two, rising. */
export function tone(done = false) {
  if (!ctx || !voiceOn()) return
  const at = ctx.currentTime
  ;(done ? [660, 990] : [880]).forEach((f, i) => {
    const o = ctx!.createOscillator()
    const g = ctx!.createGain()
    o.frequency.value = f
    g.gain.setValueAtTime(0.0001, at + i * 0.14)
    g.gain.exponentialRampToValueAtTime(0.18, at + i * 0.14 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.14 + 0.16)
    o.connect(g).connect(ctx!.destination)
    o.start(at + i * 0.14)
    o.stop(at + i * 0.14 + 0.18)
  })
  navigator.vibrate?.(done ? [30, 60, 30] : 25)
}

/** Say one line, replacing whatever was being said. */
export function say(text: string) {
  const s = window.speechSynthesis
  if (!s || !voiceOn() || !text) return
  s.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 0.95
  s.speak(u)
}
