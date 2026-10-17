/** A face check-in taken as a front photo plus cheek photos (engine result.views): which photo each mark is on. */
import type { AnalysisResult, Candidate, ResultView, Session, ViewName } from '../../data/types'

/** Toggle order and words. The engine names sides as the person's own (right = their right cheek). */
export const VIEW_ORDER: ViewName[] = ['front', 'left', 'right']
export const VIEW_LABEL: Record<ViewName, string> = { front: 'Front face', left: 'Left cheek', right: 'Right cheek' }
/** Detected spots list headings. */
export const GROUP_LABEL: Record<ViewName, string> = { front: 'Full face', left: 'Left cheek', right: 'Right cheek' }

/** features.view is a number (engine VIEW_CODE): 0 front, 1 right, 2 left. Older engines: front. */
const CODE: Record<number, ViewName> = { 0: 'front', 1: 'right', 2: 'left' }

export function candidateView(c: Candidate): ViewName {
  return CODE[c.features?.view ?? 0] ?? 'front'
}

/** The views a session can show, in toggle order: the engine's views whose photo the api signed. */
export function shownViews(result: AnalysisResult | null | undefined, signed: { view: ViewName }[]): ResultView[] {
  const have = new Set(signed.map((v) => v.view))
  const views = (result?.views ?? []).filter((v) => have.has(v.view))
  return VIEW_ORDER.flatMap((name) => views.filter((v) => v.view === name))
}

/**
 * The session as one view's photo sees it: that photo's size, areas and marks, so the stage, rings, redness map and
 * area outlines draw in its own pixels. Metrics stay the session's.
 */
export function viewSession(s: Session, v: ResultView, preview: { url: string; width: number | null; height: number | null }): Session {
  const r = s.result!
  return {
    ...s,
    preview: { url: preview.url, width: preview.width ?? v.image_size.width, height: preview.height ?? v.image_size.height },
    result: {
      ...r,
      image_size: v.image_size,
      rois: v.rois,
      candidates: r.candidates.filter((c) => candidateView(c) === v.view && (c.features?.frame_index ?? v.frame_index) === v.frame_index),
    },
  }
}
