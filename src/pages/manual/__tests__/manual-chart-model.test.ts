import { getNearestManualChartPointByX, MANUAL_CHART_LAYOUT, plotManualHistory } from '../manual-chart-model'
import { createManualAsOfSnapshot } from '../manual-asof-model'
import { ManualQuote } from '../manual-model'

const quotes: ManualQuote[] = [
  { date: '2024-01-05', val: 1.00 },
  { date: '2024-01-09', val: 1.05 },
  { date: '2024-01-12', val: 1.02 }
]

describe('manual NAV chart X-axis selection', () => {
  it('returns the same nearest real date for the same X regardless of pointer Y', () => {
    const points = plotManualHistory(quotes)
    const target = points[1]

    expect(getNearestManualChartPointByX(points, target.x)).toMatchObject({
      date: '2024-01-09',
      val: 1.05
    })
    // The selector accepts X only; a far-off-curve pointer Y cannot change the result.
    expect(getNearestManualChartPointByX(points, target.x + 2)).toMatchObject({
      date: '2024-01-09',
      val: 1.05
    })
  })

  it('snaps near the time position even when the cursor is nowhere near the plotted NAV line', () => {
    const points = plotManualHistory(quotes)
    const target = points[1]

    expect(getNearestManualChartPointByX(points, target.x + 8)).toMatchObject({
      date: target.date,
      val: target.val
    })
  })

  it('selects a real neighboring trading day between samples, never an interpolated or weekend date', () => {
    const points = plotManualHistory(quotes)
    const between = (points[0].x + points[1].x) / 2 + 1
    const selected = getNearestManualChartPointByX(points, between)

    expect(selected).toMatchObject({ date: '2024-01-09', val: 1.05 })
    expect(quotes.some(quote => quote.date === selected!.date)).toBe(true)
    expect(selected!.date).not.toBe('2024-01-06')
    expect(selected!.date).not.toBe('2024-01-07')
  })

  it('uses the earlier trading date for an exact distance tie, regardless of input order', () => {
    const points = plotManualHistory(quotes)
    const midpoint = (points[0].x + points[1].x) / 2
    const denseAdjacentPoints = [
      { date: '2025-11-10', val: 1.121, x: 100.1, y: 140.25 },
      { date: '2025-11-11', val: 1.121, x: 103.63333333333332, y: 140.25 }
    ]
    const denseMidpoint = (denseAdjacentPoints[0].x + denseAdjacentPoints[1].x) / 2

    expect(getNearestManualChartPointByX(points, midpoint)!.date).toBe('2024-01-05')
    expect(getNearestManualChartPointByX(points.slice().reverse(), midpoint)!.date).toBe('2024-01-05')
    expect(getNearestManualChartPointByX(denseAdjacentPoints, denseMidpoint)!.date).toBe('2025-11-10')
    expect(getNearestManualChartPointByX(denseAdjacentPoints.slice().reverse(), denseMidpoint)!.date).toBe('2025-11-10')
  })

  it('only considers NAV records revealed by the current as-of snapshot', () => {
    const snapshot = createManualAsOfSnapshot(quotes, [], {
      fundCode: '260108',
      startDate: '2024-01-05',
      endDate: '2024-01-12'
    }, '2024-01-10')
    const visiblePoints = plotManualHistory(snapshot.quotes)
    const fullHistoryPoints = plotManualHistory(quotes)

    expect(snapshot.quotes.map(quote => quote.date)).toEqual(['2024-01-05', '2024-01-09'])
    expect(getNearestManualChartPointByX(visiblePoints, MANUAL_CHART_LAYOUT.plotRight)!.date).toBe('2024-01-09')
    expect(getNearestManualChartPointByX(fullHistoryPoints, MANUAL_CHART_LAYOUT.plotRight)!.date).toBe('2024-01-12')
  })

  it('returns no candidate for an empty point set or non-finite X coordinate', () => {
    const points = plotManualHistory(quotes)

    expect(getNearestManualChartPointByX([], 10)).toBeNull()
    expect(getNearestManualChartPointByX(points, NaN)).toBeNull()
  })
})
