import type { LabelDetail } from '../lib/spotLabels'

/** Types mirroring docs/CONTRACT.md. Keep field names identical to the JSON. */

export type Site = 'face_full' | 'cheek_macro' | 'nose_macro' | 'forearm_treated' | 'forearm_control'
export type CaptureMode = 'calibrated_raw' | 'uncalibrated'
export type MetricId =
  | 'tone_ita'
  | 'pigment_spots'
  | 'tone_evenness'
  | 'redness'
  | 'blemishes'
  | 'pores'
  | 'texture'
  | 'lines'
  | 'dark_circles'
  | 'shine'
  | 'glow'
export type MetricGroup = 'tone_pigment' | 'redness' | 'clarity' | 'texture_pores' | 'lines' | 'eye_area' | 'oil_glow'
export type Unit = 'deg' | 'pct_area' | 'index' | 'a_star' | 'count' | 'per_cm2' | 'delta_l_star'
export type Verdict = 'no_baseline' | 'within_noise' | 'real_change' | 'low_quality'
export type Confidence = 'measured' | 'indicative'
export type Direction = 'increase' | 'decrease' | 'none'
export type QualityReason =
  | 'card_not_found'
  | 'card_delta_e_high'
  | 'blurry'
  | 'overexposed'
  | 'underexposed'
  | 'pose_out_of_range'
  | 'face_not_found'
  | 'occlusion_suspected'
  | 'too_few_frames'
/** Where on the face a per-photo quality reason applies (engine, optional). */
export type QualityRegion = 'forehead' | 'left_cheek' | 'right_cheek' | 'nose' | 'chin' | 'under_eyes' | 'whole'

export type Metric = {
  id: MetricId
  group: MetricGroup
  label: string
  value: number | null
  unit: Unit
  confidence: Confidence
  within_session_sd: number | null
  mdc95: number | null
  delta: number | null
  verdict: Verdict
  direction: Direction
  extras?: Record<string, unknown>
}

export type Quality = {
  passed: boolean
  card_detected: boolean
  card_delta_e_mean?: number | null
  sharpness?: number | null
  clipped_pct?: number | null
  pose?: { yaw: number; pitch: number; roll: number } | null
  per_frame?: { index: number; passed: boolean; reasons: QualityReason[]; regions?: { reason: QualityReason; region: QualityRegion }[] }[]
  reasons: QualityReason[]
}

export type Candidate = {
  id: string
  kind: 'blemish' | 'spot'
  bbox: [number, number, number, number]
  crop_uri?: string | null
  context_crop_uri?: string | null
  features?: Record<string, number>
}

export type Roi = { name: string; polygon: [number, number][] }

export type AnalysisResult = {
  schema_version: '1.0'
  engine_version: string
  session_id: string
  user_id: string
  site: Site
  capture_mode: CaptureMode
  frames_used: number
  quality: Quality
  metrics: Metric[]
  candidates: Candidate[]
  overlays: { metric_id: MetricId; uri: string }[]
  rois?: Roi[]
  image_size?: { width: number; height: number }
  timings_ms?: Record<string, number>
  warnings?: string[]
}

export type Explanation = {
  headline: string
  items: { metric_id: MetricId; summary: string; quoted_numbers: string[] }[]
  next_steps: string[]
  disclaimer: string
}

export type Preview = { url: string; width: number; height: number }

export type Session = {
  id: string
  site: Site
  capture_mode: CaptureMode
  created_at: string
  status: 'uploading' | 'processing' | 'done' | 'failed'
  n_frames: number
  is_baseline: boolean
  result: AnalysisResult | null
  labels: Record<string, string>
  explanation: Explanation | null
  preview?: Preview | null
  note?: string
  deviation?: boolean
  /** Hours since the baseline session; used for the scrubber labels on short series. */
  hours_since_baseline?: number
  /** Live sessions only: where the explanation came from, and why a failed session failed. */
  explanation_source?: 'template' | 'gemini' | null
  /** Gemini's spot labels with confidence (AI-suggested; live sessions with engine crops only). */
  label_details?: Record<string, LabelDetail>
  error?: { code: string; message: string } | null
  /** True for sessions from the api (never for the illustrative demo journeys). */
  live?: boolean
  /** Live: false when the engine cannot measure this site yet; the photos are kept. */
  measured?: boolean | null
  /** Live: the baseline this session is compared with (same site and capture mode). */
  baseline_ref?: { session_id: string; frames: number | null; has_noise_band: boolean } | null
  /** Live: the hosted sample these photos were copied from (judge sample runs), else null. */
  sample_id?: string | null
  /** Live, while processing: the analysis stage (received, engine, explaining). */
  stage?: 'received' | 'engine' | 'explaining' | null
  /** Live detail views only: signed URL of each uploaded photo (null for DNG or a missing photo). */
  frame_urls?: (string | null)[]
  /** Live detail views only: signed tight crop per candidate id. */
  crop_urls?: Record<string, string>
}

