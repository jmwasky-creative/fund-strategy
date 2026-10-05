import {
  ManualCorporateAction,
  ManualQuote,
  ManualSequenceValidation,
  ManualSignal,
  StandardManualTrade
} from './manual-model'

export interface ManualReplayRange {
  startDate: string
  endDate: string
}

/** Every field is required; the UI intentionally has no guessed numerical defaults. */
export interface ManualReplayConfig {
  initialCash: number
  buyAmount: number
  buyFeeRatePercent: number
  sellFeeRatePercent: number
  buySlippageRatePercent: number
  sellSlippageRatePercent: number
}

export interface ManualReplayTrade {
  entrySignalDate: string
  entryExecutionDate: string
  entryMarketNav: number
  entryFillNav: number
  entryNotional: number
  entryFee: number
  shares: number
  exitSignalDate: string | null
  exitExecutionDate: string | null
  exitMarketNav: number | null
  exitFillNav: number | null
  exitNotional: number | null
  exitFee: number | null
  realizedProfit: number | null
  currentValue: number | null
  status: 'closed' | 'open'
}

export interface ManualReplayDailySnapshot {
  date: string
  nav: number
  cash: number
  shares: number
  positionValue: number
  totalAssets: number
  positionStatus: 'flat' | 'open'
  completedTradeCount: number
}

export interface ManualReplayResult {
  trades: ManualReplayTrade[]
  dailySnapshots: ManualReplayDailySnapshot[]
  disclosures: string[]
  summary: {
    initialCash: number
    endingCash: number
    endingShares: number
    lastNavDate: string
    lastNav: number
    openPositionValue: number
    endingTotalAssets: number
    completedTradeCount: number
    openTradeCount: number
    realizedProfit: number
    unrealizedProfit: number
    totalProfit: number
    totalReturnRatePercent: number
    endingPositionStatus: 'flat' | 'open'
  }
}

interface ScheduledOrder {
  tradeIndex: number
  signal: ManualSignal
  side: 'buy' | 'sell'
}

const fail = (reason: string): never => {
  throw new Error(`手动回测失败：${reason}`)
}

const isCalendarDate = (date: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false
  }
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

const assertConfig = (config: ManualReplayConfig) => {
  if (!config || typeof config !== 'object') {
    fail('缺少回测参数；初始资金、每笔买入金额、买卖费率和买卖滑点均须显式输入。')
  }
  const required: Array<[keyof ManualReplayConfig, number]> = [
    ['initialCash', config.initialCash],
    ['buyAmount', config.buyAmount],
    ['buyFeeRatePercent', config.buyFeeRatePercent],
    ['sellFeeRatePercent', config.sellFeeRatePercent],
    ['buySlippageRatePercent', config.buySlippageRatePercent],
    ['sellSlippageRatePercent', config.sellSlippageRatePercent]
  ]
  const missing = required.filter(([, value]) => typeof value !== 'number' || !Number.isFinite(value))
  if (missing.length > 0) {
    fail(`回测参数缺失或无效：${missing.map(([key]) => key).join('、')}。`)
  }
  if (config.initialCash <= 0) {
    fail('初始资金必须大于 0。')
  }
  if (config.buyAmount <= 0) {
    fail('每笔买入金额必须大于 0。')
  }
  if (config.buyFeeRatePercent < 0 || config.buyFeeRatePercent >= 100
    || config.sellFeeRatePercent < 0 || config.sellFeeRatePercent >= 100) {
    fail('买入和卖出费率须在 [0, 100) 百分比范围内。')
  }
  if (config.buySlippageRatePercent < 0 || config.buySlippageRatePercent >= 100
    || config.sellSlippageRatePercent < 0 || config.sellSlippageRatePercent >= 100) {
    fail('买入和卖出滑点率须在 [0, 100) 百分比范围内。')
  }
}

const assertAction = (action: ManualCorporateAction, quoteDate: string) => {
  if (!action || action.date !== quoteDate || !isCalendarDate(action.date)) {
    fail(`${quoteDate} 的基金事件日期/结构无效。`)
  }
  if (action.kind === 'share-split' && (!Number.isFinite(action.value) || action.value <= 0)) {
    fail(`${quoteDate} 数据源报告份额拆分/折算，但没有有效份额倍数。`)
  }
  if (action.kind !== 'share-split' && action.kind !== 'distribution' && action.kind !== 'unclassified') {
    fail(`${quoteDate} 存在无法识别的基金事件，不能继续回放。`)
  }
}

