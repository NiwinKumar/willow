import { useEffect, useState } from 'react'

/**
 * Whether a photo URL has loaded, read through an HTML Image (same cache as the SVG <image> that draws it).
 * An SVG <image> fires no load event when it finishes loading before React attaches it to the page (a fast
 * or cached answer), which left the frame on its shimmer; an Image always answers.
 */
export function useImageStatus(url: string | null): 'none' | 'loading' | 'ready' | 'failed' {
  const [done, setDone] = useState<{ url: string; ok: boolean } | null>(null)
  useEffect(() => {
    if (!url) return
    let live = true
    const img = new Image()
    img.onload = () => live && setDone({ url, ok: true })
    img.onerror = () => live && setDone({ url, ok: false })
    img.src = url
    return () => {
      live = false
      img.onload = null
      img.onerror = null
    }
  }, [url])
  if (!url) return 'none'
  if (done?.url !== url) return 'loading'
  return done.ok ? 'ready' : 'failed'
}

/**
 * Whether at least one of the photo URLs loads: 'checking' until every probe answered or one succeeded,
 * 'no' when none loads (or there are none). Used to keep a photo comparison closed when there is nothing to show.
 */
export function useAnyPhotoLoads(urls: string[]): 'checking' | 'yes' | 'no' {
  const key = urls.join('\n')
  const [result, setResult] = useState<{ key: string; ok: boolean } | null>(null)
  useEffect(() => {
    if (!key) return
    let live = true
    let pending = key.split('\n').length
    const probes = key.split('\n').map((u) => {
      const img = new Image()
      img.onload = () => live && setResult({ key, ok: true })
      img.onerror = () => {
        pending -= 1
        if (live && pending === 0) setResult((r) => (r?.key === key && r.ok ? r : { key, ok: false }))
      }
      img.src = u
      return img
    })
    return () => {
      live = false
      for (const p of probes) {
        p.onload = null
        p.onerror = null
      }
    }
  }, [key])
  if (!key) return 'no'
  return result?.key === key ? (result.ok ? 'yes' : 'no') : 'checking'
}