export type SiteSeries = { site: Site; sessions: Session[] }

export type RoutineEntry = {
  id: string
  product_id: string | null
  custom_name: string
  brand: string
  category: string
  key_actives: { name: string; pct: number | null }[]
  inci: string[]
  started_at: string
  ended_at: string | null
  slots: ('am' | 'pm')[]
  concerns: string[]
  source: 'catalog' | 'label_scan' | 'manual'
  /** Days ticked as used, of the days it was in the routine in the last 2 weeks since the person started
   * ticking (GET /v1/routine only); null when they never ticked or it had no days in that window. */
  recent_use?: { days_used: number; of_days: number } | null
  /** Which days it is used (null: every day). GET/PATCH /v1/routine. */
  schedule?: RoutineSchedule | null
  created_at?: string
  /** Set on create and on every PATCH (stop, slots, schedule). */
  updated_at?: string
  /** The catalog packshot (catalog products only), joined by GET /v1/routine. */
  image_url?: string | null
  image_source?: string | null
  /** The person's own latest verdict on the product (self-reported, never a measurement). PUT /v1/routine/{id}/feel. */
  feel?: FeelAnswer | null
  /** One answer per week, oldest first (a new answer in the same week replaces it), at most 26. */
  feel_history?: FeelAnswer[]
}

export type FeelVerdict = 'working' | 'unsure' | 'not_for_me'
export type FeelTag = 'feels_nice' | 'absorbs' | 'softer' | 'looks_better' | 'heavy' | 'stings' | 'drying' | 'breakouts'
/** `week`: whole weeks from started_at to the answer day (0 = the first week); `at`: ISO datetime. */
export type FeelAnswer = { verdict: FeelVerdict; tags: FeelTag[]; week: number; at: string }

/** Every day (null or daily), every other day counted from `anchor` (a use day), or chosen weekdays (0 = Monday). */
export type RoutineSchedule = { kind: 'daily' | 'alternate' | 'days'; days?: number[] | null; anchor: string }

/** A product tried on one forearm square, the other forearm's square left untouched (GET /v1/product-tests). */
export type ProductTest = {
  id: string
  entry_id: string | null
  product_id: string | null
  name: string
  site_pair: 'forearm'
  started_at: string
  length_days: number
  ended_at: string | null
  created_at?: string
  updated_at?: string
}

/** One day's routine use ticks (GET/PUT/DELETE /v1/routine/log): entry id -> slots ticked. */
export type RoutineLogDay = { date: string; used: Record<string, ('am' | 'pm')[]> }

export type RoutineCheck = {
  conflicts: { products: string[]; issue: string; severity: 'info' | 'caution' | 'avoid_same_routine'; suggestion: string; source: 'rule' | 'model' }[]
  duplicates: { active: string; products: string[]; note: string }[]
  gaps: { need: string; why: string; suggestion: string }[]
  notes: string[]
}

export type Product = {
  product_id: string
  brand: string
  name: string
  category: string
  concerns: string[]
  key_actives: { name: string; pct: number | null }[]
  inci: string[]
  price: { amount: number; currency: string }
  size: string
  region: string[]
  stores: { store: string; url: string; region: string; price?: StorePrice | null }[]
  source_url: string
  last_verified: string
  /** The brand's own packshot, linked where it is already published (never copied). */
  image_url?: string | null
  /** The page that image appears on, for the credit line. */
  image_source?: string | null
}

/** A price read off one store's page on the day `checked` (YYYY-MM-DD); null when it was not found. Never estimated. */
export type StorePrice = { amount: number; currency: string; checked: string }
