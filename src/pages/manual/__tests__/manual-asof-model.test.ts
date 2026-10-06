import {
  addCalendarDays,
  canAdvanceManualAsOf,
  createManualAsOfSnapshot,
  getInitialManualAsOfDate,
  getNextManualAsOfDate
} from '../manual-asof-model'
import { ManualQuote, ManualSignal } from '../manual-model'

const query = { fundCode: '260108', startDate: '2024-01-05', endDate: '2024-01-31' }
const quotes: ManualQuote[] = [
  { date: '2024-01-04', val: 0.99 },
  { date: '2024-01-05', val: 1.00 },
  { date: '2024-01-08', val: 1.01 },
  { date: '2024-01-11', val: 1.02 },
  { date: '2024-01-12', val: 1.03 },
  { date: '2024-01-19', val: 1.04 },
  { date: '2024-01-30', val: 1.05 },
  { date: '2024-02-01', val: 9.99 }
]

const signals: ManualSignal[] = [
  { id: 1, date: '2024-01-05', type: 'buy' },
  { id: 2, date: '2024-01-12', type: 'sell' },
  { id: 3, date: '2024-01-19', type: 'buy' },
  { id: 4, date: '2024-01-30', type: 'sell' }
]

describe('manual as-of replay model', () => {
  it('uses inclusive seven-calendar-day first windows, including weekends and short ranges', () => {
    expect(addCalendarDays('2024-02-24', 7)).toBe('2024-03-02')
    expect(getInitialManualAsOfDate('2024-01-05', '2024-01-31')).toBe('2024-01-11')
    expect(getInitialManualAsOfDate('2024-01-05', '2024-01-10')).toBe('2024-01-10')
    expect(getInitialManualAsOfDate('2024-01-05', '2024-01-05')).toBe('2024-01-05')
  })

  it('advances by seven calendar days cumulatively and clips the final partial week to the chosen end', () => {
    expect(getNextManualAsOfDate('2024-01-11', '2024-01-31')).toBe('2024-01-18')
    expect(getNextManualAsOfDate('2024-01-18', '2024-01-31')).toBe('2024-01-25')
    expect(getNextManualAsOfDate('2024-01-25', '2024-01-31')).toBe('2024-01-31')
    expect(getNextManualAsOfDate('2024-01-31', '2024-01-31')).toBeNull()
    expect(getNextManualAsOfDate('bad-date', '2024-01-31')).toBeNull()
  })

  it('disables progression when no further in-range NAV exists', () => {
    expect(canAdvanceManualAsOf(quotes, '2024-01-11', '2024-01-31')).toBe(true)
    expect(canAdvanceManualAsOf([{ date: '2024-01-11', val: 1.02 }], '2024-01-11', '2024-01-31')).toBe(false)
    expect(canAdvanceManualAsOf(quotes, '2024-01-31', '2024-01-31')).toBe(false)
  })

  it('creates one current snapshot excluding pre-range and future NAV/signals from every derived input', () => {
    const snapshot = createManualAsOfSnapshot(quotes, signals, query, '2024-01-11')
    expect(snapshot.quotes.map(quote => quote.date)).toEqual(['2024-01-05', '2024-01-08', '2024-01-11'])
    expect(snapshot.signals.map(signal => signal.id)).toEqual([1])
    expect(snapshot.sequenceValidation.standardizedSequence!.trades.map(trade => trade.entrySignal.id)).toEqual([1])
    expect(snapshot.asOfDate).toBe('2024-01-11')
  })

  it('reveals a future signal and its NAV only after the as-of boundary advances', () => {
    const before = createManualAsOfSnapshot(quotes, signals, query, '2024-01-11')
    const after = createManualAsOfSnapshot(quotes, signals, query, '2024-01-18')
    expect(before.quotes.map(quote => quote.date)).toEqual(['2024-01-05', '2024-01-08', '2024-01-11'])
    expect(before.signals.map(signal => signal.id)).toEqual([1])
    expect(after.quotes.map(quote => quote.date)).toEqual(['2024-01-05', '2024-01-08', '2024-01-11', '2024-01-12'])
    expect(after.signals.map(signal => signal.id)).toEqual([1, 2])
    expect(after.sequenceValidation.standardizedSequence!.trades[0].exitSignal!.id).toBe(2)
  })

  it('future NAV changes cannot affect current snapshot, signals, or sequence validation', () => {
    const baseline = createManualAsOfSnapshot(quotes, signals, query, '2024-01-11')
    const changedFuture = quotes.map(quote => quote.date > '2024-01-11' ? { ...quote, val: quote.val * 100 } : quote)
    const changedSignals = signals.map(signal => signal.date > '2024-01-11' ? { ...signal, type: 'sell' as const } : signal)
    const changed = createManualAsOfSnapshot(changedFuture, changedSignals, query, '2024-01-11')

    expect(changed.quotes).toEqual(baseline.quotes)
    expect(changed.signals).toEqual(baseline.signals)
    expect(changed.sequenceValidation).toEqual(baseline.sequenceValidation)
    expect(changed.quotes.every(quote => quote.date <= changed.asOfDate)).toBe(true)
    expect(changed.signals.every(signal => signal.date <= changed.asOfDate)).toBe(true)
  })

  it('clamps a requested snapshot to the selected range and ignores later-than-range NAV', () => {
    const snapshot = createManualAsOfSnapshot(quotes, signals, query, '2024-02-10')
    expect(snapshot.asOfDate).toBe(query.endDate)
    expect(snapshot.quotes[snapshot.quotes.length - 1].date).toBe('2024-01-30')
    expect(snapshot.quotes.some(quote => quote.date === '2024-02-01')).toBe(false)
  })
})
