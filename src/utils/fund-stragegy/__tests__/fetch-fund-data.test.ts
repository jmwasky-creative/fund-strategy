jest.mock('../market-api', () => {
  const actual = jest.requireActual('../market-api')
  return {
    ...actual,
    loadFundHistoryScript: jest.fn(),
    requestIndexKlines: jest.fn(),
    requestJSONP: jest.fn()
  }
})

import { getFundData, getIndexFundData } from '../fetch-fund-data'
import { loadFundHistoryScript, MarketDataCoverageError, requestIndexKlines } from '../market-api'

const loadFundHistoryMock = loadFundHistoryScript as jest.Mock
const requestIndexMock = requestIndexKlines as jest.Mock

describe('market-data adapters', () => {
  beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
  })

  it('keeps the legacy fund-data shape and newest-first ordering', async () => {
    loadFundHistoryMock.mockResolvedValue([
      { x: Date.UTC(2020, 0, 1), y: 1.1, unitMoney: '' },
      { x: Date.UTC(2020, 0, 2), y: 1.2, unitMoney: '拆分1.1份' },
      { x: Date.UTC(2020, 0, 3), y: 1.3, unitMoney: '' }
    ])

    const result = await getFundData('000001', 2)
    expect(loadFundHistoryMock).toHaveBeenCalledWith('000001')
    expect(Object.keys(result.all)).toEqual(['2020-01-03', '2020-01-02'])
    expect(result.all['2020-01-02']).toMatchObject({ date: '2020-01-02', val: 1.2, bonus: 1.1, isBonusPortion: true })
    expect(result.bonus['2020-01-02']).toBe(result.all['2020-01-02'])
  })

  it('rejects invalid fund codes and empty history rather than returning an empty backtest', async () => {
    await expect(getFundData('000001&callback=evil', 10)).rejects.toThrow('基金代码必须为 6 位数字')
    expect(loadFundHistoryMock).not.toHaveBeenCalled()

    loadFundHistoryMock.mockResolvedValue([])
    await expect(getFundData('000001', 10)).rejects.toThrow('没有可用于所选区间的历史净值')
  })

  it('requests HTTPS index data, preserves cache data shape, and filters to the requested date window', async () => {
    requestIndexMock.mockResolvedValue({
      rc: 0,
      data: {
        klines: [
          '2020-01-01,3000,3000,3000,3000,1,1',
          '2020-01-02,3010,3010,3010,3010,1,1',
          '2020-01-03,3020,3020,3020,3020,1,1'
        ]
      }
    })

    const range: [string, string] = ['2020-01-01', '2020-01-03']
    const first = await getIndexFundData({ code: '1.000001', range })
    expect(Object.keys(first)).toEqual(['2020-01-01', '2020-01-02', '2020-01-03'])
    expect(requestIndexMock).toHaveBeenCalledTimes(1)
    expect(requestIndexMock.mock.calls[0][0]).toMatchObject({ secid: '1.000001', beg: '19900101' })
    expect(JSON.parse(localStorage.getItem('1.000001') || '{}')['2020-01-02']).toMatchObject({ val: 3010 })

    const cached = await getIndexFundData({ code: '1.000001', range })
    expect(Object.keys(cached)).toEqual(['2020-01-01', '2020-01-02', '2020-01-03'])
    expect(requestIndexMock).toHaveBeenCalledTimes(1)
  })

  it('filters a wider cache hit to the requested range plus ten days of context', async () => {
    const cache: Record<string, any> = {}
    for (let day = 1; day <= 31; day++) {
      const date = `2020-01-${String(day).padStart(2, '0')}`
      cache[date] = { date, val: 100 + day }
    }
    localStorage.setItem('1.000001', JSON.stringify(cache))

    const result = await getIndexFundData({ code: '1.000001', range: ['2020-01-20', '2020-01-22'] })
    expect(Object.keys(result)[0]).toBe('2020-01-10')
    expect(Object.keys(result).pop()).toBe('2020-01-22')
    expect(Object.keys(result)).not.toContain('2020-01-23')
    expect(requestIndexMock).not.toHaveBeenCalled()
  })

  it('rejects an empty incremental response when cached index data does not cover a requested weekday', async () => {
    const cache = {
      '2020-01-01': { date: '2020-01-01', val: 100 },
      '2020-01-02': { date: '2020-01-02', val: 101 },
      '2020-01-03': { date: '2020-01-03', val: 102 }
    }
    localStorage.setItem('1.000001', JSON.stringify(cache))
    requestIndexMock.mockResolvedValue({ rc: 0, data: { klines: [] } })

    let coverageError: any
    try {
      await getIndexFundData({ code: '1.000001', range: ['2020-01-01', '2020-01-06'] })
    } catch (error) {
      coverageError = error
    }
    expect(coverageError).toBeInstanceOf(MarketDataCoverageError)
    expect(coverageError).toMatchObject({
      code: 'INCOMPLETE_COVERAGE',
      message: expect.stringContaining('没有可验证的市场日历')
    })
    expect(requestIndexMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem('1.000001') || '{}')).toEqual(cache)
  })

  it('accepts an empty incremental response when the only uncovered dates are a normal weekend', async () => {
    localStorage.setItem('1.000001', JSON.stringify({
      '2020-01-01': { date: '2020-01-01', val: 100 },
      '2020-01-02': { date: '2020-01-02', val: 101 },
      '2020-01-03': { date: '2020-01-03', val: 102 }
    }))
    requestIndexMock.mockResolvedValue({ rc: 0, data: { klines: [] } })

    const result = await getIndexFundData({ code: '1.000001', range: ['2020-01-01', '2020-01-05'] })
    expect(Object.keys(result)).toEqual(['2020-01-01', '2020-01-02', '2020-01-03'])
    expect(requestIndexMock).toHaveBeenCalledTimes(1)
  })

  it('recomputes cached MACD values when earlier index history is backfilled', async () => {
    localStorage.setItem('1.000001', JSON.stringify({
      '2020-01-02': { date: '2020-01-02', val: 102, ema12: 999, ema26: 999, diff: 999, dea: 999, macd: 999 },
      '2020-01-03': { date: '2020-01-03', val: 104, ema12: 999, ema26: 999, diff: 999, dea: 999, macd: 999 }
    }))
    requestIndexMock.mockResolvedValue({
      rc: 0,
      data: { klines: ['2020-01-01,100,100,100,100,1,1'] }
    })

    const result = await getIndexFundData({ code: '1.000001', range: ['2019-12-31', '2020-01-03'] })
    expect(requestIndexMock.mock.calls[0][0]).toMatchObject({ beg: '20191231', end: '20200102' })
    expect(result['2020-01-02'].ema12).toBeCloseTo(100.307692, 4)
    const updatedCache = JSON.parse(localStorage.getItem('1.000001') || '{}')
    expect(updatedCache['2020-01-02'].ema12).toBeCloseTo(100.307692, 4)
  })

  it('rejects empty or malformed index payloads', async () => {
    requestIndexMock.mockResolvedValue({ rc: 0, data: { klines: [] } })
    await expect(getIndexFundData({ code: '1.000001', range: ['2020-01-01', '2020-01-02'] }))
      .rejects.toThrow('数据源没有返回行情数据')

    await expect(getIndexFundData({ code: '1.000001&evil=1', range: ['2020-01-01', '2020-01-02'] }))
      .rejects.toThrow('指数代码格式无效')
  })
})
