

import { dateFormat, hasOnlyWeekendDates, isWeekendDate, roundToFix } from '../common'
import { loadFundHistoryScript, MarketDataCoverageError, MarketDataError, requestIndexKlines, requestJSONP } from './market-api'

const eastmoneyFundDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

/**
 * macd 买卖临界点
 */
interface ThresholdItem {
  /**
   * 当前波段的峰值
   */ 
  maxVal: number 
  /**
   * 临界点的 index
   */
  threshold: number 
}

export interface FundDataItem {
  date: string
  val: number
  // accumulatedVal: number
  // growthRate: number
  bonus: number
  isBonusPortion?: boolean // FHSP: "每份基金份额折算1.020420194份"
  unitMoney?: string

}

export interface FundJson {
  all: Record<string, FundDataItem>
  bonus: Record<string, FundDataItem>,
}

/**
 * 上证指数数据
 */
// export type ShangZhengData = Record<string, Pick< FundDataItem, 'date'|'val'>>

/**
 * 拉取数据, 260108
 */
export const getFundData = async (fundCodeInput: string | number, size: number | [any, any]): Promise<FundJson> => {
  let fundCode = String(fundCodeInput).trim()
  if (/^\d{1,6}$/.test(fundCode)) {
    fundCode = fundCode.padStart(6, '0')
  }
  if (!/^\d{6}$/.test(fundCode)) {
    throw new MarketDataError('基金净值', '基金代码必须为 6 位数字')
  }

  let requestedRecords: number
  if (Array.isArray(size)) {
    const startTime = new Date(size[0]).getTime()
    const endTime = new Date(size[1]).getTime()
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
      throw new MarketDataError('基金净值', '所选日期范围无效')
    }
    requestedRecords = Math.floor((endTime - startTime) / 86400000)
  } else {
    requestedRecords = Math.floor(Number(size))
  }
  if (!Number.isFinite(requestedRecords) || requestedRecords < 0) {
    throw new MarketDataError('基金净值', '请求的历史区间无效')
  }
  requestedRecords = Math.max(1, requestedRecords)

  const historyVal = await loadFundHistoryScript(fundCode)
  const selectedHistory = historyVal.slice(-requestedRecords)
  if (selectedHistory.length === 0) {
    throw new MarketDataError('基金净值', '没有可用于所选区间的历史净值')
  }

  const formatResult: FundJson = { all: {}, bonus: {} }
  selectedHistory.slice().reverse().forEach((item: any) => {
    const timestamp = Number(item && item.x)
    const value = Number(item && item.y)
    if (!Number.isFinite(timestamp) || !Number.isFinite(value) || value <= 0) {
      throw new MarketDataError('基金净值', '历史净值响应格式无效')
    }

    const timestampDate = new Date(timestamp)
    if (!Number.isFinite(timestampDate.getTime())) {
      throw new MarketDataError('基金净值', '历史净值日期格式无效')
    }

    const unitMoney = typeof item.unitMoney === 'string' ? item.unitMoney : ''
    const matchResult = unitMoney.match(/\d+(?:\.\d+)?/)
    const curFundObj: FundDataItem = {
      // Eastmoney's x represents the China/Shanghai calendar date; UTC and the
      // user's local date can both be the previous day for this timestamp.
      date: eastmoneyFundDateFormatter.format(timestampDate),
      val: value,
      bonus: matchResult ? Number(matchResult[0]) : 0,
      unitMoney
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(curFundObj.date)) {
      throw new MarketDataError('基金净值', '历史净值日期格式无效')
    }

    formatResult.all[curFundObj.date] = curFundObj
    if (curFundObj.bonus) {
      formatResult.bonus[curFundObj.date] = curFundObj
      if (unitMoney.indexOf('拆分') === 0 || unitMoney.indexOf('折算') === 0) {
        curFundObj.isBonusPortion = true
      }
    }
  })

  if (Object.keys(formatResult.all).length === 0) {
    throw new MarketDataError('基金净值', '没有可用于回测的历史净值')
  }
  if (Array.isArray(size)) {
    const availableDates = Object.keys(formatResult.all).sort()
    const latestDate = availableDates[availableDates.length - 1]
    const requestedEnd = dateFormat(size[1])
    const latestDateObj = new Date(`${latestDate}T00:00:00Z`)
    latestDateObj.setUTCDate(latestDateObj.getUTCDate() + 1)
    const firstUncoveredDate = latestDateObj.toISOString().slice(0, 10)
    if (requestedEnd > latestDate && !hasOnlyWeekendDates(firstUncoveredDate, requestedEnd)) {
      throw new MarketDataCoverageError('基金净值', dateFormat(size[0]), requestedEnd, latestDate)
    }
  }
  return formatResult
}


