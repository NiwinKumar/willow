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
