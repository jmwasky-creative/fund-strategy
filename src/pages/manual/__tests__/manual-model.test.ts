import {
  filterManualQuotes,
  getSignalsInvalidatedByQuery,
  hasManualQuoteDate,
  ManualSignal,
  sortManualSignals
} from '../manual-model'

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
})