export enum IndexFund {
  ShangZheng = '1.000001',
}

/**
 * 指数数据
 */
export interface IndexData {
  date: string
  val: number
  ema12: number
  ema26: number
  diff: number
  // ema9: number 
  dea: number // dea = ema(diff, 9)
  macd: number

  macdPosition: number // 当前 macd 百分位
  index?: number // 下标
  
  txnType?: 'buy'|'sell'
}

const readIndexCache = (code: string): Record<string, IndexData> => {
  try {
    const raw = localStorage.getItem(code)
    if (!raw) {
      return {}
    }
    const cache = JSON.parse(raw)
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
      localStorage.removeItem(code)
      return {}
    }
    const valid = Object.keys(cache).every(date => {
      const item = cache[date]
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && item && Number.isFinite(Number(item.val))
    })
    if (!valid) {
      localStorage.removeItem(code)
      return {}
    }
    return cache
  } catch (error) {
    return {}
  }
}

const writeIndexCache = (code: string, value: Record<string, IndexData>) => {
  try {
    localStorage.setItem(code, JSON.stringify(value))
  } catch (error) {
    // The cache is an optimization; private-browsing/storage failures must not
    // turn a successful market-data response into a failed backtest.
  }
}

const resetIndexIndicators = (data: Record<string, IndexData>) => {
  Object.keys(data).forEach(date => {
    const item = data[date] as any
    delete item.ema12
    delete item.ema26
    delete item.diff
    delete item.dea
    delete item.macd
    delete item.macdPosition
    delete item.txnType
    delete item.index
  })
}

const filterIndexData = (
  data: Record<string, IndexData>,
  rangeStart: number,
  rangeEnd: number
): Record<string, IndexData> => {
  const firstDate = dateFormat(rangeStart - 10 * 24 * 3600 * 1000)
  const lastDate = dateFormat(rangeEnd)
  const rangedData: Record<string, IndexData> = {}
  Object.keys(data).forEach(date => {
    if (date >= firstDate && date <= lastDate) {
      rangedData[date] = data[date]
    }
  })
  if (Object.keys(rangedData).length === 0) {
    throw new MarketDataError('指数行情', '所选日期范围内没有行情数据')
  }
  return rangedData
}

const EMA = (close: number, days: number, opt: {
  previousDate?: string,
  curDate: string,
  data: Record<string, IndexData>
}): number => {

  const { previousDate, curDate } = opt
  // 如果是首日上市价，那么初始 ema 为首日收盘价
  if (!previousDate) {
    return opt.data[curDate].val
  }
  const field = days === 9 ? `dea` : `ema${days}`
  const previousEMA = Number(opt.data[previousDate][field])

  return (2 * close + (days - 1) * previousEMA) / (days + 1)
}


/**
 * 计算 macd 百分位
 * @param indexData - 指数数据 
 */
const calcMacdPosition = (indexData: IndexData[])=>{
  let indexDataGroups: IndexData[][] = []
  indexData.reduce((previousItem, curItem)=>{
    const isSameSide = previousItem.macd * curItem.macd
    if(previousItem.macd === 0) {
      indexDataGroups.push([curItem])
      return curItem
    }

    if(isSameSide < 0) {
      // 不同边的 macd 时，创建一个新的 group
      indexDataGroups.push([curItem])
    } else {
      // 同一边的 macd
      indexDataGroups[indexDataGroups.length - 1].push(curItem) 
    }
    
    return curItem
  })
  
  // 第一天的 macd 是 0
  indexData[0].macdPosition = 0

  indexDataGroups.forEach((curIndexGroup)=>{
    const maxMacd = Math.max(...curIndexGroup.map(item => Math.abs(item.macd)))
    curIndexGroup.forEach(item => {
      const position = Math.abs(item.macd) / maxMacd
      item.macdPosition = roundToFix(position)
    })
  })
}

