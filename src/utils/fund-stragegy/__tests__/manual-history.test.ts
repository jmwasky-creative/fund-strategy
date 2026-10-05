import { getFundData } from '../fetch-fund-data'
import { loadManualHistory } from '../manual-history'

jest.mock('../fetch-fund-data', () => ({
  getFundData: jest.fn()
}))

const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const getFundDataMock = getFundData as jest.Mock

describe('manual historical NAV loading', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('loads enough calendar history and filters the exact user-selected range', async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = new Date(today)
    end.setDate(end.getDate() - 5)
    const start = new Date(end)
    start.setDate(start.getDate() - 2)
    const outside = new Date(start)
    outside.setDate(outside.getDate() - 1)
    const startDate = formatDate(start)
    const endDate = formatDate(end)

    getFundDataMock.mockResolvedValue({
      all: {
        [formatDate(outside)]: { date: formatDate(outside), val: 1.00 },
        [startDate]: { date: startDate, val: 1.01 },
        [endDate]: { date: endDate, val: 1.03 }
      },
      bonus: {}
    })

    const quotes = await loadManualHistory('260108', startDate, endDate)
    const requestedRecords = Number(getFundDataMock.mock.calls[0][1])
    const daysFromStart = Math.ceil((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))

    expect(requestedRecords).toBeGreaterThanOrEqual(daysFromStart + 1)
    expect(quotes).toEqual([
      { date: startDate, val: 1.01 },
      { date: endDate, val: 1.03 }
    ])
  })

  it('rejects invalid fund codes and reversed ranges before requesting market data', async () => {
    await expect(loadManualHistory('260108&callback=bad', '2024-01-01', '2024-01-02'))
      .rejects.toThrow('基金代码必须为 6 位数字')
    await expect(loadManualHistory('260108', '2024-01-03', '2024-01-02'))
      .rejects.toThrow('所选日期范围无效')
    expect(getFundDataMock).not.toHaveBeenCalled()
  })
})
