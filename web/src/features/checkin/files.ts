/**
 * Picked files as upload rows, checked one by one with the same rules (and iPhone lessons) as
 * lib/upload.ts validateFiles, but kept per row so the design's row statuses can show each problem.
 * A row with a `problem` is never uploaded.
 */
import type { CaptureMode } from '../../data/types'
import { contentTypeFor, formatBytes } from '../../lib/upload'

export type RowState = 'ready' | 'uploading' | 'done' | 'failed' | 'paused'

export type FileRow = {
  id: string
  file: File
  contentType: string
  progress: number
  state: RowState
  error?: string
  /** Why this file is not used (wrong type, empty, chosen twice…). */
  problem?: string
  /** Object URL for a thumbnail (JPEG/HEIC; DNG cannot be shown by a browser). */
  thumb?: string
  /** Uploaded and byte-identical to a photo of an earlier check-in (or an earlier one of this check-in). */
  duplicate?: { session_id: string; index: number }
}

const MB = 1024 * 1024
let seq = 0
const newId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`

export const isDng = (f: File) => contentTypeFor(f) === 'image/x-adobe-dng'

/** Thumbnails only for what a browser can draw; HEIC draws on Safari, elsewhere the <img> falls back. */
function thumbFor(file: File, ct: string | null): string | undefined {
  if (!ct || ct === 'image/x-adobe-dng' || file.size === 0) return undefined
  try {
    return URL.createObjectURL(file)
  } catch {
    return undefined
  }
}

function problemOf(file: File, ct: string | null, mode: CaptureMode): string | undefined {
  const raw = mode === 'calibrated_raw'
  if (!ct) return raw ? 'Not a DNG · RAW mode needs the DNG originals' : 'Not supported · use JPEG, HEIC or HEIF'
  if (file.size === 0) return 'Empty on this phone · open it once in the Files app so iCloud downloads it, then choose it again'
  if (raw && ct !== 'image/x-adobe-dng') return 'A JPEG · RAW mode needs the .dng from Lightroom (Share, Export Original, Files)'
  if (!raw && ct === 'image/x-adobe-dng') return 'A RAW file · this check-in has phone photos; choose one kind'
  if (raw && file.size < 8 * MB) return 'Unusually small for a DNG · it may be a smart preview; export the original again'
  if (file.size > 120 * MB) return 'Over 120 MB · use the 12 or 24 MP setting'
  return undefined
}

/**
 * Add picked files to the list: duplicates of a file already listed (same name, size and date) and
 * anything past `expected` usable photos are marked, not dropped, so the person sees why.
 */
export function addFiles(existing: FileRow[], picked: File[], mode: CaptureMode, expected: number): FileRow[] {
  const out = [...existing]
  const key = (f: File) => `${f.name}-${f.size}-${f.lastModified}`
  const seen = new Set(existing.map((r) => key(r.file)))
  for (const file of picked) {
    const ct = contentTypeFor(file)
    const dup = seen.has(key(file))
    seen.add(key(file))
    const problem = dup ? 'Chosen twice · won’t be uploaded' : problemOf(file, ct, mode)
    out.push({ id: newId(), file, contentType: ct ?? '', progress: 0, state: 'ready', problem, thumb: problem ? undefined : thumbFor(file, ct) })
  }
  return capUsable(out, expected)
}

/** Re-check every row (after a mode switch or a removal): problems are recomputed, extras marked. */
export function recheck(rows: FileRow[], mode: CaptureMode, expected: number): FileRow[] {
  const seen = new Set<string>()
  const out = rows.map((r) => {
    const k = `${r.file.name}-${r.file.size}-${r.file.lastModified}`
    const dup = seen.has(k)
    seen.add(k)
    const ct = contentTypeFor(r.file)
    const problem = dup ? 'Chosen twice · won’t be uploaded' : problemOf(r.file, ct, mode)
    return { ...r, problem, thumb: problem ? r.thumb : (r.thumb ?? thumbFor(r.file, ct)) }
  })
  return capUsable(out, expected)
}

function capUsable(rows: FileRow[], expected: number): FileRow[] {
  let ok = 0
  return rows.map((r) => {
    if (r.problem && !r.problem.startsWith('Extra photo')) return r
    if (ok < expected) {
      ok++
      return r.problem ? { ...r, problem: undefined } : r
    }
    return { ...r, problem: `Extra photo · this check-in uses ${expected}; remove one to swap it in` }
  })
}

export const usable = (rows: FileRow[]) => rows.filter((r) => !r.problem)

/** Camera shots become rows as they are: the browser camera always writes JPEG. */
export function rowsFromShots(shots: { file: File; url: string }[]): FileRow[] {
  return shots.map((s) => ({ id: newId(), file: s.file, contentType: 'image/jpeg', progress: 0, state: 'ready', thumb: s.url }))
}

export function totalLine(rows: FileRow[]): string {
  const ok = usable(rows)
  const total = ok.reduce((a, r) => a + r.file.size, 0)
  return `${ok.length} ${ok.length === 1 ? 'file' : 'files'}, ${formatBytes(total)}${total > 60 * MB ? ' · Wi-Fi recommended' : ''}`
}

export { formatBytes }
