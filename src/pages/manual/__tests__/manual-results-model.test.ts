import { ManualReplayResult, ManualReplayTrade } from '../manual-replay-model'
import {
  calculateManualReplayMetrics,
  getManualReplayChartMarkers,
  getManualReplayHoldingIntervals,
  getManualReplayTradeMovements
} from '../manual-results-model'

const makeTrade = (overrides: Partial<ManualReplayTrade> = {}): ManualReplayTrade => ({
  entrySignalDate: '2024-01-01',
  entryExecutionDate: '2024-01-02',
  entryMarketNav: 1,
  entryFillNav: 1.01,
  entryNotional: 500,
  entryFee: 1,
  shares: 495.049505,
  exitSignalDate: null,
  exitExecutionDate: null,
  exitMarketNav: null,
  exitFillNav: null,
  exitNotional: null,
  exitFee: null,
  realizedProfit: null,
  currentValue: 520,
  status: 'open',
  ...overrides
})

const makeResult = (trades: ManualReplayTrade[]): ManualReplayResult => ({
  trades,
  dailySnapshots: [
    { date: '2024-01-01', nav: 1, cash: 1000, shares: 0, dividendReinvestmentAmount: 0, positionValue: 0, totalAssets: 1000, positionStatus: 'flat', completedTradeCount: 0 },
    { date: '2024-01-02', nav: 1.2, cash: 500, shares: 500, dividendReinvestmentAmount: 0, positionValue: 600, totalAssets: 1100, positionStatus: 'open', completedTradeCount: 0 },
    { date: '2024-01-03', nav: 0.9, cash: 600, shares: 0, dividendReinvestmentAmount: 0, positionValue: 0, totalAssets: 600, positionStatus: 'flat', completedTradeCount: 1 },
    { date: '2024-01-04', nav: 1.08, cash: 1080, shares: 0, dividendReinvestmentAmount: 0, positionValue: 0, totalAssets: 1080, positionStatus: 'flat', completedTradeCount: 2 }
  ],
  disclosures: [],
  summary: {
    initialCash: 1000,
    endingCash: 1080,
    endingShares: 0,
    totalDividendReinvested: 0,
    lastNavDate: '2024-01-04',
    lastNav: 1.08,
    openPositionValue: 0,
    endingTotalAssets: 1080,
    completedTradeCount: trades.filter(trade => trade.status === 'closed').length,
    openTradeCount: trades.filter(trade => trade.status === 'open').length,
    realizedProfit: 80,
    unrealizedProfit: 0,
    totalProfit: 80,
    totalReturnRatePercent: 8,
    endingPositionStatus: trades.some(trade => trade.status === 'open') ? 'open' : 'flat'
  }
})

describe('manual replay results model', () => {
  it('calculates return from initial cash and ending assets, drawdown from daily total assets, and win rate only from closed trades', () => {
    const result = makeResult([
      makeTrade({ status: 'closed', exitSignalDate: '2024-01-02', exitExecutionDate: '2024-01-03', exitMarketNav: 1.1, exitFillNav: 1.09, exitNotional: 540, exitFee: 2, realizedProfit: 39 }),
      makeTrade({ entrySignalDate: '2024-01-03', entryExecutionDate: '2024-01-04', status: 'closed', exitSignalDate: '2024-01-04', exitExecutionDate: '2024-01-05', exitMarketNav: 0.9, exitFillNav: 0.9, exitNotional: 400, exitFee: 0, realizedProfit: -20 }),
      makeTrade({ entrySignalDate: '2024-01-05', entryExecutionDate: '2024-01-06', status: 'open' })
    ])

    expect(calculateManualReplayMetrics(result)).toEqual({
      totalProfitAmount: 80,
      totalReturnRatePercent: 8,
      maximumDrawdownPercent: 500 / 1100 * 100,
      winningTradeCount: 1,
      completedTradeCount: 2,
      openTradeCount: 1,
      winRatePercent: 50
    })
  })

  it('returns no win rate when there are no completed round trips', () => {
    const metrics = calculateManualReplayMetrics(makeResult([makeTrade()]))
    expect(metrics.completedTradeCount).toBe(0)
    expect(metrics.openTradeCount).toBe(1)
    expect(metrics.winRatePercent).toBeNull()
  })

  it('keeps entry and exit signal dates distinct from next-NAV execution dates and shades the actual holding interval', () => {
    const closed = makeTrade({
      exitSignalDate: '2024-01-03',
      exitExecutionDate: '2024-01-04',
      exitMarketNav: 1.2,
      exitFillNav: 1.188,
      exitNotional: 600,
      exitFee: 3,
      realizedProfit: 96,
      status: 'closed'
    })
    const open = makeTrade({
      entrySignalDate: '2024-01-04',
      entryExecutionDate: '2024-01-05',
      status: 'open'
    })
    const result = makeResult([closed, open])
    result.summary.lastNavDate = '2024-01-06'

    expect(getManualReplayChartMarkers([closed])).toEqual([
      { tradeIndex: 0, kind: 'entry-signal', side: 'buy', date: '2024-01-01' },
      { tradeIndex: 0, kind: 'entry-execution', side: 'buy', date: '2024-01-02' },
      { tradeIndex: 0, kind: 'exit-signal', side: 'sell', date: '2024-01-03' },
      { tradeIndex: 0, kind: 'exit-execution', side: 'sell', date: '2024-01-04' }
    ])
    expect(getManualReplayHoldingIntervals(result)).toEqual([
      { tradeIndex: 0, startDate: '2024-01-02', endDate: '2024-01-04', isOpen: false },
      { tradeIndex: 1, startDate: '2024-01-05', endDate: '2024-01-06', isOpen: true }
    ])
  })

  it('derives explicit cash, position and fee/slippage-adjusted fill movements from ledger fields', () => {
    const movements = getManualReplayTradeMovements(makeTrade({
      exitSignalDate: '2024-01-03',
      exitExecutionDate: '2024-01-04',
      exitMarketNav: 1.2,
      exitFillNav: 1.188,
      exitNotional: 600,
      exitFee: 3,
      realizedProfit: 96,
      status: 'closed'
    }))

    expect(movements.entryCashChange).toBe(-501)
    expect(movements.exitCashChange).toBe(597)
    expect(movements.entryPositionChange).toBeCloseTo(500 / 1.01, 8)
    expect(movements.exitPositionChange).toBeCloseTo(-600 / 1.188, 8)
    expect(movements.entrySlippageAmount).toBeCloseTo(500 - 500 / 1.01, 8)
    expect(movements.entrySlippageRatePercent).toBeCloseTo(1, 8)
    expect(movements.exitSlippageAmount).toBeCloseTo(600 / 1.188 * 0.012, 8)
    expect(movements.exitSlippageRatePercent).toBeCloseTo(1, 8)
  })
})
