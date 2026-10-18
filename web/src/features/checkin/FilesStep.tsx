import { useRef, useState } from 'react'

import type { CaptureMode } from '../../data/types'
import { type FileRow, formatBytes, totalLine, usable } from './files'
import { MonoEyebrow, Notice, SerifTitle } from './parts'
import type { Upload } from './useUpload'

const STATUS: Record<FileRow['state'], { text: string; glyph: string; color: string; bar: string }> = {
  ready: { text: 'Ready to upload', glyph: '○', color: 'var(--text-secondary)', bar: 'var(--text-primary)' },
  uploading: { text: 'Uploading…', glyph: '◌', color: '#3E3C38', bar: 'var(--aura-sky)' },
  done: { text: 'Uploaded', glyph: '✓', color: 'var(--willow-700)', bar: 'var(--willow-400)' },
  failed: { text: 'Upload failed · connection dropped', glyph: '!', color: 'var(--state-avoid-fg)', bar: 'var(--aura-coral)' },
  paused: { text: 'Paused · offline', glyph: '‖', color: '#3E3C38', bar: '#C9C6C0' },
}

/**
 * Step "files" (CAP 07): pick photos (RAW: the DNG originals from Files), see each file's status, upload.
 * Until measuring starts every row can be removed or replaced (uploaded ones too: the api drops or adds
 * frames). Rows say when a photo looks soft (advisory) or is a duplicate of one uploaded before (the
 * hand-over waits: Replace, Remove, or Measure anyway). `topup`: photos added to an existing baseline.
 */
