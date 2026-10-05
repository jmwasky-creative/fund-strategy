import { ManualQuote, ManualSequenceValidation, ManualSignal } from '../manual-model'
import { ManualReplayConfig, runManualReplay } from '../manual-replay-model'

const config: ManualReplayConfig = {
  initialCash: 1000,
  buyAmount: 500,
  buyFeeRatePercent: 0,
  sellFeeRatePercent: 0,
  buySlippageRatePercent: 0,
  sellSlippageRatePercent: 0
}

const quotes = (items: ManualQuote[]): ManualQuote[] => items

const signal = (id: number, date: string, type: 'buy' | 'sell'): ManualSignal => ({ id, date, type })

const valid = (trades: ManualSequenceValidation['standardizedSequence'] extends infer T
  ? T extends { trades: infer U } ? U : never : never, endDate: string): ManualSequenceValidation => ({
  isValid: true,
  issues: [],
  standardizedSequence: {
    trades: trades as any,
    endingPositionStatus: trades && (trades as any[]).some(trade => trade.status === 'open') ? 'open' : 'flat',
    endDate
  }
})

const oneClosedTrade = (buyDate: string, sellDate: string, endDate: string) => valid([{
  entrySignal: signal(1, buyDate, 'buy'),
  exitSignal: signal(2, sellDate, 'sell'),
  status: 'closed' as 'closed'
}], endDate)

const oneOpenTrade = (buyDate: string, endDate: string) => valid([{
  entrySignal: signal(1, buyDate, 'buy'),
  exitSignal: null,
  status: 'open' as 'open'
}], endDate)