/**
 * 计算 macd 值
 * @param indexDataMap 源数据 map 值
 */
export const calcMACD = (indexDataMap: Record<string, IndexData>) => {
  const indexList = Object.values(indexDataMap)

  indexList.forEach((item, index) => {
    const curObj = item
    if (curObj.ema12 || curObj.ema12 === 0) {
      return
    }
    const previousDate = indexList[index - 1] ? indexList[index - 1].date : undefined
    curObj.ema12 = EMA(curObj.val, 12, {
      previousDate,
      curDate: curObj.date,
      data: indexDataMap
    })
    curObj.ema26 = EMA(curObj.val, 26, {
      previousDate,
      curDate: curObj.date,
      data: indexDataMap
    })

    curObj.diff = curObj.ema12 - curObj.ema26
    curObj.dea = previousDate ? EMA(curObj.diff, 9, {
      previousDate,
      curDate: curObj.date,
      data: indexDataMap
    }) : 0
    curObj.macd = 2 * (curObj.diff - curObj.dea)
  })

  calcMacdPosition(indexList)

  return indexDataMap
}

/**
 * 根据 macd 计算出交易点
 * @param indexData 指数数据
 * @param position 交易 macd 位置
 */
export const txnByMacd = (indexData: IndexData[], sellPosition: number, buyPosition: number ) =>{
  
  
  indexData[0].index = 0 

  let indexDataGroups: IndexData[][] = [[indexData[0]]]
  indexData.reduce((previousItem, curItem, curIndex)=>{
    curItem.index = curIndex
    const isSameSide = previousItem.macd * curItem.macd
     
    if(isSameSide < 0) {
      // 不同边的 macd 时，创建一个新的 group
      indexDataGroups.push([curItem])
    } else {
      // 同一边的 macd
       
      indexDataGroups[indexDataGroups.length - 1].push(curItem) 
    }
    
    return curItem
  })

  // const buy: Record<string, IndexData> = {}
  // const sell: Record<string, IndexData> = {}
  
  // 对分组后的 indexData 迭代
  indexDataGroups.forEach(curIndexList => {
    // const maxMacdIndexObj = curIndexList.find(indexObj => indexObj.macdPosition === 1)
    // if(!maxMacdIndexObj) {
    //   return 
    // }
    const isPositiveMacd = curIndexList[0].macd > 0
    // 如果是 正的 macd，但是没有 卖出macd临界点
    // 或者是 负的 macd，但是没有 买入macd临界点
    // 那么就没有必要计算 macd 临界点
    if((isPositiveMacd && !sellPosition) || (!isPositiveMacd && !buyPosition)) {
      return 
    }
     
    // TODO: 多峰谷，会有多个 buySellIndex 买卖点
    // 迭代，比较max 值，如果是小于 0.75max, 出现第一个 buySellIndex， 此后的 小于 max 值的数据不予理会
    // 若此后的macd 再次出现 大于 max 的 macd 值，更新 max 值，后面如果出现小于 0.75max, 出现第二个 buySellIndex，依次类推

    // 临界点列表
    const thresholdPoints = curIndexList.reduce<ThresholdItem[]>((result, cur)=>{
      const latestThreshold = result[result.length - 1]
      const curMacdVal = Math.abs(cur.macd)
      // 如果出现了新峰值, 
      if(
        curMacdVal >= latestThreshold.maxVal
        ) {
        // 且之前的前峰值有临界点，则添加新的买卖点
        if(latestThreshold.threshold !== -1) {
          result.push({
            maxVal: curMacdVal,
            threshold: -1
          })
        } else {
          // 否则更新峰值
          latestThreshold.maxVal = curMacdVal
        }
        
      }

      // 卖出策略
      if(isPositiveMacd 
        && curMacdVal <= latestThreshold.maxVal * sellPosition // 到达临界点百分位
        && latestThreshold.threshold === -1 // 该临界点还未赋值，还未被赋值
        ) {
        latestThreshold.threshold = cur.index!
      }
      // 买入策略
      if(
        !isPositiveMacd
        && curMacdVal <= latestThreshold.maxVal * buyPosition // 到达临界点百分位
        && latestThreshold.threshold === -1 // 该临界点还未赋值，还未被赋值
      ) {
        latestThreshold.threshold = cur.index!
      }
      

      return result
    }, [{
      maxVal: 0,
      threshold: -1
    }])

    const lastThresholdPoint = thresholdPoints[thresholdPoints.length - 1]
    // 如果该波段没有临界点，那么临界点即为 黄金/死亡交叉点
    if(lastThresholdPoint.threshold === -1) {
      lastThresholdPoint.threshold = curIndexList[curIndexList.length - 1].index! + 1
    }

    // const buySellIndex = greaterIndexList[greaterIndexList.length - 1].index! + 1
    console.log('临界点', thresholdPoints)
    thresholdPoints.forEach(item =>{
      const buySellIndex = item.threshold
      // 如果不存在
      if(!indexData[buySellIndex]) {
        return 
      }

      // 默认 greaterIndexList 是连续的，
      if(isPositiveMacd) {
        // 上涨行情， macdPosition 大于 xxx 的倒数第一个值，该值就是卖出点
        indexData[buySellIndex].txnType = 'sell'
        // sell[indexData[buySellIndex].date] = indexData[buySellIndex]

      } else {
        // 同理，在下跌行情中，macdPosition 大于 50% 的倒数第一个值，该值就是买入点
        indexData[buySellIndex].txnType = 'buy'
        // buy[indexData[buySellIndex].date] = indexData[buySellIndex]
      }
    })
  })

  // return {
  //   buy,
  //   sell
  // }
  
}



