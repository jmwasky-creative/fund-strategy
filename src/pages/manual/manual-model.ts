export type ManualSignalType = 'buy' | 'sell'

export type ManualCorporateActionKind = 'share-split' | 'distribution' | 'unclassified'
export type ManualCorporateActionUnit = 'share-multiplier' | 'cash-per-share' | 'unknown'

export interface ManualCorporateAction {
  date: string
  kind: ManualCorporateActionKind
  value: number | null
  valueUnit: ManualCorporateActionUnit
  description: string
}

export interface ManualQuote {
  date: string
  val: number
  corporateActions?: ManualCorporateAction[]
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

export interface ManualSequenceIssue {
  signalId: number
  code: ManualSequenceIssueCode
  message: string
}

export interface ManualSequenceValidation {
  isValid: boolean
  issues: ManualSequenceIssue[]
  standardizedSequence: StandardManualSequence | null
}

export interface StandardManualTrade {
  entrySignal: ManualSignal
  exitSignal: ManualSignal | null
  status: 'closed' | 'open'
}

/** Validated signal pairs only; this contract contains no fills or valuation. */
export interface StandardManualSequence {
  trades: StandardManualTrade[]
  endingPositionStatus: 'flat' | 'open'
  endDate: string | null
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
 * Opposing signals on one day are rejected; an open position at the end is valid and explicit.
 */
export const validateManualSignalSequence = (
  signals: ManualSignal[],
  endDate?: string
): ManualSequenceValidation => {
  const orderedSignals = sortManualSignals(signals)
  const issues: ManualSequenceIssue[] = []
  const trades: StandardManualTrade[] = []
  let openSignal: ManualSignal | null = null
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
        message: `${date} 同一日期同时存在买入和卖出信号；系统不会猜测先后顺序。请调整信号日期或移除其中一个信号后再校验。`
      }))
      orderedSignals.slice(index).forEach(signal => issues.push({
        signalId: signal.id,
        code: 'state-unknown-after-ambiguous-day',
        message: `${date} 的买入和卖出信号尚未调整，无法判断 ${signal.date} 此点位发生时的持仓状态；请先处理该同日冲突。`
      }))
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
        trades.push({ entrySignal: openSignal, exitSignal: signal, status: 'closed' })
        openSignal = null
      }
    })
  }

  if (!issues.length && openSignal) {
    trades.push({ entrySignal: openSignal, exitSignal: null, status: 'open' })
  }

  const isValid = issues.length === 0
  return {
    isValid,
    issues,
    standardizedSequence: isValid ? {
      trades,
      endingPositionStatus: openSignal ? 'open' : 'flat',
      endDate: endDate || null
    } : null
  }
}

/** Filter and sort provider history without substituting a nearby date for a missing date. */
export const filterManualQuotes = (
  history: Record<string, {
    date?: string,
    val: number,
    bonus?: number | string | null,
    isBonusPortion?: boolean,
    unitMoney?: string
  }>,
  startDate: string,
  endDate: string
): ManualQuote[] => Object.keys(history)
  .filter(date => date >= startDate && date <= endDate)
  .map(date => {
    const source = history[date]
    const quoteDate = source.date || date
    const description = typeof source.unitMoney === 'string' ? source.unitMoney.trim() : ''
    const rawBonusPresent = source.bonus !== undefined && source.bonus !== null && source.bonus !== ''
    const parsedBonus = rawBonusPresent ? Number(source.bonus) : NaN
    const hasUnexplainedBonus = Boolean(source.isBonusPortion)
      || (rawBonusPresent && (!Number.isFinite(parsedBonus) || Number(parsedBonus) !== 0))
    if (!description && !hasUnexplainedBonus) {
      return { date: quoteDate, val: Number(source.val) }
    }
    const eventDescription = description || '数据源报告 bonus/份额事件字段，但缺少 unitMoney 事件说明'
    const splitMatch = description.match(/^(?:每份(?:基金)?份额)?(?:拆分|折算)\s*(?:为\s*)?(\d+(?:\.\d+)?)\s*份$/)
    const cashPerShareMatch = description.match(/^(?:分红\s*[：:]?\s*)?每份(?:(?:基金)?份额)?(?:派现金|派现|现金分红|现金红利|派息|分红|派发现金)\s*(\d+(?:\.\d+)?)\s*元$/)
    const isSplit = Boolean(source.isBonusPortion) || /拆分|折算/.test(description)
    const isDistribution = /分红|派现|派息|红利|现金/.test(description)
    const matchedAmount = splitMatch ? Number(splitMatch[1])
      : cashPerShareMatch ? Number(cashPerShareMatch[1]) : null
    const sourceAmountMatches = matchedAmount !== null && (!rawBonusPresent
      || (Number.isFinite(parsedBonus)
        && Math.abs(Number(parsedBonus) - matchedAmount) <= Math.max(1, matchedAmount) * 1e-10))
    const valueUnit: ManualCorporateActionUnit = splitMatch && sourceAmountMatches
      ? 'share-multiplier'
      : cashPerShareMatch && sourceAmountMatches ? 'cash-per-share' : 'unknown'
    return {
      date: quoteDate,
      val: Number(source.val),
      corporateActions: [{
        date: quoteDate,
        kind: isSplit ? 'share-split' as ManualCorporateActionKind
          : isDistribution ? 'distribution' as ManualCorporateActionKind
            : 'unclassified' as ManualCorporateActionKind,
        value: sourceAmountMatches ? matchedAmount : null,
        valueUnit,
        description: eventDescription
      }]
    }
  })
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
