/**
 * Label photos only (never skin captures): shrink to a JPEG small enough to send as JSON.
 * Uses an <img> so HEIC from the iPhone camera decodes on Safari.
 */
export async function toJpegBase64(file: File, maxEdge = 1600, quality = 0.85): Promise<{ mime_type: 'image/jpeg'; data_base64: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('This photo could not be opened.'))
      el.src = url
    })
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    return { mime_type: 'image/jpeg', data_base64: dataUrl.slice(dataUrl.indexOf(',') + 1) }
  } finally {
    URL.revokeObjectURL(url)
  }
}
