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

export type ManualSequenceIssueCode =
  | 'sell-while-flat'
  | 'buy-while-holding'
  | 'same-day-opposite-signals'
  | 'state-unknown-after-ambiguous-day'
  | 'open-position-at-end'

export interface ManualSequenceIssue {
  signalId: number
  code: ManualSequenceIssueCode
  message: string
}

export interface ManualSequenceValidation {
  isValid: boolean
  issues: ManualSequenceIssue[]
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

/**
 * Validate a long-only, single-open-position signal sequence without changing its input.
 * Opposing signals on one day and an open position at the selected end remain unresolved
 * product decisions, so they are surfaced as issues instead of being assigned implicit rules.
 */
export const validateManualSignalSequence = (
  signals: ManualSignal[],
  endDate?: string
): ManualSequenceValidation => {
  const orderedSignals = sortManualSignals(signals)
  const issues: ManualSequenceIssue[] = []
  let openSignal: ManualSignal | null = null
  let hasAmbiguousDay = false
  let index = 0

  while (index < orderedSignals.length) {
    const date = orderedSignals[index].date
    const dateSignals: ManualSignal[] = []
    while (index < orderedSignals.length && orderedSignals[index].date === date) {
      dateSignals.push(orderedSignals[index])
      index += 1
    }

    const hasBuy = dateSignals.some(signal => signal.type === 'buy')
    const hasSell = dateSignals.some(signal => signal.type === 'sell')
    if (hasBuy && hasSell) {
      dateSignals.forEach(signal => issues.push({
        signalId: signal.id,
        code: 'same-day-opposite-signals',
        message: `${date} 同时存在买入和卖出点；同日信号先后顺序待确认，无法判断该日后的持仓状态。`
      }))
      orderedSignals.slice(index).forEach(signal => issues.push({
        signalId: signal.id,
        code: 'state-unknown-after-ambiguous-day',
        message: `${date} 的同日信号顺序尚未确认，无法可靠判断 ${signal.date} 此点位发生时的持仓状态。`
      }))
      hasAmbiguousDay = true
      break
    }

    dateSignals.forEach(signal => {
      if (signal.type === 'buy') {
        if (openSignal) {
          issues.push({
            signalId: signal.id,
            code: 'buy-while-holding',
            message: `买入点 ${signal.date} 时已有未平仓多头；首版不支持重复买入或加仓。`
          })
        } else {
          openSignal = signal
        }
      } else if (!openSignal) {
        issues.push({
          signalId: signal.id,
          code: 'sell-while-flat',
          message: `卖出点 ${signal.date} 发生时为空仓；不能在没有对应买入持仓时卖出。`
        })
      } else {
        openSignal = null
      }
    })
  }

  if (!hasAmbiguousDay && openSignal) {
    const terminalDate = endDate ? `所选终止日期 ${endDate}` : '信号序列结束时'
    issues.push({
      signalId: openSignal.id,
      code: 'open-position-at-end',
      message: `${terminalDate} 仍有未平仓多头；期末持仓是否有效待确认。`
    })
  }

  return { isValid: issues.length === 0, issues }
}

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
