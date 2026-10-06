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

const isValidManualAsOfRange = (startDate: string, currentAsOfDate: string, selectedEndDate: string): boolean => {
  const startTime = parseCalendarDate(startDate)
  const currentTime = parseCalendarDate(currentAsOfDate)
  const endTime = parseCalendarDate(selectedEndDate)
  return Number.isFinite(startTime)
    && Number.isFinite(currentTime)
    && Number.isFinite(endTime)
    && startTime <= currentTime
    && currentTime < endTime
}

export const getNextManualAsOfDate = (
  startDate: string,
  currentAsOfDate: string,
  selectedEndDate: string
): string | null => {
  if (!isValidManualAsOfRange(startDate, currentAsOfDate, selectedEndDate)) {
    return null
  }
  const nextDate = addCalendarDays(currentAsOfDate, 7)
  return nextDate < selectedEndDate ? nextDate : selectedEndDate
}

export const canAdvanceManualAsOf = (
  startDate: string,
  currentAsOfDate: string,
  selectedEndDate: string
): boolean => isValidManualAsOfRange(startDate, currentAsOfDate, selectedEndDate)

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

/** Resolve a signal's next execution NAV only from the already revealed snapshot. */
export const getNextManualAsOfQuoteDate = (
  snapshot: ManualAsOfSnapshot,
  signalDate: string
): string | null => {
  if (signalDate < snapshot.startDate || signalDate > snapshot.asOfDate) {
    return null
  }
  const nextQuote = snapshot.quotes.find(quote => quote.date > signalDate
    && quote.date <= snapshot.asOfDate
    && quote.date <= snapshot.selectedEndDate)
  return nextQuote ? nextQuote.date : null
}
