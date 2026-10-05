import { InvestmentStrategy } from '../index'
import { FundDataItem } from '../fetch-fund-data'
import { MarketDataCoverageError } from '../market-api'

describe('backtest market-data coverage', () => {
  const friday: FundDataItem = { date: '2020-01-03', val: 102, bonus: 0 }
  const makeStrategy = () => {
    const strategy = Object.create(InvestmentStrategy.prototype) as InvestmentStrategy
    strategy.fundJson = { all: { [friday.date]: friday }, bonus: {} }
    return strategy
  }

  it('carries the last close over known weekend dates only', () => {
    const strategy = makeStrategy()
    expect(strategy.getFundByDate('2020-01-04')).toBe(friday)
    expect(strategy.getFundByDate('2020-01-05')).toBe(friday)
  })

  it('does not carry a prior close into an uncovered weekday', () => {
    const strategy = makeStrategy()
    try {
      strategy.getFundByDate('2020-01-06')
      throw new Error('expected incomplete market-data coverage')
    } catch (error) {
      expect(error).toBeInstanceOf(MarketDataCoverageError)
      expect(error.message).toContain('2020-01-06')
      expect(error.message).toContain('不沿用前值')
    }
  })
})
