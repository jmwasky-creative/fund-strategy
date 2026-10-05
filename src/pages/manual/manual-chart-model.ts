import { ManualQuote } from './manual-model'

export interface ManualPlotPoint extends ManualQuote {
  x: number
  y: number
}

export const MANUAL_CHART_LAYOUT = {
  width: 960,
  height: 320,
  plotLeft: 58,
  plotRight: 906,
  plotTop: 34,
  plotBottom: 258
}

// The visible marker radius is 3.5 viewBox units, plus its 1.5-unit stroke.
// A 5-unit hit radius intentionally detects overlapping neighboring targets.
export const MANUAL_CHART_HIT_RADIUS = 5

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
  y: number
): ManualPlotPoint[] => {
  const maxDistanceSquared = MANUAL_CHART_HIT_RADIUS * MANUAL_CHART_HIT_RADIUS

  return points
    .map((point, index) => ({
      point,
      index,
      distanceSquared: (point.x - x) * (point.x - x) + (point.y - y) * (point.y - y)
    }))
    .filter(candidate => candidate.distanceSquared <= maxDistanceSquared)
    .sort((left, right) => left.distanceSquared - right.distanceSquared || left.index - right.index)
    .map(candidate => candidate.point)
}
