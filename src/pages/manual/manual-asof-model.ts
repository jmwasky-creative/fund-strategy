import {
  ManualQuery,
  ManualQuote,
  ManualSequenceValidation,
  ManualSignal,
  sortManualSignals,
  validateManualSignalSequence
} from './manual-model'

const DAY_MS = 24 * 60 * 60 * 1000

export interface ManualAsOfSnapshot {
  startDate: string
  selectedEndDate: string
  asOfDate: string
  quotes: ManualQuote[]
  signals: ManualSignal[]
  sequenceValidation: ManualSequenceValidation
}

const parseCalendarDate = (date: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NaN
  }
  const value = new Date(`${date}T00:00:00.000Z`)
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date
    ? value.getTime()
    : NaN
}

const formatCalendarDate = (time: number): string => new Date(time).toISOString().slice(0, 10)

export const addCalendarDays = (date: string, days: number): string => {
  const time = parseCalendarDate(date)
  return Number.isFinite(time) ? formatCalendarDate(time + days * DAY_MS) : date
}

export const getInitialManualAsOfDate = (startDate: string, endDate: string): string => {
  if (Number.isNaN(parseCalendarDate(startDate)) || Number.isNaN(parseCalendarDate(endDate)) || startDate > endDate) {
    return endDate
  }
  const firstWeekEnd = addCalendarDays(startDate, 6)
  return firstWeekEnd < endDate ? firstWeekEnd : endDate
}

export const getNextManualAsOfDate = (currentAsOfDate: string, selectedEndDate: string): string | null => {
  if (Number.isNaN(parseCalendarDate(currentAsOfDate))
    || Number.isNaN(parseCalendarDate(selectedEndDate))
    || currentAsOfDate >= selectedEndDate) {
    return null
  }
  const nextDate = addCalendarDays(currentAsOfDate, 7)
  return nextDate < selectedEndDate ? nextDate : selectedEndDate
}

export const canAdvanceManualAsOf = (
  historyQuotes: ManualQuote[],
  currentAsOfDate: string,
  selectedEndDate: string
): boolean => {
  const nextDate = getNextManualAsOfDate(currentAsOfDate, selectedEndDate)
  return Boolean(nextDate && historyQuotes.some(quote => quote.date > currentAsOfDate && quote.date <= selectedEndDate))
}

export const createManualAsOfSnapshot = (
  historyQuotes: ManualQuote[],
  allSignals: ManualSignal[],
  query: ManualQuery,
  requestedAsOfDate: string
): ManualAsOfSnapshot => {
  const asOfDate = requestedAsOfDate < query.startDate
    ? query.startDate
    : requestedAsOfDate > query.endDate ? query.endDate : requestedAsOfDate
  const quotes = historyQuotes
    .filter(quote => quote.date >= query.startDate && quote.date <= asOfDate)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
  const signals = sortManualSignals(allSignals.filter(signal =>
    signal.date >= query.startDate && signal.date <= asOfDate
  ))

  return {
    startDate: query.startDate,
    selectedEndDate: query.endDate,
    asOfDate,
    quotes,
    signals,
    sequenceValidation: validateManualSignalSequence(signals, asOfDate)
  }
}

export const createCurrentManualAsOfSnapshot = (
  historyQuotes: ManualQuote[],
  allSignals: ManualSignal[],
  query: ManualQuery,
  asOfDate: string
): ManualAsOfSnapshot => createManualAsOfSnapshot(historyQuotes, allSignals, query, asOfDate)
