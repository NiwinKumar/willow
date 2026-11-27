/**
 * The share card (#DoesItWork): a result in words, drawn on a canvas and handed to the system share sheet.
 *
 * What it carries, on purpose: the person's verdicts in words ("Redness: improved, beyond my normal range"),
 * how many weeks they have been tracking, the Willow mark and the cosmetic note. What it never carries: a photo
 * of the face, a measured number or score, a skin-tone reading, or anything that compares people. The card
 * builders are pure (`npm test` loads them); drawing and sharing need a browser.
 */
import type { Metric, Session } from '../data/types'
import { byGoalOrder, METRIC_META } from './metrics.ts'
import { changeWay, verdictKind } from './verdict.ts'

export const HASHTAG = '#DoesItWork'
const SITE_URL = 'meetwillow.web.app'

export type ShareLine = { label: string; verdict: string; changed: boolean }
export type ShareCard = { kicker: string; title: string; lines: ShareLine[]; text: string; file: string }

const MAX_LINES = 4

/** Week 1 is the baseline's week: a check-in 35 days later is week 6. */
export function weekOf(session: Pick<Session, 'created_at'>, baseline: Pick<Session, 'created_at'> | null): number | null {
  if (!baseline) return null
  const days = Math.floor((Date.parse(session.created_at) - Date.parse(baseline.created_at)) / 86_400_000)
  return days >= 0 ? Math.floor(days / 7) + 1 : null
}

/** A verdict in the first person, with no number and no direction that could read as "better skin". */
function verdictLine(m: Metric, s: Session): ShareLine | null {
  // A metric id this web build doesn't know (a newer engine) is left off rather than named wrongly.
  const label = METRIC_META[m.id]?.label
  if (!label) return null
  const kind = verdictKind(m, s)
  if (kind === 'normal') return { label, verdict: 'Within my normal range', changed: false }
  if (kind !== 'changed') return null
  return { label, verdict: changeWay(m) === 'improved' ? 'Improved, beyond my normal range' : 'Changed beyond my normal range', changed: true }
}

/**
 * A measured check-in's card: its changes first, then what held, up to four lines. Skin tone (ITA°) is never on
 * it (a tone reading shared next to "changed" invites the lighter-is-better reading Willow never makes). Null for
 * a baseline or a check-in with nothing compared yet: there is nothing to share.
 */
export function resultShare(s: Session, baseline: Session | null, goals: string[] = []): ShareCard | null {
  if (s.is_baseline || !s.result) return null
  const byGoal = byGoalOrder(goals)
  const lines = s.result.metrics
    .filter((m) => m.id !== 'tone_ita')
    .map((m) => ({ m, line: verdictLine(m, s) }))
    .filter((x): x is { m: Metric; line: ShareLine } => x.line !== null)
    .sort((a, b) => Number(b.line.changed) - Number(a.line.changed) || byGoal(a.m.id, b.m.id))
    .map((x) => x.line)
  if (!lines.length) return null
  const week = weekOf(s, baseline)
  const changed = lines.filter((l) => l.changed).length
  return {
    kicker: week ? `WEEK ${week} · AGAINST MY OWN BASELINE` : 'AGAINST MY OWN BASELINE',
    title: changed ? 'What my photos say' : 'Holding steady',
    lines: lines.slice(0, MAX_LINES),
    text: `${week ? `Week ${week} with Willow: ` : ''}${changed ? `${lines[0].label} ${lines[0].verdict.toLowerCase()}.` : 'Everything held within my normal range.'} Measured from my own photos, against my own baseline. ${HASHTAG}`,
    file: `willow-${s.created_at.slice(0, 10)}.png`,
  }
}

/** A product test's card: the product, the day, and the verdict's words (from the product test page). */
export function testShare(name: string, day: number, verdict: string, measure: string, changed: boolean): ShareCard {
  return {
    kicker: `PRODUCT TEST · DAY ${day} · ONE ARM WITH IT, ONE WITHOUT`,
    title: `Does ${name} work on me?`,
    lines: [{ label: measure, verdict, changed }],
    text: `Day ${day} of testing ${name} on my forearm, one arm with it and one without: ${verdict.toLowerCase()}. Measured by Willow. ${HASHTAG}`,
    file: `willow-test-day-${day}.png`,
  }
}

// ---- Drawing (browser only) ----

const W = 1080
const H = 1350
const INK = '#141413'
const INK_2 = '#5E5D59'
const EMBER = '#FF6B4A'
const FONT_UI = '"Outfit", system-ui, -apple-system, sans-serif'
const FONT_SERIF = '"Instrument Serif", Georgia, serif'
const FONT_MONO = '"Geist Mono", ui-monospace, Menlo, monospace'

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > width) {
      out.push(line)
      line = word
    } else line = next
  }
  if (line) out.push(line)
  return out
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(243,241,236,0)')
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

