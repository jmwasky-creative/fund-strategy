import { getManualChartHitCandidates, plotManualHistory } from '../manual-chart-model'
import { ManualQuote } from '../manual-model'

const quotes: ManualQuote[] = [
  { date: '2024-01-02', val: 1.00 },
  { date: '2024-01-05', val: 1.05 },
  { date: '2024-01-09', val: 1.02 }
]

describe('manual NAV chart hit targets', () => {
  it('uses an enlarged screen-pixel target while snapping only to real NAV dates', () => {
    const points = plotManualHistory(quotes)
    const target = points[1]
    const hit = getManualChartHitCandidates(points, target.x + 11, target.y, '', 1)

    expect(hit.map(point => point.date)).toContain('2024-01-05')
    expect(hit.every(point => quotes.some(quote => quote.date === point.date))).toBe(true)
    expect(getManualChartHitCandidates(points, target.x + 13, target.y, '', 1))
      .not.toContain(target)
  })

  it('scales the touch target with the rendered SVG and returns no synthetic dates between NAV observations', () => {
    const points = plotManualHistory(quotes)
    const target = points[0]
    const scaledHit = getManualChartHitCandidates(points, target.x + 23, target.y, '', 2)

    expect(scaledHit.map(point => point.date)).toContain('2024-01-02')
    expect(getManualChartHitCandidates(points, target.x + 25, target.y, '', 2))
      .not.toContain(target)
    expect(getManualChartHitCandidates(points, (points[0].x + points[1].x) / 2, 0)).toEqual([])
  })
})
