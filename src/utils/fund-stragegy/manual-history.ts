import { getFundData } from './fetch-fund-data'
import { MarketDataError } from './market-api'
import { filterManualQuotes, ManualQuote } from '@/pages/manual/manual-model'

const DAY_MS = 24 * 60 * 60 * 1000

const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const date = new Date(`${value}T00:00:00`)
  return Number.isFinite(date.getTime())
    && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === value
}

const localDateString = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/**
 * Load only through the existing HTTPS-validated fund-history reader, then
 * filter by exact calendar dates. The record count is the inclusive calendar
 * span from the requested start through today, so older user-selected ranges
 * are not accidentally replaced with the newest N observations.
 */
export const loadManualHistory = async (
  fundCodeInput: string,
  startDate: string,
  endDate: string
): Promise<ManualQuote[]> => {
  const fundCode = String(fundCodeInput || '').trim()
  if (!/^\d{6}$/.test(fundCode)) {
    throw new MarketDataError('基金净值', '基金代码必须为 6 位数字')
  }
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate > endDate) {
    throw new MarketDataError('基金净值', '所选日期范围无效')
  }
  if (endDate > localDateString(new Date())) {
    throw new MarketDataError('基金净值', '结束日期不能晚于今天')
  }

  const startTime = new Date(`${startDate}T00:00:00`).getTime()
  const todayTime = new Date(`${localDateString(new Date())}T00:00:00`).getTime()
  const lookbackRecords = Math.max(1, Math.ceil((todayTime - startTime) / DAY_MS) + 2)
  const fundData = await getFundData(fundCode, lookbackRecords)
  return filterManualQuotes(fundData.all || {}, startDate, endDate)
}
