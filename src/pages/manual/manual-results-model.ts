import { ManualReplayResult, ManualReplayTrade } from './manual-replay-model'

export interface ManualReplayMetrics {
  totalProfitAmount: number
  totalReturnRatePercent: number
  maximumDrawdownPercent: number
  winningTradeCount: number
  completedTradeCount: number
  openTradeCount: number
  winRatePercent: number | null
}

export interface ManualReplayTradeMovements {
  entryCashChange: number
  exitCashChange: number | null
  entryPositionChange: number
  exitPositionChange: number | null
  entrySlippageAmount: number
  entrySlippageRatePercent: number
  exitSlippageAmount: number | null
  exitSlippageRatePercent: number | null
}

export type ManualReplayChartMarkerKind = 'entry-signal' | 'entry-execution' | 'exit-signal' | 'exit-execution'

export interface ManualReplayChartMarker {
  tradeIndex: number
  kind: ManualReplayChartMarkerKind
  side: 'buy' | 'sell'
  date: string
}

export interface ManualReplayHoldingInterval {
  tradeIndex: number
  startDate: string
  endDate: string
  isOpen: boolean
}

/**
 * Issue #6 display metrics, derived only from the #4 replay ledger and daily asset curve.
 * Realized trade P/L already includes the configured fees and slippage-adjusted fills.
 */
export const calculateManualReplayMetrics = (result: ManualReplayResult): ManualReplayMetrics => {
  const initialCash = result.summary.initialCash
  const totalProfitAmount = result.summary.endingTotalAssets - initialCash
  const totalReturnRatePercent = initialCash > 0 ? totalProfitAmount / initialCash * 100 : 0

  let peakAssets = initialCash
  let maximumDrawdownPercent = 0
  result.dailySnapshots.forEach(snapshot => {
    const totalAssets = snapshot.totalAssets
    if (!Number.isFinite(totalAssets)) {
      return
    }
    peakAssets = Math.max(peakAssets, totalAssets)
    if (peakAssets > 0) {
      maximumDrawdownPercent = Math.max(maximumDrawdownPercent, (peakAssets - totalAssets) / peakAssets * 100)
    }
  })

  const completedTrades = result.trades.filter(trade => trade.status === 'closed')
  const openTradeCount = result.trades.filter(trade => trade.status === 'open').length
  const winningTradeCount = completedTrades.filter(trade =>
    typeof trade.realizedProfit === 'number' && Number.isFinite(trade.realizedProfit) && trade.realizedProfit > 0
  ).length

  return {
    totalProfitAmount,
    totalReturnRatePercent,
    maximumDrawdownPercent,
    winningTradeCount,
    completedTradeCount: completedTrades.length,
    openTradeCount,
    winRatePercent: completedTrades.length > 0 ? winningTradeCount / completedTrades.length * 100 : null
  }
}

/**
 * Reconstruct side-specific slippage and cash/position movements from the #4 ledger's
 * actual market/fill NAV, notional, fee and share fields. Corporate-action share changes
 * remain visible in the daily snapshots and are not guessed into these order fills.
 */
export const getManualReplayTradeMovements = (trade: ManualReplayTrade): ManualReplayTradeMovements => {
  const entryPositionChange = trade.entryFillNav > 0 ? trade.entryNotional / trade.entryFillNav : 0
  const entrySlippageAmount = (trade.entryFillNav - trade.entryMarketNav) * entryPositionChange
  const entrySlippageRatePercent = trade.entryMarketNav > 0
    ? (trade.entryFillNav - trade.entryMarketNav) / trade.entryMarketNav * 100
    : 0
  const hasExit = trade.exitNotional !== null && trade.exitFee !== null
    && trade.exitMarketNav !== null && trade.exitFillNav !== null && trade.exitFillNav > 0
  const exitPositionChange = hasExit ? -(trade.exitNotional! / trade.exitFillNav!) : null
  const exitSlippageAmount = hasExit
    ? (trade.exitMarketNav! - trade.exitFillNav!) * -exitPositionChange!
    : null
  const exitSlippageRatePercent = hasExit && trade.exitMarketNav! > 0
    ? (trade.exitMarketNav! - trade.exitFillNav!) / trade.exitMarketNav! * 100
    : hasExit ? 0 : null

  return {
    entryCashChange: -(trade.entryNotional + trade.entryFee),
    exitCashChange: hasExit ? trade.exitNotional! - trade.exitFee! : null,
    entryPositionChange,
    exitPositionChange,
    entrySlippageAmount,
    entrySlippageRatePercent,
    exitSlippageAmount,
    exitSlippageRatePercent
  }
}

/** Keep signal and execution dates as separate chart events so next-NAV fills stay visible. */
export const getManualReplayChartMarkers = (trades: ManualReplayTrade[]): ManualReplayChartMarker[] => {
  const markers: ManualReplayChartMarker[] = []
  trades.forEach((trade, tradeIndex) => {
    markers.push({ tradeIndex, kind: 'entry-signal', side: 'buy', date: trade.entrySignalDate })
    if (trade.entryExecutionDate) {
      markers.push({ tradeIndex, kind: 'entry-execution', side: 'buy', date: trade.entryExecutionDate })
    }
    if (trade.exitSignalDate) {
      markers.push({ tradeIndex, kind: 'exit-signal', side: 'sell', date: trade.exitSignalDate })
    }
    if (trade.exitExecutionDate) {
      markers.push({ tradeIndex, kind: 'exit-execution', side: 'sell', date: trade.exitExecutionDate })
    }
  })
  return markers
}

/** Closed bands end on the sell fill; open bands end at the final in-range NAV. */
export const getManualReplayHoldingIntervals = (result: ManualReplayResult): ManualReplayHoldingInterval[] => result.trades
  .map((trade, tradeIndex) => ({
    tradeIndex,
    startDate: trade.entryExecutionDate,
    endDate: trade.exitExecutionDate || result.summary.lastNavDate,
    isOpen: trade.status === 'open'
  }))
  .filter(interval => Boolean(interval.startDate && interval.endDate && interval.endDate >= interval.startDate))