describe('manual replay engine', () => {
  it('executes each signal strictly on the next NAV date and retains both dates in the ledger', () => {
    const result = runManualReplay(
      oneClosedTrade('2024-01-01', '2024-01-03', '2024-01-05'),
      quotes([
        { date: '2024-01-01', val: 10 },
        { date: '2024-01-02', val: 11 },
        { date: '2024-01-03', val: 12 },
        { date: '2024-01-04', val: 10 },
        { date: '2024-01-05', val: 13 }
      ]),
      { startDate: '2024-01-01', endDate: '2024-01-05' },
      config
    )

    expect(result.trades[0]).toMatchObject({
      entrySignalDate: '2024-01-01',
      entryExecutionDate: '2024-01-02',
      entryMarketNav: 11,
      entryFillNav: 11,
      exitSignalDate: '2024-01-03',
      exitExecutionDate: '2024-01-04',
      exitMarketNav: 10,
      status: 'closed'
    })
    expect(result.summary.completedTradeCount).toBe(1)
    expect(result.summary.openTradeCount).toBe(0)
    expect(result.dailySnapshots).toHaveLength(5)
  })

  it('uses explicit fee and slippage parameters and exposes the calculation disclosure', () => {
    const result = runManualReplay(
      oneClosedTrade('2024-01-01', '2024-01-03', '2024-01-04'),
      quotes([
        { date: '2024-01-01', val: 10 },
        { date: '2024-01-02', val: 10 },
        { date: '2024-01-03', val: 12 },
        { date: '2024-01-04', val: 12 }
      ]),
      { startDate: '2024-01-01', endDate: '2024-01-04' },
      {
        initialCash: 1000,
        buyAmount: 500,
        buyFeeRatePercent: 1,
        sellFeeRatePercent: 2,
        buySlippageRatePercent: 10,
        sellSlippageRatePercent: 10
      }
    )

    expect(result.trades[0].entryFillNav).toBeCloseTo(11)
    expect(result.trades[0].entryFee).toBe(5)
    expect(result.trades[0].exitFillNav).toBeCloseTo(10.8)
    expect(result.trades[0].exitFee).toBeCloseTo(result.trades[0].exitNotional! * 0.02)
    expect(result.disclosures.join(' ')).toContain('成交净值')
  })

  it('marks a terminal open position at the last valid in-range NAV without counting it as closed', () => {
    const result = runManualReplay(
      oneOpenTrade('2024-01-01', '2024-01-03'),
      quotes([
        { date: '2024-01-01', val: 10 },
        { date: '2024-01-02', val: 10 },
        { date: '2024-01-03', val: 12 }
      ]),
      { startDate: '2024-01-01', endDate: '2024-01-03' },
      config
    )

    expect(result.trades[0]).toMatchObject({ status: 'open', exitExecutionDate: null, exitNotional: null, currentValue: 600 })
    expect(result.summary).toMatchObject({
      lastNavDate: '2024-01-03',
      openPositionValue: 600,
      endingTotalAssets: 1100,
      completedTradeCount: 0,
      openTradeCount: 1,
      endingPositionStatus: 'open'
    })
    expect(result.disclosures.join(' ')).toContain('不计入已完成交易数')
  })

  it('accepts an empty valid sequence without making up trades or returns', () => {
    const result = runManualReplay(
      valid([], '2024-01-02'),
      quotes([{ date: '2024-01-01', val: 10 }, { date: '2024-01-02', val: 11 }]),
      { startDate: '2024-01-01', endDate: '2024-01-02' },
      config
    )
    expect(result.trades).toEqual([])
    expect(result.summary.endingCash).toBe(config.initialCash)
    expect(result.summary.totalProfit).toBe(0)
  })

  it('rejects invalid #3 validation and missing parameters before producing results', () => {
    expect(() => runManualReplay({ isValid: false, issues: [], standardizedSequence: null }, quotes([{ date: '2024-01-01', val: 10 }]), {
      startDate: '2024-01-01', endDate: '2024-01-01'
    }, config)).toThrow('未收到 #3 校验通过')
    expect(() => runManualReplay(valid([], '2024-01-01'), quotes([{ date: '2024-01-01', val: 10 }]), {
      startDate: '2024-01-01', endDate: '2024-01-01'
    }, { ...config, buyAmount: NaN })).toThrow('buyAmount')
  })

  it('blocks a signal on the final date instead of filling early or outside the selected range', () => {
    expect(() => runManualReplay(
      oneOpenTrade('2024-01-03', '2024-01-03'),
      quotes([{ date: '2024-01-02', val: 10 }, { date: '2024-01-03', val: 11 }]),
      { startDate: '2024-01-01', endDate: '2024-01-03' },
      config
    )).toThrow('没有下一条有效基金净值')
  })

  it('resolves a non-trading-day signal to the next quoted NAV and rejects colliding fills', () => {
    const weekendTrade = runManualReplay(
      oneOpenTrade('2024-01-06', '2024-01-09'),
      quotes([
        { date: '2024-01-05', val: 10 },
        { date: '2024-01-08', val: 11 },
        { date: '2024-01-09', val: 12 }
      ]),
      { startDate: '2024-01-05', endDate: '2024-01-09' },
      config
    )
    expect(weekendTrade.trades[0].entryExecutionDate).toBe('2024-01-08')

    const colliding = valid([
      { entrySignal: signal(1, '2024-01-06', 'buy'), exitSignal: signal(2, '2024-01-07', 'sell'), status: 'closed' },
      { entrySignal: signal(3, '2024-01-08', 'buy'), exitSignal: null, status: 'open' }
    ], '2024-01-09')
    expect(() => runManualReplay(colliding, quotes([
      { date: '2024-01-05', val: 10 },
      { date: '2024-01-08', val: 11 },
      { date: '2024-01-09', val: 12 }
    ]), { startDate: '2024-01-05', endDate: '2024-01-09' }, config)).toThrow('多个信号映射到同一个')
  })

  it('does not go negative or silently truncate when cash cannot cover the explicit order plus fee', () => {
    expect(() => runManualReplay(
      oneOpenTrade('2024-01-01', '2024-01-02'),
      quotes([{ date: '2024-01-01', val: 10 }, { date: '2024-01-02', val: 10 }]),
      { startDate: '2024-01-01', endDate: '2024-01-02' },
      { ...config, initialCash: 500, buyFeeRatePercent: 1 }
    )).toThrow('资金不足')
  })

  it('applies provider-reported split multipliers to an open holding and blocks unresolved cash distributions', () => {
    const split = runManualReplay(
      oneOpenTrade('2024-01-01', '2024-01-04'),
      quotes([
        { date: '2024-01-01', val: 10 },
        { date: '2024-01-02', val: 10 },
        { date: '2024-01-03', val: 5, corporateActions: [{ date: '2024-01-03', kind: 'share-split', value: 2, description: '折算2份' }] },
        { date: '2024-01-04', val: 5 }
      ]),
      { startDate: '2024-01-01', endDate: '2024-01-04' },
      config
    )
    expect(split.summary.endingShares).toBe(100)
    expect(split.summary.openPositionValue).toBe(500)

    expect(() => runManualReplay(
      oneOpenTrade('2024-01-01', '2024-01-04'),
      quotes([
        { date: '2024-01-01', val: 10 },
        { date: '2024-01-02', val: 10 },
        { date: '2024-01-03', val: 9, corporateActions: [{ date: '2024-01-03', kind: 'distribution', value: 0.1, description: '每份派现0.1元' }] },
        { date: '2024-01-04', val: 9 }
      ]),
      { startDate: '2024-01-01', endDate: '2024-01-04' },
      config
    )).toThrow('现金分红/红利再投口径未确认')
  })

  it('rejects malformed, duplicate, out-of-range or invalid NAV data', () => {
    const sequence = valid([], '2024-01-02')
    const range = { startDate: '2024-01-01', endDate: '2024-01-02' }
    expect(() => runManualReplay(sequence, [], range, config)).toThrow('没有可用于回放')
    expect(() => runManualReplay(sequence, quotes([
      { date: '2024-01-01', val: 10 }, { date: '2024-01-01', val: 11 }
    ]), range, config)).toThrow('重复基金净值')
    expect(() => runManualReplay(sequence, quotes([{ date: '2024-01-03', val: 10 }]), range, config)).toThrow('超出所选区间')
    expect(() => runManualReplay(sequence, quotes([{ date: '2024-01-01', val: 0 }]), range, config)).toThrow('无效日期或非正数净值')
  })
})
