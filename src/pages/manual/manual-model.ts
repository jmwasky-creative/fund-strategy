export type ManualSignalType = 'buy' | 'sell'

export interface ManualQuote {
  date: string
  val: number
}

export interface ManualSignal {
  id: number
  date: string
  type: ManualSignalType
}

export interface ManualQuery {
  fundCode: string
  startDate: string
  endDate: string
}

/** Keep same-day signals in insertion order while sorting dates chronologically. */
export const sortManualSignals = (signals: ManualSignal[]): ManualSignal[] => signals
  .slice()
  .sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id)

/** Filter and sort provider history without substituting a nearby date for a missing date. */
export const filterManualQuotes = (
  history: Record<string, { date?: string, val: number }>,
  startDate: string,
  endDate: string
): ManualQuote[] => Object.keys(history)
  .filter(date => date >= startDate && date <= endDate)
  .map(date => ({
    date: history[date].date || date,
    val: Number(history[date].val)
  }))
  .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.val) && item.val > 0)
  .filter(item => item.date >= startDate && item.date <= endDate)
  .sort((left, right) => left.date.localeCompare(right.date))

export const hasManualQuoteDate = (quotes: ManualQuote[], date: string): boolean =>
  quotes.some(quote => quote.date === date)

/**
 * A signal is invalid after a fund switch, when it falls outside the new range,
 * or when the selected fund has no actual NAV observation on that date.
 */
export const getSignalsInvalidatedByQuery = (
  signals: ManualSignal[],
  previousFundCode: string,
  nextQuery: ManualQuery,
  quotes: ManualQuote[]
): ManualSignal[] => {
  const fundChanged = Boolean(previousFundCode && previousFundCode !== nextQuery.fundCode)
  const availableDates = new Set(quotes.map(quote => quote.date))
  return signals.filter(signal => fundChanged
    || signal.date < nextQuery.startDate
    || signal.date > nextQuery.endDate
    || !availableDates.has(signal.date))
}
