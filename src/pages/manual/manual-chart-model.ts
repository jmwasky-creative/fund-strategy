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

export const MANUAL_CHART_POINT_RADIUS = 3.5
export const MANUAL_CHART_POINT_STROKE_WIDTH = 1.5
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
 * Resolve a chart position from its horizontal coordinate alone.
 * Only supplied real NAV points can be returned; an exact tie selects the
 * earlier trading date so the result is deterministic and stable.
 */
export const getNearestManualChartPointByX = (
  points: ManualPlotPoint[],
  x: number
): ManualPlotPoint | null => {
  if (points.length === 0 || !Number.isFinite(x)) {
    return null
  }

  return points.reduce((nearest, point) => {
    const pointDistance = Math.abs(point.x - x)
    const nearestDistance = Math.abs(nearest.x - x)
    const distanceTolerance = Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(point.x), Math.abs(nearest.x)) * 4
    const distancesAreTied = Math.abs(pointDistance - nearestDistance) <= distanceTolerance
    return pointDistance < nearestDistance - distanceTolerance
      || (distancesAreTied && point.date < nearest.date)
      ? point
      : nearest
  })
}
