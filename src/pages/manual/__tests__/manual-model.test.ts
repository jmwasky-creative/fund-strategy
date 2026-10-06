import {
  filterManualQuotes,
  getSignalsInvalidatedByQuery,
  hasManualQuoteDate,
  ManualSignal,
  sortManualSignals,
  validateManualSignalSequence
} from '../manual-model'
import { getManualChartHitCandidates, plotManualHistory } from '../manual-chart-model'

const createDenseWeekdayQuotes = (): { date: string, val: number }[] => {
  const dates: string[] = []
  const current = new Date(Date.UTC(2025, 0, 1))
  while (dates.length < 241) {
    const weekday = current.getUTCDay()
    if (weekday !== 0 && weekday !== 6) {
      dates.push(current.toISOString().slice(0, 10))
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates.map((date, index) => ({
    date,
    val: date === '2025-11-10' || date === '2025-11-11'
      ? 1.121
      : 1.1 + index * 0.00008 + Math.sin(index / 9) * 0.0004
  }))
}

describe('manual backtest model', () => {
  it('filters only in-range actual NAV rows and sorts dates ascending', () => {
    const quotes = filterManualQuotes({
      '2024-01-03': { date: '2024-01-03', val: 1.03 },
      '2024-01-01': { date: '2024-01-01', val: 1.01 },
      '2023-12-29': { date: '2023-12-29', val: 1.00 },
      '2024-01-02': { date: '2024-01-02', val: NaN }
    }, '2024-01-01', '2024-01-03')

    expect(quotes).toEqual([
      { date: '2024-01-01', val: 1.01 },
      { date: '2024-01-03', val: 1.03 }
    ])
  })

  it('does not silently move a chosen calendar date to a nearby NAV date', () => {
    const quotes = [
      { date: '2024-01-01', val: 1.01 },
      { date: '2024-01-03', val: 1.03 }
    ]

    expect(hasManualQuoteDate(quotes, '2024-01-02')).toBe(false)
    expect(hasManualQuoteDate(quotes, '2024-01-03')).toBe(true)
  })

  it('preserves provider split and distribution events for explicit replay treatment', () => {
    const quotes = filterManualQuotes({
      '2024-01-02': {
        date: '2024-01-02', val: 0.5, bonus: 2,
        isBonusPortion: true, unitMoney: '每份基金份额折算2份'
      },
      '2024-01-03': {
        date: '2024-01-03', val: 0.49, bonus: 0.05,
        unitMoney: '分红：每份派现金0.05元'
      }
    }, '2024-01-02', '2024-01-03')

    expect(quotes[0].corporateActions).toEqual([{
      date: '2024-01-02', kind: 'share-split', value: 2, valueUnit: 'share-multiplier', description: '每份基金份额折算2份'
    }])
    expect(quotes[1].corporateActions).toEqual([{
      date: '2024-01-03', kind: 'distribution', value: 0.05, valueUnit: 'cash-per-share', description: '分红：每份派现金0.05元'
    }])
  })

  it('keeps distributions with ambiguous units or missing descriptions explicitly uninterpreted', () => {
    const quotes = filterManualQuotes({
      '2024-01-02': { date: '2024-01-02', val: 0.99, bonus: 10, unitMoney: '每10份派现金1元' },
      '2024-01-03': { date: '2024-01-03', val: 0.98, bonus: 0.1 }
    }, '2024-01-02', '2024-01-03')

    expect(quotes[0].corporateActions![0]).toMatchObject({
      kind: 'distribution', value: null, valueUnit: 'unknown', description: '每10份派现金1元'
    })
    expect(quotes[1].corporateActions![0]).toMatchObject({
      kind: 'unclassified', value: null, valueUnit: 'unknown', description: expect.stringContaining('缺少 unitMoney')
    })
  })

  it('sorts signals by date and preserves stable insertion order on the same day', () => {
    const signals: ManualSignal[] = [
      { id: 4, date: '2024-01-03', type: 'sell' },
      { id: 2, date: '2024-01-01', type: 'buy' },
      { id: 3, date: '2024-01-01', type: 'sell' }
    ]

    expect(sortManualSignals(signals).map(item => item.id)).toEqual([2, 3, 4])
  })

  it('identifies only signals outside the new range or without an actual NAV date', () => {
    const signals: ManualSignal[] = [
      { id: 1, date: '2024-01-01', type: 'buy' },
      { id: 2, date: '2024-01-03', type: 'sell' },
      { id: 3, date: '2024-01-04', type: 'buy' }
    ]
    const invalid = getSignalsInvalidatedByQuery(signals, '000001', {
      fundCode: '000001', startDate: '2024-01-01', endDate: '2024-01-04'
    }, [
      { date: '2024-01-01', val: 1.01 },
      { date: '2024-01-04', val: 1.04 }
    ])

    expect(invalid.map(item => item.id)).toEqual([2])
  })

  it('invalidates all signals when switching funds, including same-date signals', () => {
    const signals: ManualSignal[] = [
      { id: 1, date: '2024-01-01', type: 'buy' },
      { id: 2, date: '2024-01-03', type: 'sell' }
    ]
    const invalid = getSignalsInvalidatedByQuery(signals, '000001', {
      fundCode: '000002', startDate: '2024-01-01', endDate: '2024-01-05'
    }, [
      { date: '2024-01-01', val: 1.01 },
      { date: '2024-01-03', val: 1.03 }
    ])

    expect(invalid).toEqual(signals)
  })

  it('detects both dates inside the overlapping hit area on a dense 241-point chart', () => {
    const quotes = createDenseWeekdayQuotes()
    const points = plotManualHistory(quotes)
    const november10 = points.filter(point => point.date === '2025-11-10')[0]
    const november11 = points.filter(point => point.date === '2025-11-11')[0]

    expect(quotes).toHaveLength(241)
    expect(quotes[quotes.findIndex(quote => quote.date === '2025-11-10') + 1].date).toBe('2025-11-11')
    expect(november10.val).toBe(november11.val)
    expect(november10.y).toBe(november11.y)
    expect(november11.x - november10.x).toBeCloseTo(3.533, 3)

    const candidates = getManualChartHitCandidates(points, november10.x, november10.y)
    expect(candidates.map(point => point.date)).toEqual(expect.arrayContaining(['2025-11-10', '2025-11-11']))
  })

  it('keeps the selected marker and adjacent equal-NAV date as candidates inside its visible stroke edge', () => {
    const points = plotManualHistory(createDenseWeekdayQuotes())
    const november10 = points.filter(point => point.date === '2025-11-10')[0]
    const november11 = points.filter(point => point.date === '2025-11-11')[0]
    const edgeClickX = november10.x + 5.2

    expect(november11.x - november10.x).toBeCloseTo(3.533, 3)
    expect(edgeClickX - november10.x).toBeCloseTo(5.2, 6)
    expect(getManualChartHitCandidates(points, edgeClickX, november10.y, '2025-11-10', 1)
      .map(point => point.date)).toEqual(expect.arrayContaining(['2025-11-10', '2025-11-11']))
  })
})

describe('manual signal sequence validation', () => {
  it('accepts an empty sequence and a complete single long trade', () => {
    expect(validateManualSignalSequence([])).toEqual({
      isValid: true,
      issues: [],
      standardizedSequence: { trades: [], endingPositionStatus: 'flat', endDate: null }
    })
    expect(validateManualSignalSequence([
      { id: 1, date: '2024-01-02', type: 'buy' },
      { id: 2, date: '2024-01-04', type: 'sell' }
    ])).toEqual({
      isValid: true,
      issues: [],
      standardizedSequence: {
        trades: [{
          entrySignal: { id: 1, date: '2024-01-02', type: 'buy' },
          exitSignal: { id: 2, date: '2024-01-04', type: 'sell' },
          status: 'closed'
        }],
        endingPositionStatus: 'flat',
        endDate: null
      }
    })
  })

  it('marks a sell while flat and identifies the offending point', () => {
    const result = validateManualSignalSequence([
      { id: 7, date: '2024-01-02', type: 'sell' }
    ])

    expect(result.isValid).toBe(false)
    expect(result.issues).toEqual([expect.objectContaining({
      signalId: 7,
      code: 'sell-while-flat'
    })])
    expect(result.issues[0].message).toContain('为空仓')
    expect(result.standardizedSequence).toBeNull()
  })

  it('marks a second buy while a long position is open', () => {
    const result = validateManualSignalSequence([
      { id: 1, date: '2024-01-02', type: 'buy' },
      { id: 2, date: '2024-01-03', type: 'buy' },
      { id: 3, date: '2024-01-04', type: 'sell' }
    ])

    expect(result.issues).toEqual([expect.objectContaining({
      signalId: 2,
      code: 'buy-while-holding'
    })])
    expect(result.standardizedSequence).toBeNull()
  })

  it('marks a consecutive sell after a completed trade', () => {
    const result = validateManualSignalSequence([
      { id: 1, date: '2024-01-02', type: 'buy' },
      { id: 2, date: '2024-01-03', type: 'sell' },
      { id: 3, date: '2024-01-04', type: 'sell' }
    ])

    expect(result.issues).toEqual([expect.objectContaining({
      signalId: 3,
      code: 'sell-while-flat'
    })])
    expect(result.standardizedSequence).toBeNull()
  })

  it('rejects same-day opposing signals without guessing their order', () => {
    const result = validateManualSignalSequence([
      { id: 1, date: '2024-01-02', type: 'buy' },
      { id: 2, date: '2024-01-03', type: 'sell' },
      { id: 3, date: '2024-01-03', type: 'buy' },
      { id: 4, date: '2024-01-04', type: 'sell' }
    ])

    expect(result.isValid).toBe(false)
    expect(result.issues.map(issue => [issue.signalId, issue.code])).toEqual([
      [2, 'same-day-opposite-signals'],
      [3, 'same-day-opposite-signals'],
      [4, 'state-unknown-after-ambiguous-day']
    ])
    expect(result.issues[0].message).toContain('系统不会猜测先后顺序')
    expect(result.issues[0].message).toContain('调整信号日期或移除')
    expect(result.standardizedSequence).toBeNull()
  })

  it('returns an open position as valid and explicit without claiming engine valuation', () => {
    const result = validateManualSignalSequence([
      { id: 11, date: '2024-01-02', type: 'buy' }
    ], '2024-01-31')

    expect(result.isValid).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.standardizedSequence).toEqual({
      trades: [{
        entrySignal: { id: 11, date: '2024-01-02', type: 'buy' },
        exitSignal: null,
        status: 'open'
      }],
      endingPositionStatus: 'open',
      endDate: '2024-01-31'
    })
  })

  it('restores a valid state when an invalid input is corrected', () => {
    const invalid = [{ id: 1, date: '2024-01-02', type: 'sell' as 'sell' }]
    const corrected = [
      { id: 1, date: '2024-01-02', type: 'buy' as 'buy' },
      { id: 2, date: '2024-01-03', type: 'sell' as 'sell' }
    ]

    expect(validateManualSignalSequence(invalid).isValid).toBe(false)
    expect(validateManualSignalSequence(corrected).standardizedSequence).toEqual({
      trades: [{
        entrySignal: { id: 1, date: '2024-01-02', type: 'buy' },
        exitSignal: { id: 2, date: '2024-01-03', type: 'sell' },
        status: 'closed'
      }],
      endingPositionStatus: 'flat',
      endDate: null
    })
  })
})