const assertSequence = (
  validation: ManualSequenceValidation,
  range: ManualReplayRange
): StandardManualTrade[] => {
  if (!validation || validation.isValid !== true || !validation.standardizedSequence) {
    fail('未收到 #3 校验通过的标准化信号序列；非法或缺失序列不得进入引擎。')
  }
  const sequenceValue = validation && validation.isValid && validation.standardizedSequence
    ? validation.standardizedSequence
    : null
  if (!sequenceValue) {
    fail('未收到 #3 校验通过的标准化信号序列；非法或缺失序列不得进入引擎。')
  }
  const sequence = sequenceValue as NonNullable<ManualSequenceValidation['standardizedSequence']>
  if (!Array.isArray(sequence.trades)
    || (sequence.endingPositionStatus !== 'flat' && sequence.endingPositionStatus !== 'open')) {
    fail('收到的 #3 标准信号结构无效。')
  }
  if (sequence.endDate && (!isCalendarDate(sequence.endDate) || sequence.endDate !== range.endDate)) {
    fail('标准序列结束日期与本次所选回测区间不一致。')
  }

  let previousExitDate: string | null = null
  let openTradeCount = 0
  sequence.trades.forEach((trade, index) => {
    const entry = trade && trade.entrySignal
    if (!entry || !Number.isFinite(entry.id) || !isCalendarDate(entry.date) || entry.type !== 'buy') {
      fail(`第 ${index + 1} 笔交易缺少有效买入信号。`)
    }
    if (entry.date < range.startDate || entry.date > range.endDate) {
      fail(`${entry.date} 的买入信号不在所选区间内。`)
    }
    if (previousExitDate && entry.date <= previousExitDate) {
      fail(`${entry.date} 的买入信号与前一笔卖出日期冲突，不能推断交易顺序。`)
    }
    if (trade.status === 'closed') {
      const exit = trade.exitSignal
      if (!exit || !Number.isFinite(exit.id) || !isCalendarDate(exit.date) || exit.type !== 'sell') {
        fail(`${entry.date} 的已平仓交易缺少有效卖出信号。`)
      }
      const validExit = exit as ManualSignal
      if (validExit.date <= entry.date || validExit.date > range.endDate) {
        fail(`${validExit.date} 的卖出信号日期不晚于买入或超出所选区间。`)
      }
      previousExitDate = validExit.date
    } else if (trade.status === 'open' && trade.exitSignal === null) {
      openTradeCount += 1
      if (index !== sequence.trades.length - 1) {
        fail('未平仓交易后仍有其他交易；#3 标准序列状态不一致。')
      }
    } else {
      fail(`${entry.date} 的交易状态与退出信号不一致。`)
    }
  })
  if (openTradeCount > 1
    || (sequence.endingPositionStatus === 'open') !== (openTradeCount === 1)) {
    fail('#3 标准序列的期末持仓状态与交易列表不一致。')
  }
  return sequence.trades
}

const scheduleSignal = (
  signal: ManualSignal,
  tradeIndex: number,
  side: 'buy' | 'sell',
  quotes: ManualQuote[],
  range: ManualReplayRange,
  schedule: Record<string, ScheduledOrder[]>
) => {
  if (signal.date < range.startDate || signal.date > range.endDate) {
    fail(`${signal.date} 的${side === 'buy' ? '买入' : '卖出'}信号不在所选区间内。`)
  }
  const executionQuote = quotes.find(quote => quote.date > signal.date && quote.date <= range.endDate)
  if (!executionQuote) {
    fail(`${signal.date} 的${side === 'buy' ? '买入' : '卖出'}信号之后，在所选区间内没有下一条有效基金净值，不能提前成交或使用区间外数据。`)
  }
  const resolvedQuote = executionQuote as ManualQuote
  schedule[resolvedQuote.date] = (schedule[resolvedQuote.date] || []).concat({ tradeIndex, signal, side })
}

/**
 * Replay only a valid #3 contract. Signals fill on the next returned valid NAV
 * observation strictly after signal date; the selected range is never extended.
 * Buy amount is pre-fee notional; fee = notional * fee rate. Slippage adjusts NAV:
 * buy NAV * (1 + rate), sell NAV * (1 - rate). All rates are explicit percent inputs.
 */