/**
 * 获取指数基金
 * */
export const getIndexFundData = async (opt: {
  code: string,
  range: [number | string, number | string]
}) => {
  const code = String(opt.code).trim()
  if (!/^\d+\.\d+$/.test(code)) {
    throw new MarketDataError('指数行情', '指数代码格式无效')
  }

  const rangeStart = new Date(opt.range[0]).getTime()
  const rangeEnd = new Date(opt.range[1]).getTime()
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd < rangeStart) {
    throw new MarketDataError('指数行情', '所选日期范围无效')
  }

  let [start, end] = opt.range.map(item => dateFormat(item))
  const savedData = readIndexCache(code)
  const dateList = Object.keys(savedData).sort()
  const [savedStart, savedEnd] = [dateList[0], dateList[dateList.length - 1]]
  let shouldFetch = true
  if (dateList.length > 0) {
    if (rangeStart >= new Date(savedStart).getTime() && rangeEnd <= new Date(savedEnd).getTime()) {
      shouldFetch = false
    } else {
      if (rangeStart >= new Date(savedStart).getTime()) {
        start = savedEnd
      }
      if (rangeEnd <= new Date(savedEnd).getTime()) {
        end = savedStart
      }
    }
  } else {
    start = '1990-01-01'
    end = dateFormat(Date.now())
  }

  const indexFundData: Record<string, IndexData> = {}
  if (shouldFetch) {
    const response = await requestIndexKlines({
      secid: code,
      fields1: 'f1,f2,f3,f4,f5',
      fields2: 'f51,f52,f53,f54,f55,f56,f57',
      klt: '101',
      fqt: '0',
      beg: start.replace(/-/g, ''),
      end: end.replace(/-/g, ''),
      ut: 'fa5fd1943c7b386f172d6893dbfba10b'
    })
    const list = response && response.data && response.data.klines
    if (!response || response.rc !== 0 || !Array.isArray(list)) {
      throw new MarketDataError('指数行情', '数据源响应结构无效')
    }
    if (list.length === 0 && Object.keys(savedData).length === 0) {
      throw new MarketDataError('指数行情', '数据源没有返回行情数据')
    }

    list.forEach((line: string) => {
      if (typeof line !== 'string') {
        throw new MarketDataError('指数行情', '行情记录格式无效')
      }
      const columns = line.split(',')
      const date = columns[0]
      const value = Number(columns[2])
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || value <= 0) {
        throw new MarketDataError('指数行情', '行情记录日期或收盘价无效')
      }
      indexFundData[date] = { date, val: value } as IndexData
    })
  }

  let mergedData: Record<string, IndexData> = {
    ...savedData,
    ...indexFundData
  }
  const sortedDates = Object.keys(mergedData).sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  mergedData = sortedDates.reduce((result, date) => {
    result[date] = mergedData[date]
    return result
  }, {} as Record<string, IndexData>)
  if (sortedDates.length === 0) {
    throw new MarketDataError('指数行情', '没有可用于回测的行情数据')
  }

  const requestedStart = dateFormat(rangeStart)
  const requestedEnd = dateFormat(rangeEnd)
  const lastAvailable = sortedDates[sortedDates.length - 1]
  if (requestedEnd > lastAvailable) {
    const firstUncovered = new Date(`${lastAvailable}T00:00:00Z`)
    firstUncovered.setUTCDate(firstUncovered.getUTCDate() + 1)
    if (!hasOnlyWeekendDates(firstUncovered.toISOString().slice(0, 10), requestedEnd)) {
      throw new MarketDataCoverageError('指数行情', requestedStart, requestedEnd, lastAvailable)
    }
  }

  const currentDate = new Date(`${requestedStart}T00:00:00Z`)
  const endDate = new Date(`${requestedEnd}T00:00:00Z`)
  while (currentDate.getTime() <= endDate.getTime()) {
    const date = currentDate.toISOString().slice(0, 10)
    if (!isWeekendDate(date) && !Object.prototype.hasOwnProperty.call(mergedData, date)) {
      throw new MarketDataCoverageError('指数行情', requestedStart, requestedEnd, lastAvailable, date)
    }
    currentDate.setUTCDate(currentDate.getUTCDate() + 1)
  }

  resetIndexIndicators(mergedData)
  calcMACD(mergedData)
  writeIndexCache(code, mergedData)
  return filterIndexData(mergedData, rangeStart, rangeEnd)
}

