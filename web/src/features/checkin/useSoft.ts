import { useEffect, useState } from 'react'

import { scoreFile, softFlags } from './sharpness'

/** One score per File for the page's lifetime (a photo is decoded once, wherever it is listed). */
const scored = new WeakMap<File, Promise<number | null>>()

/**
 * "Looks soft · consider retaking" (advisory, never blocks): which of these photos look soft, scored in
 * the browser before upload (sharpness.ts). DNGs and photos the browser can't decode are never marked.
 */
export function useSoft(items: { key: string; file: File; contentType: string }[]): Set<string> {
  const [scores, setScores] = useState<Map<File, number | null>>(() => new Map())
  const keys = items.map((i) => i.key).join('|')
  useEffect(() => {
    let alive = true
    for (const it of items) {
      let p = scored.get(it.file)
      if (!p) {
        p = scoreFile(it.file, it.contentType)
        scored.set(it.file, p)
      }
      void p.then((s) => {
        if (alive) setScores((m) => (m.get(it.file) === s && m.has(it.file) ? m : new Map(m).set(it.file, s)))
      })
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the photos listed
  }, [keys])
  const flags = softFlags(items.map((i) => scores.get(i.file) ?? null))
  return new Set(items.filter((_, i) => flags[i]).map((i) => i.key))
}