export function FilesStep({
  mode,
  n,
  first,
  upload,
  camera,
  soft,
  topup,
  dupLabel,
  onPick,
  onRemove,
  onReplace,
  onStartOver,
}: {
  mode: CaptureMode
  n: number
  first: boolean
  upload: Upload
  camera: boolean
  soft: Set<string>
  /** Topping up a baseline: when it was taken. */
  topup: { date: string } | null
  dupLabel: (d: { session_id: string; index: number }) => string
  onPick: (files: File[]) => void
  onRemove: (id: string) => void
  onReplace: (id: string, file: File) => void
  onStartOver: () => void
}) {
  const raw = mode === 'calibrated_raw'
  const { rows, busy, locked, fatal, offline, held } = upload
  const replaceInput = useRef<HTMLInputElement>(null)
  const [replacing, setReplacing] = useState<string | null>(null)
  const ok = usable(rows)
  const done = ok.filter((r) => r.state === 'done').length
  const failed = ok.filter((r) => r.state === 'failed').length
  const allUp = ok.length > 0 && done === ok.length
  const canPick = !busy
  // Quick mode also takes DNGs: a RAW set is better than phone photos and becomes a RAW check-in.
  const accept = raw ? '.dng,image/x-adobe-dng,image/dng' : '.jpg,.jpeg,image/jpeg,.heic,image/heic,.heif,image/heif,.dng,image/x-adobe-dng,image/dng'
  const dups = ok.filter((r) => r.duplicate).length

  const cta =
    allUp && held
      ? `${dups} duplicate${dups === 1 ? '' : 's'} · replace or measure anyway`
      : allUp
        ? 'All photos uploaded · measuring next'
        : failed && !busy
          ? `${failed} upload${failed === 1 ? '' : 's'} failed · retry to continue`
          : busy
            ? `Uploading ${done} of ${ok.length}…`
            : `Upload ${ok.length} photo${ok.length === 1 ? '' : 's'}`

  return (
    <div className="relative mx-auto flex max-w-[900px] animate-rise flex-col gap-4 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <MonoEyebrow>{raw ? 'RAW · DNG originals only · up to 120 MB each' : 'Quick · JPEG, HEIC or HEIF · up to 120 MB each'}</MonoEyebrow>
          <div className="mt-3">
            <SerifTitle id="ck-title" size="md">
              {allUp && held ? 'Photos you’ve uploaded before' : allUp ? 'All photos uploaded' : busy ? 'Uploading' : topup ? 'Add to your baseline' : 'Review your photos'}
            </SerifTitle>
          </div>
        </div>
        <span className="font-dot text-[52px] leading-none" aria-label={`${ok.length} of ${n} usable photos selected`}>
          {ok.length}/{n}
        </span>
      </div>

      {raw && !locked ? (
        <details className="ck-details rounded-[24px] bg-surface/70 px-[18px]">
          <summary className="flex min-h-12 cursor-pointer items-center text-[15px]">From Lightroom to Files · 3 steps</summary>
          <ol className="m-0 mb-4 flex flex-col gap-1.5 pl-5 text-[14px] leading-[1.45] text-[#3E3C38]">
            <li>In Lightroom, select all {n} photos from this session.</li>
            <li>Share, then Export Original. Not “Export to Camera Roll”: that hands over a JPEG, and the RAW is what keeps the measurement comparable.</li>
            <li>Save to Files, in a folder such as Willow. iCloud files must finish downloading before they can be chosen.</li>
          </ol>
        </details>
      ) : null}

      {canPick ? (
        <label className="relative flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[32px] border-[1.5px] border-dashed border-ink/25 bg-surface/60 p-5 text-center transition-[background] hover:bg-surface/95">
          <input
            type="file"
            multiple
            accept={accept}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              e.target.value = '' // the same file can be picked again
              if (picked.length) onPick(picked)
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
          <span aria-hidden className="grid size-[46px] place-items-center rounded-full bg-selected text-[22px] text-inverse">
            +
          </span>
          <span className="text-[19px]">{rows.length ? 'Choose more photos' : 'Choose photos'}</span>
          <span className="text-[14px] text-ink-2">{raw ? 'Pick the DNG originals you exported to Files.' : 'From your photo library or Files.'} To pick several in Files: Browse, then the … menu, then Select.</span>
        </label>
      ) : null}

      {offline ? (
        <Notice tone="ink" role="alert" className="flex flex-wrap items-center justify-between gap-2.5">
          <span>You’re offline. Finished uploads are kept; the rest will continue when you reconnect.</span>
          <button type="button" onClick={upload.retryNow} className="min-h-[42px] rounded-pill bg-white px-4 text-ink">
            Retry now
          </button>
        </Notice>
      ) : null}
      {topup && !busy && !allUp ? (
        <Notice tone="quiet" role="status">
          These photos join your baseline from {topup.date}: same light, distance and expression as then. Willow then measures your baseline again with every photo.
        </Notice>
      ) : null}
      {!busy && !allUp && ok.length > 0 && ok.length < n ? (
        <Notice tone="yellow" role="status">
          {ok.length} of {n} photos ready.{' '}
          {topup
            ? `A normal range needs ${n} more usable photo${n === 1 ? '' : 's'} in this baseline.`
            : first
              ? `A baseline needs ${n}: with ${n} photos Willow learns your normal photo-to-photo variation. With fewer than 3, changes are shown but can’t be called real yet.`
              : `This check-in works best with ${n}; fewer makes the reading noisier.`}{' '}
          Add {n - ok.length} more, or upload these.
        </Notice>
      ) : null}
      {held ? (
        <Notice tone="yellow" role="alert" className="flex flex-wrap items-center justify-between gap-2.5">
          <span>Willow has seen {dups === 1 ? 'this photo' : 'these photos'} before. The same photo twice would hide real change; replace {dups === 1 ? 'it with a new one' : 'them with new ones'}, or measure anyway.</span>
          <button type="button" onClick={upload.proceed} className="min-h-[42px] rounded-pill border border-ink/15 bg-white px-4 text-ink">
            Measure anyway
          </button>
        </Notice>
      ) : null}
      {busy ? <p className="m-0 px-1 text-[13px] text-ink-2">Keep this screen open. Uploads pause if you switch apps or lock the phone.</p> : null}

      {rows.length ? (
        <>
          <div className="flex justify-between px-1 text-[13px] text-ink-2">
            <span>{totalLine(rows)}</span>
            {locked && !busy ? <span>Remove or replace any photo until measuring starts</span> : null}
          </div>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {rows.map((r) => {
              const bad = Boolean(r.problem)
              const st = STATUS[r.state]
              const pct = bad ? 0 : Math.round(r.progress * 100)
              const dup = !bad && r.duplicate ? dupLabel(r.duplicate) : null
              const looksSoft = !bad && !dup && soft.has(r.id)
              return (
                <li key={r.id} className="flex animate-rise items-center gap-3.5 rounded-[26px] bg-surface/[.92] p-3 shadow-[0_20px_40px_-36px_rgba(0,0,0,.4)]">
                  {r.thumb ? (
                    <img src={r.thumb} alt="" className="h-[76px] w-[60px] flex-none rounded-[16px] object-cover" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                  ) : (
                    <div aria-hidden className={`grid h-[76px] w-[60px] flex-none place-items-center rounded-[16px] font-mono text-[11px] text-ink-2 ${bad ? 'ck-stripes-bad' : 'ck-stripes'}`}>
                      {r.contentType === 'image/x-adobe-dng' ? 'DNG' : ''}
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap justify-between gap-x-2.5">
                      <span className="max-w-full truncate font-mono text-[14px]">{r.file.name}</span>
                      <span className="text-[13px] text-ink-2">
                        {formatBytes(r.file.size)} · {r.contentType === 'image/x-adobe-dng' ? 'RAW' : 'JPEG/HEIC'}
                      </span>
                    </div>
                    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.file.name} upload progress`} className="h-1.5 overflow-hidden rounded-[6px] bg-[#E4E3DE]">
                      <div className="h-full rounded-[6px] transition-[width] duration-300 ease-linear" style={{ width: `${pct}%`, background: st.bar }} />
                    </div>
                    <span className="text-[13px]" style={{ color: bad || dup ? 'var(--state-avoid-fg)' : st.color }}>
                      {bad ? `! ${r.problem}` : dup ? `! ${dup}` : `${st.glyph} ${r.state === 'failed' && r.error ? r.error : st.text}`}
                    </span>
                    {looksSoft ? <span className="self-start rounded-pill bg-cta px-2.5 py-1 text-[12px] text-ink">Looks soft · consider retaking</span> : null}
                  </div>
                  <div className="flex flex-none gap-1.5">
                    {r.state === 'failed' && !busy ? (
                      <button type="button" onClick={() => void upload.run()} className="min-h-11 rounded-pill bg-selected px-3.5 text-[13px] text-inverse">
                        Retry
                      </button>
                    ) : null}
                    {(bad || dup || looksSoft) && canPick ? (
                      <button
                        type="button"
                        onClick={() => {
                          setReplacing(r.id)
                          replaceInput.current?.click()
                        }}
                        className="min-h-11 rounded-pill border border-ink/15 bg-white px-3.5 text-[13px]"
                      >
                        Replace
                      </button>
                    ) : null}
                    {!busy ? (
                      <button type="button" onClick={() => onRemove(r.id)} disabled={busy} aria-label={`Remove ${r.file.name}`} className="grid size-11 place-items-center rounded-full border border-ink/12 bg-white">
                        ✕
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <p className="m-0 rounded-[26px] bg-surface/60 p-6 text-center text-ink-2">No photos selected yet.</p>
      )}
      <input
        ref={replaceInput}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f && replacing) onReplace(replacing, f)
          setReplacing(null)
        }}
      />

      {fatal ? (
        <Notice tone="quiet" role="alert" className="flex flex-wrap items-center justify-between gap-2.5">
          <span>Upload stopped: {fatal}</span>
          <button type="button" disabled={busy} onClick={() => void upload.run()} className="min-h-11 rounded-pill bg-selected px-4 text-[13px] text-inverse">
            Try again
          </button>
        </Notice>
      ) : null}

      <button
        type="button"
        onClick={() => void upload.run()}
        disabled={busy || allUp || ok.length === 0}
        className={`min-h-[60px] rounded-[24px] text-[17px] transition-[background] duration-300 ${allUp ? 'bg-lime text-ink' : 'bg-selected text-inverse'}`}
      >
        {cta}
      </button>
      {locked && !busy && !allUp && !topup ? (
        <button type="button" onClick={onStartOver} className="min-h-11 self-center text-[14px] text-ink-2 underline underline-offset-4">
          {camera ? 'Start over with new photos' : 'Start over with different files'}
        </button>
      ) : null}
    </div>
  )
}
