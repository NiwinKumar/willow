import type { CaptureMode } from './api'

export type Row = { file: File; contentType: string; progress: number; state: 'ready' | 'uploading' | 'done' | 'failed'; error?: string }

const EXT_TYPE: Record<string, string> = { dng: 'image/x-adobe-dng', jpg: 'image/jpeg', jpeg: 'image/jpeg', heic: 'image/heic', heif: 'image/heif' }

export function contentTypeFor(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TYPE[ext] ?? null
}
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Validate a picked file list against the mode. Returns rows and one-line errors (docs/research/03 section 2.4). */
export function validateFiles(files: File[], mode: CaptureMode, expected: number): { rows: Row[]; errors: string[] } {
  const rows: Row[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  for (const file of files) {
    const ct = contentTypeFor(file)
    const key = `${file.name}-${file.size}-${file.lastModified}`
    if (!ct) {
      errors.push(`${file.name}: only .dng (calibrated) or .jpg / .heic (quick selfie).`)
      continue
    }
    if (seen.has(key)) {
      errors.push(`${file.name} was chosen twice.`)
      continue
    }
    seen.add(key)
    if (file.size === 0) {
      errors.push(`${file.name} is empty on this phone. Open it once in the Files app so iCloud downloads it, then choose it again.`)
      continue
    }
    if (mode === 'calibrated_raw' && ct !== 'image/x-adobe-dng') {
      errors.push(`${file.name} is a JPEG. Calibrated mode needs the RAW .dng from Lightroom (Share, Export Original, Files).`)
      continue
    }
    if (mode === 'calibrated_raw' && file.size < 8 * 1024 * 1024) {
      errors.push(`${file.name} is unusually small for a DNG; it may be a smart preview. Export the original again.`)
      continue
    }
    if (file.size > 120 * 1024 * 1024) {
      errors.push(`${file.name} is over 120 MB. Use the 12 or 24 MP setting.`)
      continue
    }
    rows.push({ file, contentType: ct, progress: 0, state: 'ready' })
  }
  if (rows.length > expected) errors.push(`Choose ${expected} photos; the first ${expected} were kept.`)
  return { rows: rows.slice(0, expected), errors }
}

