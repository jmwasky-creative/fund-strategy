import { ManualQuote } from './manual-model'

export interface ManualPlotPoint extends ManualQuote {
  x: number
  y: number
}

export const MANUAL_CHART_LAYOUT = {
  width: 960,
  height: 360,
  plotLeft: 58,
  plotRight: 906,
  plotTop: 34,
  plotBottom: 292
}

// Keep real NAV hit targets comfortably clickable at any rendered SVG scale.
// Candidate radii also include visible vector-effect strokes and selected rings.
export const MANUAL_CHART_HIT_RADIUS_SCREEN_PIXELS = 12
export const MANUAL_CHART_POINT_RADIUS = 3.5
export const MANUAL_CHART_POINT_STROKE_WIDTH = 1.5
export const MANUAL_CHART_FOCUSED_POINT_STROKE_WIDTH = 2.5
export const MANUAL_CHART_SELECTED_POINT_RADIUS = 5
export const MANUAL_CHART_SELECTED_RING_RADIUS = 9
export const MANUAL_CHART_SELECTED_RING_STROKE_WIDTH = 2

export const plotManualHistory = (quotes: ManualQuote[]): ManualPlotPoint[] => {
  if (quotes.length === 0) {
    return []
  }
  const values = quotes.map(item => item.val)
  const min = Math.min.apply(null, values)
  const max = Math.max.apply(null, values)
  const spread = max - min
  const usableSpread = spread === 0 ? Math.max(Math.abs(max) * 0.02, 0.0001) : spread
  const { plotLeft, plotRight, plotTop, plotBottom } = MANUAL_CHART_LAYOUT

  return quotes.map((quote, index) => ({
    ...quote,
    x: quotes.length === 1
      ? (plotLeft + plotRight) / 2
      : plotLeft + (plotRight - plotLeft) * index / (quotes.length - 1),
    y: spread === 0
      ? (plotTop + plotBottom) / 2
      : plotBottom - (quote.val - min) / usableSpread * (plotBottom - plotTop)
  }))
}

/**
 * Return every visibly plausible point under a chart click, nearest first.
 * Callers must ask the user to choose when multiple dates overlap; they must
 * not infer intent from SVG paint order or silently pick a neighboring date.
 */
export const getManualChartHitCandidates = (
  points: ManualPlotPoint[],
  x: number,
  y: number,
  selectedDate: string = '',
  viewBoxUnitsPerScreenPixel: number = 1
): ManualPlotPoint[] => {
  const safeViewBoxUnitsPerScreenPixel = Number.isFinite(viewBoxUnitsPerScreenPixel) && viewBoxUnitsPerScreenPixel > 0
    ? viewBoxUnitsPerScreenPixel
    : 1

  return points
    .map((point, index) => ({
      point,
      index,
      distanceSquared: (point.x - x) * (point.x - x) + (point.y - y) * (point.y - y),
      hitRadius: Math.max(
        MANUAL_CHART_HIT_RADIUS_SCREEN_PIXELS * safeViewBoxUnitsPerScreenPixel,
        MANUAL_CHART_POINT_RADIUS + MANUAL_CHART_FOCUSED_POINT_STROKE_WIDTH / 2 * safeViewBoxUnitsPerScreenPixel,
        point.date === selectedDate
          ? Math.max(
            MANUAL_CHART_SELECTED_POINT_RADIUS + MANUAL_CHART_FOCUSED_POINT_STROKE_WIDTH / 2 * safeViewBoxUnitsPerScreenPixel,
            MANUAL_CHART_SELECTED_RING_RADIUS + MANUAL_CHART_SELECTED_RING_STROKE_WIDTH / 2 * safeViewBoxUnitsPerScreenPixel
          )
          : 0
      )
    }))
    .filter(candidate => candidate.distanceSquared <= candidate.hitRadius * candidate.hitRadius)
    .sort((left, right) => left.distanceSquared - right.distanceSquared || left.index - right.index)
    .map(candidate => candidate.point)
}
