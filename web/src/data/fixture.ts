import type { AnalysisResult } from './types'

/** The contract fixture (fixtures/analysis_result.sample.json), inlined so the bundle has no path outside web/. */
export const FIXTURE: AnalysisResult = {
  schema_version: '1.0',
  engine_version: '0.0.1-fixture',
  session_id: 's_20261013_demo0001',
  user_id: 'demo_user',
  site: 'face_full',
  capture_mode: 'calibrated_raw',
  frames_used: 5,
  quality: {
    passed: true,
    card_detected: true,
    card_delta_e_mean: 2.4,
    sharpness: 388.0,
    clipped_pct: 0.4,
    pose: { yaw: 1.1, pitch: -2.3, roll: 0.5 },
    per_frame: [0, 1, 2, 3, 4].map((index) => ({ index, passed: true, reasons: [] })),
    reasons: [],
  },
  metrics: [
    { id: 'tone_ita', group: 'tone_pigment', label: 'Skin tone (ITA)', value: 28.4, unit: 'deg', confidence: 'measured', within_session_sd: 0.42, mdc95: 1.16, delta: -0.3, verdict: 'within_noise', direction: 'decrease', extras: { l_star: 61.2, b_star: 17.6, ita_band: 'tan', monk_estimate: 5 } },
    { id: 'pigment_spots', group: 'tone_pigment', label: 'Dark spots', value: 3.1, unit: 'pct_area', confidence: 'measured', within_session_sd: 0.18, mdc95: 0.5, delta: -0.7, verdict: 'real_change', direction: 'decrease', extras: { count: 14, mean_contrast: 5.2 } },
    { id: 'tone_evenness', group: 'tone_pigment', label: 'Tone evenness', value: 2.9, unit: 'index', confidence: 'measured', within_session_sd: 0.11, mdc95: 0.3, delta: -0.1, verdict: 'within_noise', direction: 'decrease', extras: {} },
    { id: 'redness', group: 'redness', label: 'Redness', value: 13.4, unit: 'a_star', confidence: 'measured', within_session_sd: 0.31, mdc95: 0.86, delta: -0.8, verdict: 'within_noise', direction: 'decrease', extras: { erythema_index: 41.2 } },
    { id: 'blemishes', group: 'clarity', label: 'Blemishes', value: 6, unit: 'count', confidence: 'indicative', within_session_sd: 0.9, mdc95: null, delta: -2, verdict: 'within_noise', direction: 'decrease', extras: {} },
    { id: 'lines', group: 'lines', label: 'Lines', value: 0.21, unit: 'index', confidence: 'indicative', within_session_sd: 0.02, mdc95: 0.06, delta: null, verdict: 'no_baseline', direction: 'none', extras: {} },
    { id: 'dark_circles', group: 'eye_area', label: 'Dark circles', value: -7.8, unit: 'delta_l_star', confidence: 'measured', within_session_sd: 0.35, mdc95: 0.97, delta: 0.4, verdict: 'within_noise', direction: 'increase', extras: { delta_a_star: 2.1, delta_melanin_proxy: 3.4 } },
    { id: 'shine', group: 'oil_glow', label: 'Shine', value: 4.6, unit: 'pct_area', confidence: 'indicative', within_session_sd: 0.7, mdc95: 1.9, delta: null, verdict: 'no_baseline', direction: 'none', extras: {} },
    { id: 'glow', group: 'oil_glow', label: 'Glow', value: 0.54, unit: 'index', confidence: 'indicative', within_session_sd: 0.03, mdc95: 0.08, delta: null, verdict: 'no_baseline', direction: 'none', extras: {} },
  ],
  candidates: [
    { id: 'c_001', kind: 'blemish', bbox: [812, 1040, 46, 44], crop_uri: 'gs://DEMO/crops/c_001.jpg', context_crop_uri: 'gs://DEMO/crops/c_001_ctx.jpg', features: { a_star_contrast: 4.1, l_star_contrast: -6.3, area_px: 1320 } },
    { id: 'c_002', kind: 'spot', bbox: [1204, 920, 30, 28], crop_uri: 'gs://DEMO/crops/c_002.jpg', context_crop_uri: 'gs://DEMO/crops/c_002_ctx.jpg', features: { a_star_contrast: 0.6, l_star_contrast: -9.1, area_px: 610 } },
  ],
  overlays: [
    { metric_id: 'redness', uri: 'gs://DEMO/overlays/redness.png' },
    { metric_id: 'pigment_spots', uri: 'gs://DEMO/overlays/pigment_spots.png' },
  ],
  rois: [{ name: 'left_cheek', polygon: [[700, 1000], [900, 980], [920, 1180], [720, 1200]] }],
  image_size: { width: 3024, height: 4032 },
  timings_ms: { decode: 1800, calibrate: 600, landmarks: 220, metrics: 2100, total: 5200 },
  warnings: [],
}
