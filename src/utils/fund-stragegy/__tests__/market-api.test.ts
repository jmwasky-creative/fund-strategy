import axios from 'axios'
import { loadFundHistoryScript, MarketDataError, requestIndexKlines, requestJSONP } from '../market-api'

describe('requestJSONP', () => {
  let appendedScript: HTMLScriptElement
  let appendSpy: jest.SpyInstance

  beforeEach(() => {
    appendedScript = undefined as any
    appendSpy = jest.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
      appendedScript = node as HTMLScriptElement
      return node
    })
  })

  afterEach(() => {
    appendSpy.mockRestore()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('rejects non-HTTPS and unapproved hosts without inserting a script', async () => {
    const endpoint = '/FundSearch/api/FundSearchAPI.ashx'
    await expect(requestJSONP('基金搜索', `http://fundsuggest.eastmoney.com${endpoint}`)).rejects.toBeInstanceOf(MarketDataError)
    await expect(requestJSONP('基金搜索', 'https://example.com/FundSearch/api/FundSearchAPI.ashx')).rejects.toBeInstanceOf(MarketDataError)
    await expect(requestJSONP('基金搜索', `https://fundsuggest.eastmoney.com:444${endpoint}`)).rejects.toBeInstanceOf(MarketDataError)
    await expect(requestJSONP('基金搜索', `https://user:pass@fundsuggest.eastmoney.com${endpoint}`)).rejects.toBeInstanceOf(MarketDataError)
    await expect(requestJSONP('基金搜索', 'https://fundsuggest.eastmoney.com/other/script.js')).rejects.toBeInstanceOf(MarketDataError)
    expect(appendSpy).not.toHaveBeenCalled()
  })

  it('encodes callback parameters and resolves a provider callback', async () => {
    const promise = requestJSONP<{ ok: boolean }>(
      '基金搜索',
      'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?key=白酒&key=ignored',
      1000
    )
    const parsedUrl = new URL(appendedScript.src)
    expect(parsedUrl.protocol).toBe('https:')
    expect(parsedUrl.hostname).toBe('fundsuggest.eastmoney.com')
    expect(parsedUrl.searchParams.get('key')).toBe('白酒')
    const callbackName = parsedUrl.searchParams.get('callback')
    expect(callbackName).toMatch(/^getJSONP\.cb\d+$/)
    expect(parsedUrl.searchParams.get('cb')).toBe(callbackName)

    const callbackKey = callbackName!.split('.')[1]
    ;(window as any).getJSONP[callbackKey]({ ok: true })
    await expect(promise).resolves.toEqual({ ok: true })
    expect((window as any).getJSONP[callbackKey]).toBeUndefined()
  })

  it('rejects a script load that never called back', async () => {
    const promise = requestJSONP('基金搜索', 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx', 1000)
    appendedScript.onload!(new Event('load'))
    await expect(promise).rejects.toMatchObject({ name: 'MarketDataError' })
  })

  it('rejects network failures and removes the JSONP callback', async () => {
    const promise = requestJSONP('指数搜索', 'https://searchapi.eastmoney.com/api/suggest/get', 1000)
    const callbackName = new URL(appendedScript.src).searchParams.get('callback')!
    const callbackKey = callbackName.split('.')[1]
    appendedScript.onerror!(new Event('error'))
    await expect(promise).rejects.toMatchObject({ name: 'MarketDataError' })
    expect((window as any).getJSONP[callbackKey]).toBeUndefined()
  })

  it('rejects stalled requests after the timeout and clears the callback', async () => {
    jest.useFakeTimers()
    const promise = requestJSONP('基金搜索', 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx', 500)
    const callbackName = new URL(appendedScript.src).searchParams.get('callback')!
    const callbackKey = callbackName.split('.')[1]
    jest.advanceTimersByTime(500)
    await expect(promise).rejects.toMatchObject({ name: 'MarketDataError' })
    expect(typeof (window as any).getJSONP[callbackKey]).toBe('function')
    ;(window as any).getJSONP[callbackKey]({ late: true })
    expect((window as any).getJSONP[callbackKey]).toBeUndefined()
  })
})

describe('requestIndexKlines', () => {
  it('uses the verified HTTPS CORS host with a bounded timeout', async () => {
    const params = { secid: '1.000001', beg: '19900101', end: '20261005' }
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: { rc: 0 } } as any)

    await expect(requestIndexKlines(params)).resolves.toEqual({ rc: 0 })
    expect(getSpy).toHaveBeenCalledWith(
      'https://60.push2his.eastmoney.com/api/qt/stock/kline/get',
      { params, timeout: 60000 }
    )
  })
})

describe('loadFundHistoryScript', () => {
  let scripts: HTMLScriptElement[]
  let appendSpy: jest.SpyInstance

  beforeEach(() => {
    scripts = []
    appendSpy = jest.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
      scripts.push(node as HTMLScriptElement)
      return node
    })
    ;(window as any).fS_code = undefined
    ;(window as any).Data_netWorthTrend = undefined
  })

  afterEach(() => {
    appendSpy.mockRestore()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('keeps the queue locked after timeout until the late script settles', async () => {
    jest.useFakeTimers()
    const first = loadFundHistoryScript('000001')
    const duplicate = loadFundHistoryScript('000001')
    const second = loadFundHistoryScript('000002')
    await Promise.resolve()

    expect(scripts).toHaveLength(1)
    expect(new URL(scripts[0].src).pathname).toBe('/pingzhongdata/000001.js')
    jest.advanceTimersByTime(30000)
    await expect(first).rejects.toMatchObject({ name: 'MarketDataError', message: expect.stringContaining('刷新页面') })
    await expect(duplicate).rejects.toMatchObject({ name: 'MarketDataError' })
    expect(scripts).toHaveLength(1)
    await expect(loadFundHistoryScript('000003')).rejects.toThrow('上一请求仍在隔离晚到响应')

    ;(window as any).fS_code = '000001'
    ;(window as any).Data_netWorthTrend = [{ x: 1, y: 1 }]
    scripts[0].onload!(new Event('load'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(scripts).toHaveLength(2)
    expect(new URL(scripts[1].src).pathname).toBe('/pingzhongdata/000002.js')
    ;(window as any).fS_code = '000002'
    ;(window as any).Data_netWorthTrend = [{ x: 2, y: 2 }]
    scripts[1].onload!(new Event('load'))
    await expect(second).resolves.toEqual([{ x: 2, y: 2 }])
    expect((window as any).fS_code).toBeUndefined()
    expect((window as any).Data_netWorthTrend).toBeUndefined()
  })
})