/** The tulip-bud mark (components/willow/Logo.tsx), drawn without its blur. */
function mark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const k = size / 32
  ctx.save()
  ctx.beginPath()
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
  const bg = ctx.createRadialGradient(x + size / 2, y + size * 0.35, 0, x + size / 2, y + size * 0.35, size * 0.6)
  bg.addColorStop(0, '#FFF7F0')
  bg.addColorStop(1, '#E7E3F6')
  ctx.fillStyle = bg
  ctx.fill()
  ctx.clip()
  const bud = ctx.createRadialGradient(x + 16 * k, y + 15.5 * k, 0, x + 16 * k, y + 12 * k, 9 * k)
  bud.addColorStop(0, '#FF6B4A')
  bud.addColorStop(0.55, '#F25FA8')
  bud.addColorStop(1, '#C9A8FF')
  ctx.fillStyle = bud
  ctx.beginPath()
  ctx.ellipse(x + 16 * k, y + 12 * k, 7 * k, 8 * k, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#6FAE9C' // --willow-stem
  ctx.fillRect(x + 15.5 * k, y + 18 * k, 1.5 * k, 15 * k)
  ctx.beginPath()
  ctx.ellipse(x + 21.5 * k, y + 23.5 * k, 4.5 * k, 2.5 * k, (-35 * Math.PI) / 180, 0, Math.PI * 2)
  ctx.fillStyle = '#86C5B0' // --willow-leaf
  ctx.fill()
  ctx.restore()
}

/** Draws the card (1080×1350, the 4:5 a feed shows whole) and returns it as a PNG. */
export async function drawShareCard(card: ShareCard): Promise<Blob> {
  try {
    await Promise.all([`300 44px ${FONT_UI}`, `400 40px ${FONT_UI}`, `96px ${FONT_SERIF}`, `26px ${FONT_MONO}`].map((f) => document.fonts.load(f)))
  } catch {
    /* fonts fall back to the system ones */
  }
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')

  ctx.fillStyle = '#F3F1EC'
  ctx.fillRect(0, 0, W, H)
  blob(ctx, 930, 120, 520, 'rgba(255,178,122,.55)')
  blob(ctx, 120, 1180, 560, 'rgba(216,184,255,.5)')
  blob(ctx, 980, 1250, 380, 'rgba(242,95,168,.22)')

  const X = 96
  mark(ctx, X, 96, 64)
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  ctx.font = `300 48px ${FONT_UI}`
  ctx.fillText('willow', X + 84, 128)

  ctx.textBaseline = 'alphabetic'
  ctx.font = `26px ${FONT_MONO}`
  ctx.fillStyle = INK_2
  ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '2px'
  ctx.fillText(card.kicker, X, 300)
  ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px'

  ctx.fillStyle = INK
  ctx.font = `104px ${FONT_SERIF}`
  let y = 410
  for (const l of wrap(ctx, card.title, W - X * 2).slice(0, 3)) {
    ctx.fillText(l, X, y)
    y += 104
  }

  y += 30
  // Four rows fit above the footer under a one-line title (results); a test card has one row under up to three.
  const rowH = 134
  for (const line of card.lines) {
    ctx.fillStyle = 'rgba(255,255,255,.72)'
    roundRect(ctx, X, y, W - X * 2, rowH - 22, 40)
    ctx.fill()
    // Ember marks a real change only; a hollow ring means it held.
    ctx.beginPath()
    ctx.arc(X + 58, y + 56, 13, 0, Math.PI * 2)
    if (line.changed) {
      ctx.fillStyle = EMBER
      ctx.fill()
    } else {
      ctx.lineWidth = 3
      ctx.strokeStyle = INK_2
      ctx.stroke()
    }
    ctx.fillStyle = INK
    ctx.font = `400 40px ${FONT_UI}`
    ctx.fillText(line.label, X + 100, y + 50)
    ctx.fillStyle = INK_2
    ctx.font = `300 30px ${FONT_UI}`
    ctx.fillText(line.verdict, X + 100, y + 90)
    y += rowH
  }

  ctx.fillStyle = INK_2
  ctx.font = `300 26px ${FONT_UI}`
  let fy = H - 200
  for (const l of wrap(ctx, 'Measured by Willow from my own photos, against my own normal range. Cosmetic appearance only, not a medical assessment.', W - X * 2)) {
    ctx.fillText(l, X, fy)
    fy += 36
  }
  ctx.fillStyle = INK
  ctx.font = `400 34px ${FONT_UI}`
  ctx.fillText(HASHTAG, X, H - 84)
  ctx.textAlign = 'right'
  ctx.fillStyle = INK_2
  ctx.font = `300 30px ${FONT_UI}`
  ctx.fillText(SITE_URL, W - X, H - 84)

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the card'))), 'image/png'))
}

/** Whether this browser can hand an image to the system share sheet. */
export function canShareFiles(): boolean {
  try {
    const probe = new File([new Blob()], 'x.png', { type: 'image/png' })
    return typeof navigator.share === 'function' && Boolean(navigator.canShare?.({ files: [probe] }))
  } catch {
    return false
  }
}

/**
 * Hands the drawn card to the share sheet; without file sharing (most desktop browsers), saves the PNG instead.
 * Call it straight from a tap: browsers only open the share sheet during a user gesture, so draw the card first.
 */
export async function shareOrSave(card: ShareCard, png: Blob): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([png], card.file, { type: 'image/png' })
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [file], text: card.text })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // NotAllowedError and the like: fall through to saving the image.
    }
  }
  saveImage(card, png)
  return 'saved'
}

export function saveImage(card: ShareCard, png: Blob) {
  const url = URL.createObjectURL(png)
  const a = document.createElement('a')
  a.href = url
  a.download = card.file
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
