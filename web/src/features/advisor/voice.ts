import { useSyncExternalStore } from 'react'

import { api } from '../../lib/api'

/**
 * Talk to Wisp (finals B2). The microphone records the question; Gemini hears it in any language (api
 * /v1/advisor/voice/hear); it is asked like a typed question, so the answer passes every check; then
 * Gemini reads that checked answer aloud (/v1/advisor/voice/speak). Nothing is spoken before it is checked.
 *
 * iOS plays audio only from a tap: `prime()` runs inside the mic tap and unlocks one audio element, which
 * then plays the answer when it arrives seconds later.
 */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
let player: HTMLAudioElement | null = null
let speakNext = false
let speaking = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function canRecord(): boolean {
  return typeof window !== 'undefined' && 'MediaRecorder' in window && Boolean(navigator.mediaDevices?.getUserMedia)
}

/** Inside a tap: unlock playback for this page (iOS) and make the next answer be read aloud. */
export function prime() {
  if (!player) player = new Audio()
  player.src = SILENT
  void player.play().catch(() => undefined)
}

export function markSpeakNext() {
  speakNext = true
}

/** Called when an answer lands (chatStore.reveal): reads it aloud if it was a spoken question. */
export function takeSpeakNext(): boolean {
  const s = speakNext
  speakNext = false
  return s
}

export async function readAloud(token: string, text: string) {
  const plain = text.replace(/\[(?:product|metric):[^\]]+\]/g, '').replace(/\*\*|==/g, '').trim()
  if (!plain) return
  const res = await api.voiceSpeak(token, plain)
  if (!player) player = new Audio()
  player.src = `data:${res.mime_type};base64,${res.audio_base64}`
  speaking = true
  emit()
  player.onended = player.onpause = () => {
    speaking = false
    emit()
  }
  await player.play().catch(() => {
    speaking = false
    emit()
  })
}

export function stopReading() {
  player?.pause()
  speaking = false
  emit()
}

export function useSpeaking(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => speaking,
    () => false,
  )
}

/** A running recording; `stop()` resolves with the audio. Stops itself after `maxMs`. */
export async function record(maxMs = 45_000): Promise<{ stop: () => Promise<{ base64: string; mime: string }>; cancel: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? ''
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }))
    }
  })
  rec.start()
  const timer = window.setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxMs)
  return {
    stop: async () => {
      window.clearTimeout(timer)
      if (rec.state !== 'inactive') rec.stop()
      const blob = await done
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return { base64: btoa(bin), mime: blob.type.split(';')[0] || 'audio/webm' }
    },
    cancel: () => {
      window.clearTimeout(timer)
      if (rec.state !== 'inactive') rec.stop()
    },
  }
}