export const runManualReplay = (
  validation: ManualSequenceValidation,
  inputQuotes: ManualQuote[],
  range: ManualReplayRange,
  config: ManualReplayConfig
): ManualReplayResult => {
  assertConfig(config)
  if (!range || !isCalendarDate(range.startDate) || !isCalendarDate(range.endDate) || range.startDate > range.endDate) {
    fail('回测日期区间无效。')
  }
  if (!Array.isArray(inputQuotes) || inputQuotes.length === 0) {
    fail('所选区间没有可用于回放的有效基金净值。')
  }
  if (inputQuotes.some(quote => !quote || typeof quote.date !== 'string')) {
    fail('历史行情包含空记录或无效日期；不能静默跳过或用相邻日期替代。')
  }
  const quotes = inputQuotes.slice().sort((left, right) => left.date.localeCompare(right.date))
  const seenDates: Record<string, boolean> = {}
  quotes.forEach(quote => {
    if (!quote || !isCalendarDate(quote.date) || !Number.isFinite(quote.val) || quote.val <= 0) {
      fail('历史行情包含无效日期或非正数净值；不能静默跳过或用相邻日期替代。')
    }
    if (quote.date < range.startDate || quote.date > range.endDate) {
      fail(`${quote.date} 的净值超出所选区间，拒绝使用区间外数据。`)
    }
    if (seenDates[quote.date]) {
      fail(`${quote.date} 存在重复基金净值记录。`)
    }
    seenDates[quote.date] = true
    ;(quote.corporateActions || []).forEach(action => assertAction(action, quote.date))
  })
  const sourceTrades = assertSequence(validation, range)
  const schedule: Record<string, ScheduledOrder[]> = {}
  sourceTrades.forEach((trade, index) => {
    scheduleSignal(trade.entrySignal, index, 'buy', quotes, range, schedule)
    if (trade.exitSignal) {
      scheduleSignal(trade.exitSignal, index, 'sell', quotes, range, schedule)
    }
  })
  Object.keys(schedule).forEach(date => {
    if (schedule[date].length > 1) {
      fail(`${date} 有多个信号映射到同一个下一可用净值日；成交先后无法由行情确定，请调整信号日期。`)
    }
  })

  let cash = config.initialCash
  let shares = 0
  let activeTradeIndex: number | null = null
  let realizedProfit = 0
  let completedTradeCount = 0
  const disclosures: string[] = [
    `每次买入按本次显式输入的固定费前名义金额下单；卖出信号平掉单笔未平仓交易的全部份额。买卖费用 = 对应成交名义金额 × 显式输入费率，买入费用另计现金支出。`,
    `买入成交净值 = 当日净值 × (1 + 买入滑点率)；卖出成交净值 = 当日净值 × (1 - 卖出滑点率)。`,
    `信号在信号日后的下一条区间内有效净值成交；成交日期与信号日期分开记录。`,
    `本结果为历史模拟，不会发送真实订单；数据源未提供或口径未确认的现金分红不作现金派发或红利再投假设。`
  ]
  const trades: ManualReplayTrade[] = sourceTrades.map(trade => ({
    entrySignalDate: trade.entrySignal.date,
    entryExecutionDate: '',
    entryMarketNav: 0,
    entryFillNav: 0,
    entryNotional: config.buyAmount,
    entryFee: 0,
    shares: 0,
    exitSignalDate: trade.exitSignal ? trade.exitSignal.date : null,
    exitExecutionDate: null,
    exitMarketNav: null,
    exitFillNav: null,
    exitNotional: null,
    exitFee: null,
    realizedProfit: null,
    currentValue: null,
    status: trade.status
  }))
  const dailySnapshots: ManualReplayDailySnapshot[] = []

  quotes.forEach(quote => {
    const actions = quote.corporateActions || []
    actions.forEach(action => {
      if (shares <= 0) {
        disclosures.push(`${action.date} 数据源报告基金事件“${action.description}”；当日为空仓，未调整持仓。`)
        return
      }
      if (action.kind === 'share-split') {
        shares *= action.value
        if (activeTradeIndex !== null) {
          trades[activeTradeIndex].shares = shares
        }
        disclosures.push(`${action.date} 数据源报告份额拆分/折算；按其公布倍数 ${action.value} 调整持有份额，未产生现金流。`)
        return
      }
      fail(`${action.date} 持仓期间发生待确认基金事件“${action.description}”；现金分红/红利再投口径未确认，停止回放，不假定任何处理方式。`)
    })

    const orders = schedule[quote.date] || []
    orders.forEach(order => {
      if (order.side === 'buy') {
        if (shares > 0 || activeTradeIndex !== null) {
          fail(`${quote.date} 买入信号执行时已有持仓；拒绝加仓或重叠持仓。`)
        }
        const fee = config.buyAmount * config.buyFeeRatePercent / 100
        const cashDebit = config.buyAmount + fee
        if (cash + 1e-10 < cashDebit) {
          fail(`${quote.date} 买入信号资金不足：所需现金 ${cashDebit}，可用现金 ${cash}；未截断金额。`)
        }
        const fillNav = quote.val * (1 + config.buySlippageRatePercent / 100)
        if (!Number.isFinite(fillNav) || fillNav <= 0) {
          fail(`${quote.date} 买入成交净值无效。`)
        }
        shares = config.buyAmount / fillNav
        cash = Math.max(0, cash - cashDebit)
        activeTradeIndex = order.tradeIndex
        const trade = trades[order.tradeIndex]
        trade.entryExecutionDate = quote.date
        trade.entryMarketNav = quote.val
        trade.entryFillNav = fillNav
        trade.entryFee = fee
        trade.shares = shares
      } else {
        if (shares <= 0 || activeTradeIndex === null || activeTradeIndex !== order.tradeIndex) {
          fail(`${quote.date} 卖出信号执行时没有对应的有效持仓；拒绝超额卖出。`)
        }
        const fillNav = quote.val * (1 - config.sellSlippageRatePercent / 100)
        if (!Number.isFinite(fillNav) || fillNav <= 0) {
          fail(`${quote.date} 卖出成交净值无效。`)
        }
        const exitNotional = shares * fillNav
        const exitFee = exitNotional * config.sellFeeRatePercent / 100
        const netProceeds = exitNotional - exitFee
        const trade = trades[order.tradeIndex]
        trade.exitExecutionDate = quote.date
        trade.exitMarketNav = quote.val
        trade.exitFillNav = fillNav
        trade.exitNotional = exitNotional
        trade.exitFee = exitFee
        trade.realizedProfit = netProceeds - trade.entryNotional - trade.entryFee
        realizedProfit += trade.realizedProfit
        cash += netProceeds
        completedTradeCount += 1
        shares = 0
        activeTradeIndex = null
      }
    })

    const positionValue = shares * quote.val
    dailySnapshots.push({
      date: quote.date,
      nav: quote.val,
      cash,
      shares,
      positionValue,
      totalAssets: cash + positionValue,
      positionStatus: shares > 0 ? 'open' : 'flat',
      completedTradeCount
    })
  })

  if ((activeTradeIndex !== null) !== (sourceTrades.length > 0
    && sourceTrades[sourceTrades.length - 1].status === 'open')) {
    fail('回放结束持仓状态与 #3 标准序列不一致。')
  }
  const lastQuote = quotes[quotes.length - 1]
  const openPositionValue = shares > 0 ? shares * lastQuote.val : 0
  const endingTotalAssets = cash + openPositionValue
  const openTradeCount = activeTradeIndex === null ? 0 : 1
  const unrealizedProfit = activeTradeIndex === null
    ? 0
    : openPositionValue - trades[activeTradeIndex].entryNotional - trades[activeTradeIndex].entryFee
  const endingPositionStatus = openTradeCount > 0 ? 'open' : 'flat'
  const openTradeIndex = activeTradeIndex
  if (openTradeIndex !== null) {
    trades[openTradeIndex].currentValue = openPositionValue
    disclosures.push(`期末未平仓按区间内最后有效净值 ${lastQuote.date}（${lastQuote.val}）估值；该持仓仍标记 open/unclosed，不合成为卖出、不计入已完成交易数。`)
  }

  return {
    trades,
    dailySnapshots,
    disclosures,
    summary: {
      initialCash: config.initialCash,
      endingCash: cash,
      endingShares: shares,
      lastNavDate: lastQuote.date,
      lastNav: lastQuote.val,
      openPositionValue,
      endingTotalAssets,
      completedTradeCount,
      openTradeCount,
      realizedProfit,
      unrealizedProfit,
      totalProfit: endingTotalAssets - config.initialCash,
      totalReturnRatePercent: (endingTotalAssets / config.initialCash - 1) * 100,
      endingPositionStatus
    }
  }
}
