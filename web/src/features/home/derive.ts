/**
 * Home's read of the person's real sessions: who they are on Willow today (new, baseline without a normal
 * range, back after a gap, active), what today's check-in is doing, and the sentences built from verdicts.
 * Pure functions over api data; every number and name comes from a session or a routine entry.
 */
import type { Metric, MetricId, RoutineEntry, Session, Site } from '../../data/types'
import { baselineFor, isUnmeasured } from '../../data/live'
import { localDay } from '../../lib/api'
import { parseDate } from '../../lib/format'
import { METRIC_META, orderedGroups } from '../../lib/metrics'
import { verdictKind, type VerdictKind } from '../../lib/verdict'

/** Back after this many days without a face check-in (no cadence is stored, so Home uses one fixed rule). */
export const GAP_DAYS = 14
/** An upload or analysis this old has stopped (the tab closed mid-upload, or the server restarted). */
const STALL_MS = 30 * 60_000
/** A baseline needs this many usable photos for a normal range (api baselines.NOISE_BAND_FRAMES). */
export const BAND_FRAMES = 3

export const dayOf = (iso: string) => localDay(parseDate(iso))
export const today = () => localDay()

export const inFlight = (s: Session) => s.status === 'uploading' || s.status === 'processing'
export const stalled = (s: Session) => inFlight(s) && Date.now() - Date.parse(s.created_at) > STALL_MS
/** Analysed, measured, and its photos passed the quality check: its numbers can be read. */
export const usable = (s: Session) => s.status === 'done' && !isUnmeasured(s) && Boolean(s.result?.quality.passed)

export function latest<T>(xs: T[], ok: (x: T) => boolean = () => true): T | null {
  for (let i = xs.length - 1; i >= 0; i--) if (ok(xs[i])) return xs[i]
  return null
}