/**
 * 指数信息对象
 */
export interface SearchIndexResp {
  code: string
  name: string
  id: string
}
/**
 * 指数动态查询
 */
export const searchIndex = async (input: string): Promise<SearchIndexResp[]> => {
  const query = String(input || '').trim()
  if (!query) {
    return []
  }
  if (query.length > 64) {
    throw new MarketDataError('指数搜索', '搜索词过长')
  }

  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get')
  url.searchParams.set('input', query)
  url.searchParams.set('type', '14')
  url.searchParams.set('token', 'D43BF722C8E33BDC906FB84D85E326E8')
  url.searchParams.set('markettype', '')
  url.searchParams.set('mktnum', '')
  url.searchParams.set('jys', '')
  url.searchParams.set('classify', '')
  url.searchParams.set('securitytype', '')
  url.searchParams.set('count', '5')
  url.searchParams.set('_', `${Date.now()}`)

  const response: any = await requestJSONP('指数搜索', url.toString())
  const table = response && response.QuotationCodeTable
  if (!table || !Array.isArray(table.Data)) {
    throw new MarketDataError('指数搜索', '数据源响应结构无效')
  }
  return table.Data.filter(item => item && item.Classify === 'Index'
    && typeof item.Code === 'string' && typeof item.Name === 'string')
    .map(item => ({
      code: item.Code,
      name: item.Name,
      id: String(item.QuoteID || item.ID || item.Code)
    }))
}

/**
 * 基金对象信息
 */
export interface FundInfo {
  code: string
  name: string
}
/**
 * 基金动态查询
 */
export const getFundInfo = async (key): Promise<FundInfo[]> => {
  const query = String(key || '').trim()
  if (!query) {
    return []
  }
  if (query.length > 64) {
    throw new MarketDataError('基金搜索', '搜索词过长')
  }

  const url = new URL('https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx')
  url.searchParams.set('m', '10')
  url.searchParams.set('t', '700')
  url.searchParams.set('IsNeedBaseInfo', '0')
  url.searchParams.set('IsNeedZTInfo', '0')
  url.searchParams.set('key', query)
  url.searchParams.set('_', `${Date.now()}`)

  const response: any = await requestJSONP('基金搜索', url.toString())
  if (!response || !Array.isArray(response.Datas)) {
    throw new MarketDataError('基金搜索', '数据源响应结构无效')
  }
  return response.Datas.filter(item => item && /^\d{6}$/.test(String(item.CODE || ''))
    && typeof item.NAME === 'string')
    .map(item => ({
      code: String(item.CODE),
      name: item.NAME
    }))
}