/** Whole calendar days from a's local day to b's (or today). */
export function daysSince(iso: string, to: Date = new Date()): number {
  const a = parseDate(dayOf(iso))
  const b = parseDate(localDay(to))
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export type PersonKind = 'new' | 'noBand' | 'gap' | 'active'
export type TodayKind = 'none' | 'measuring' | 'stalled' | 'failed' | 'rejected' | 'unmeasured' | 'done'

export type HomeRead = {
  face: Session[]
  /** Latest face session whose numbers can be read (the one What changed and the hero speak about). */
  lead: Session | null
  /** The face baseline the lead session is compared with (or the latest face baseline). */
  baseline: Session | null
  baselineFrames: number | null
  hasBand: boolean
  person: PersonKind
  /** Today's session Home leads with (face first), and what it is doing. */
  todaySession: Session | null
  todayKind: TodayKind
  /** Latest face session of any status (gap rule, "last check-in"). */
  lastFace: Session | null
}

export function readHome(all: Session[], face: Session[]): HomeRead {
  const lead = latest(face, usable)
  const baseline = lead ? baselineFor(lead, face) : latest(face, (s) => s.is_baseline)
  const baselineFrames = baseline ? (baseline.baseline_ref?.frames ?? baseline.result?.frames_used ?? null) : null
  const hasBand = baseline ? (baseline.baseline_ref?.has_noise_band ?? (baselineFrames ?? 0) >= BAND_FRAMES) : false
  const lastFace = latest(face)

  const t = today()
  const todays = all.filter((s) => dayOf(s.created_at) === t)
  // A running check-in leads, whatever the site; otherwise today's face check-in, otherwise any.
  const running = latest(todays, (s) => inFlight(s) && !stalled(s))
  const todaySession = running ?? latest(todays, (s) => s.site === 'face_full') ?? latest(todays)
  const todayKind: TodayKind = !todaySession
    ? 'none'
    : inFlight(todaySession)
      ? stalled(todaySession)
        ? 'stalled'
        : 'measuring'
      : todaySession.status === 'failed'
        ? 'failed'
        : isUnmeasured(todaySession)
          ? 'unmeasured'
          : todaySession.result && !todaySession.result.quality.passed
            ? 'rejected'
            : 'done'

  const person: PersonKind = !baseline ? 'new' : !hasBand ? 'noBand' : lastFace && daysSince(lastFace.created_at) >= GAP_DAYS ? 'gap' : 'active'
  return { face, lead, baseline, baselineFrames, hasBand, person, todaySession, todayKind, lastFace }
}

/** Metrics in goal order (groups the person chose first), keeping the engine's order inside a group. */
export function byGoals(metrics: Metric[], goals: string[]): Metric[] {
  const order = orderedGroups(goals)
  // Skin tone is descriptive only: it never leads its group.
  const rank = (m: Metric, i: number) => (m.id === 'tone_ita' ? 1000 + i : i)
  return metrics
    .map((m, i) => ({ m, i: rank(m, i) }))
    .sort((a, b) => order.indexOf(a.m.group) - order.indexOf(b.m.group) || a.i - b.i)
    .map((x) => x.m)
}

export type VerdictSplit = { changed: Metric[]; normal: Metric[]; kinds: Map<MetricId, VerdictKind> }

export function splitVerdicts(s: Session, goals: string[]): VerdictSplit {
  const kinds = new Map<MetricId, VerdictKind>()
  const metrics = byGoals(s.result?.metrics ?? [], goals)
  for (const m of metrics) kinds.set(m.id, verdictKind(m, s))
  return { changed: metrics.filter((m) => kinds.get(m.id) === 'changed'), normal: metrics.filter((m) => kinds.get(m.id) === 'normal'), kinds }
}

/** "Dark spots", "dark spots and redness", "dark spots, redness and tone evenness" (first word capitalised by callers). */
export function listOf(metrics: Pick<Metric, 'id'>[], max = 3): string {
  const names = metrics.map((m) => lowerFirst(METRIC_META[m.id].label))
  const shown = names.length > max ? [...names.slice(0, max - 1), `${names.length - max + 1} more`] : names
  return shown.length <= 1 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

/** "Skin tone (ITA°)" -> "skin tone (ITA°)": only the first letter, so units keep their case. */
export const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** How many measured check-ins in a row (newest first, same capture mode) this metric changed the same way. */
export function runOf(metricId: MetricId, face: Session[], from: Session): number {
  const same = face.filter((s) => usable(s) && s.capture_mode === from.capture_mode && s.created_at <= from.created_at)
  const dir = from.result?.metrics.find((m) => m.id === metricId)?.direction
  let n = 0
  for (let i = same.length - 1; i >= 0; i--) {
    const m = same[i].result?.metrics.find((x) => x.id === metricId)
    if (!m || m.verdict !== 'real_change' || m.direction !== dir) break
    n++
  }
  return n
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
export const countWord = (n: number) => WORDS[n] ?? String(n)

/** One verdict sentence for a measured session: what changed, and what stayed within the normal range. */
export function verdictSentence(s: Session, goals: string[]): string | null {
  const { changed, normal, kinds } = splitVerdicts(s, goals)
  const compared = [...kinds.values()].filter((k) => k === 'changed' || k === 'normal').length
  if (compared === 0) return null
  if (changed.length === 0) return compared === kinds.size ? 'Everything measured stayed within your normal range.' : `${cap(listOf(normal))} stayed within your normal range.`
  const head = `${cap(listOf(changed))} changed beyond your normal range`
  if (normal.length === 0) return `${head}.`
  return changed.length + normal.length === kinds.size ? `${head}; everything else stayed within it.` : `${head}; ${listOf(normal)} stayed within it.`
}

/** Short product label for an orb: the key active named in the product, else the name up to its strength. */
export function shortName(e: Pick<RoutineEntry, 'custom_name' | 'brand' | 'key_actives' | 'category'>): string {
  let name = e.custom_name.trim()
  if (e.brand && name.toLowerCase().startsWith(e.brand.toLowerCase())) name = name.slice(e.brand.length).trim()
  const lower = name.toLowerCase()
  const active = e.key_actives.find((a) => a.name && lower.includes(a.name.toLowerCase()))
  if (active) return cap(active.name.split(/\s+/).slice(0, 2).join(' '))
  const words: string[] = []
  for (const w of name.split(/\s+/)) {
    if (/[\d%+]/.test(w)) break
    words.push(w)
  }
  const out = (words.length ? words : name.split(/\s+/)).slice(-2).join(' ')
  return out || e.category || 'Product'
}

/** Orb colours by category (the design's palette: cleanser sky, serum leaf, moisturiser pink, treatment ember-free coral, acids violet). */
const ORB: Record<string, [string, string, string]> = {
  clean: ['#9CD3FF', '#3D7BFF', '#1A3E99'],
  niac: ['#B8E986', '#4FB866', '#1F6B3A'],
  moist: ['#FFC2DF', '#F25FA8', '#8E2560'],
  ret: ['#FFB27A', '#FF6B4A', '#9A3218'],
  gly: ['#D8B8FF', '#7A5CFF', '#3B2A99'],
}
const CATEGORY_ORB: Record<string, keyof typeof ORB> = {
  cleanser: 'clean',
  serum: 'niac',
  moisturizer: 'moist',
  eye_care: 'moist',
  treatment: 'ret',
  sunscreen: 'ret',
  toner: 'gly',
  exfoliant: 'gly',
  mask: 'gly',
}
export function orbColours(e: Pick<RoutineEntry, 'category' | 'id' | 'key_actives'>): [string, string, string] {
  // The active decides first (a retinoid serum reads as a retinoid), then the category.
  const actives = e.key_actives.map((a) => a.name.toLowerCase()).join(' ')
  const byActive: keyof typeof ORB | null = /retin|adapalene|tretinoin/.test(actives) ? 'ret' : /glycolic|lactic|salicylic|mandelic|azelaic/.test(actives) ? 'gly' : /niacinamide/.test(actives) ? 'niac' : null
  const k = byActive ?? CATEGORY_ORB[e.category]
  if (k) return ORB[k]
  const keys = Object.keys(ORB) as (keyof typeof ORB)[]
  let h = 0
  for (const c of e.id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return ORB[keys[h % keys.length]]
}

/** Square colour beside a metric (aura only, never data; ember is reserved for Changed, tone is never a skin swatch). */
export function metricAura(id: MetricId): string {
  const hue: Record<string, [string, string]> = {
    tone_pigment: ['#FFB27A', '#F8D7B8'],
    redness: ['#F25FA8', '#F6D3E3'],
    clarity: ['#4FB866', '#D5EBC6'],
    texture_pores: ['#D8B8FF', '#EDE3FF'],
    lines: ['#7A5CFF', '#E3DCFF'],
    eye_area: ['#9CD3FF', '#E6F3FF'],
    oil_glow: ['#B8E986', '#EEF8DF'],
  }
  const [a, b] = id === 'tone_ita' ? ['#B8B5AE', '#ECEBE7'] : id === 'tone_evenness' ? ['#3D7BFF', '#CFE2F6'] : hue[METRIC_META[id].group]
  return `radial-gradient(90% 75% at 50% 100%, ${a} 0%, ${b} 70%, #F2F1EE 95%)`
}

export const SITE_SHORT: Record<Site, string> = {
  face_full: 'Face',
  cheek_macro: 'Cheek close-up',
  nose_macro: 'Nose close-up',
  forearm_treated: 'Treated forearm',
  forearm_control: 'Control forearm',
}

/** "15 Oct", "Today", "Yesterday". */
export function shortDay(iso: string): string {
  const d = daysSince(iso)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return parseDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
