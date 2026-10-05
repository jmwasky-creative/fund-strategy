import axios from 'axios'

/**
 * Public market-data services are an explicit trust boundary: JSONP and the
 * Eastmoney fund-history script execute code in the page. Only fixed HTTPS
 * origins and locally validated parameters may be used; never pass user URLs
 * or credentials to these loaders. Every returned payload is validated again
 * by the calling API adapter before it reaches a strategy.
 */
export class MarketDataError extends Error {
  source: string

  constructor(source: string, reason: string) {
    super(`${source}读取失败：${reason}，请检查网络后重试。`)
    this.name = 'MarketDataError'
    this.source = source
  }
}

/** A successful response can still leave the requested market-data range uncovered. */
export class MarketDataCoverageError extends Error {
  source: string
  code: string

  constructor(source: string, requestedStart: string, requestedEnd: string, lastAvailableDate?: string) {
    super(
      `${source}覆盖状态未确认：请求 ${requestedStart} 至 ${requestedEnd}`
      + `${lastAvailableDate ? `，最后可用行情为 ${lastAvailableDate}` : ''}`
      + '。缺失日期可能是周末/假期休市或数据遗漏；当前没有可验证的市场日历，因此停止回测而不沿用前值。请核对日期范围，或在行情更新后重试。'
    )
    this.name = 'MarketDataCoverageError'
    this.source = source
    this.code = 'INCOMPLETE_COVERAGE'
  }
}

const JSONP_ENDPOINTS: Record<string, string> = {
  'https://searchapi.eastmoney.com': '/api/suggest/get',
  'https://fundsuggest.eastmoney.com': '/FundSearch/api/FundSearchAPI.ashx'
}
const FUND_SCRIPT_HOST = 'fund.eastmoney.com'
const REQUEST_TIMEOUT_MS = 30000
const INDEX_TIMEOUT_MS = 60000

let fundScriptQueue: Promise<void> = Promise.resolve()
let fundScriptBlocked = false
const pendingFundScripts: Record<string, Promise<any[]>> = {}

/**
 * Load Eastmoney JSONP from a fixed HTTPS origin. JSONP executes the provider's
 * response as script, so callers must validate the returned structure.
 */
export const requestJSONP = <T>(source: string, url: string, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> => {
  let requestUrl: URL
  try {
    requestUrl = new URL(url)
  } catch (error) {
    return Promise.reject(new MarketDataError(source, '数据源地址无效'))
  }

  const expectedPath = JSONP_ENDPOINTS[requestUrl.origin]
  if (
    requestUrl.protocol !== 'https:'
    || !expectedPath
    || requestUrl.username
    || requestUrl.password
    || requestUrl.pathname !== expectedPath
    || requestUrl.hash
  ) {
    return Promise.reject(new MarketDataError(source, '数据源未通过 HTTPS 安全校验'))
  }

  return new Promise<T>((resolve, reject) => {
    const browserWindow = window as any
    let callbackRoot = browserWindow.getJSONP
    if (!callbackRoot || (typeof callbackRoot !== 'object' && typeof callbackRoot !== 'function')) {
      callbackRoot = function() {}
      browserWindow.getJSONP = callbackRoot
    }

    const callbackNumber = Number(callbackRoot.counter || 0)
    callbackRoot.counter = callbackNumber + 1
    const callbackKey = `cb${callbackNumber}`
    const callbackName = `getJSONP.${callbackKey}`
    requestUrl.searchParams.set('callback', callbackName)
    requestUrl.searchParams.set('cb', callbackName)

    const script = document.createElement('script')
    script.async = true
    script.referrerPolicy = 'no-referrer'
    let settled = false
    let timer: number

    const cleanup = (keepLateCallback: boolean = false) => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timer)
      if (keepLateCallback) {
        // A slow provider may execute its script after the caller has timed
        // out. Keep a temporary no-op so the late JSONP call cannot throw.
        callbackRoot[callbackKey] = () => { delete callbackRoot[callbackKey] }
        window.setTimeout(() => { delete callbackRoot[callbackKey] }, 60000)
      } else {
        delete callbackRoot[callbackKey]
      }
      script.onload = null
      script.onerror = null
      if (script.parentNode) {
        script.parentNode.removeChild(script)
      }
    }

    const fail = (reason: string, keepLateCallback: boolean = false) => {
      cleanup(keepLateCallback)
      reject(new MarketDataError(source, reason))
    }

    callbackRoot[callbackKey] = (response: T) => {
      if (response === undefined || response === null) {
        fail('数据源返回空响应')
        return
      }
      cleanup()
      resolve(response)
    }

    script.onload = () => {
      if (!settled) {
        fail('响应格式无效或缺少 JSONP 回调')
      }
    }
    script.onerror = () => fail('网络请求失败')
    timer = window.setTimeout(() => fail('请求超时', true), timeoutMs)
    script.src = requestUrl.toString()

    const mount = document.head || document.body
    if (!mount) {
      fail('页面尚未准备好，请重试')
      return
    }
    try {
      mount.appendChild(script)
    } catch (error) {
      fail('无法加载数据脚本')
    }
  })
}

/**
 * Eastmoney's static fund-history endpoint serves executable JavaScript rather
 * than CORS-enabled JSON. Serialize loads because its legacy response writes
 * shared globals (fS_code/Data_netWorthTrend), and snapshot them before the
 * next script can execute. The API host is fixed and the six-digit code is
 * validated by the caller and again here.
 */
export const loadFundHistoryScript = (fundCode: string): Promise<any[]> => {
  if (!/^\d{6}$/.test(fundCode)) {
    return Promise.reject(new MarketDataError('基金净值', '基金代码格式无效'))
  }
  if (pendingFundScripts[fundCode]) {
    return pendingFundScripts[fundCode]
  }
  if (fundScriptBlocked) {
    return Promise.reject(new MarketDataError('基金净值', '上一请求仍在隔离晚到响应；请等待后重试或刷新页面'))
  }

  const load = () => {
    let releaseQueue: () => void = () => undefined
    const terminalPromise = new Promise<void>(resolve => { releaseQueue = resolve })
    let resolveResult: (history: any[]) => void = () => undefined
    let rejectResult: (error: Error) => void = () => undefined
    const resultPromise = new Promise<any[]>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    let script: HTMLScriptElement | undefined
    let timer: number = 0
    let resultSettled = false
    let terminalSettled = false
    const browserWindow = window as any

    const finishTerminal = () => {
      if (terminalSettled) {
        return
      }
      terminalSettled = true
      window.clearTimeout(timer)
      if (script) {
        script.onload = null
        script.onerror = null
        if (script.parentNode) {
          script.parentNode.removeChild(script)
        }
      }
      browserWindow.fS_code = undefined
      browserWindow.Data_netWorthTrend = undefined
      fundScriptBlocked = false
      releaseQueue()
    }

    const fail = (reason: string) => {
      if (!resultSettled) {
        resultSettled = true
        rejectResult(new MarketDataError('基金净值', reason))
      }
      finishTerminal()
    }

    try {
      const requestUrl = new URL(`/pingzhongdata/${fundCode}.js`, `https://${FUND_SCRIPT_HOST}`)
      requestUrl.searchParams.set('v', `${Date.now()}`)
      browserWindow.fS_code = undefined
      browserWindow.Data_netWorthTrend = undefined

      script = document.createElement('script')
      script.async = true
      script.referrerPolicy = 'no-referrer'
      script.onload = () => {
        if (resultSettled) {
          // The caller already timed out. Discard this late response and only
          // release the queue after the shared globals can no longer change.
          finishTerminal()
          return
        }
        const responseCode = String(browserWindow.fS_code || '')
        const history = browserWindow.Data_netWorthTrend
        if (responseCode !== fundCode) {
          fail('数据源返回的基金代码不匹配')
          return
        }
        if (!Array.isArray(history) || history.length === 0) {
          fail('没有可用的历史净值数据')
          return
        }
        const snapshot = history.slice()
        resultSettled = true
        finishTerminal()
        resolveResult(snapshot)
      }
      script.onerror = () => fail('网络请求失败')
      timer = window.setTimeout(() => {
        if (resultSettled) {
          return
        }
        resultSettled = true
        fundScriptBlocked = true
        rejectResult(new MarketDataError('基金净值', '请求超时；为避免晚到脚本覆盖共享数据，请刷新页面后重试'))
        // Keep handlers and the serialized queue gate until this script fires
        // load/error; removing it can suppress the only terminal signal.
      }, REQUEST_TIMEOUT_MS)
      script.src = requestUrl.toString()

      const mount = document.head || document.body
      if (!mount) {
        fail('页面尚未准备好，请重试')
      } else {
        mount.appendChild(script)
      }
    } catch (error) {
      fail('无法加载数据脚本')
    }

    return { resultPromise, terminalPromise }
  }

  const queued = fundScriptQueue.then(load)
  const result = queued.then(({ resultPromise }) => resultPromise)
  fundScriptQueue = queued.then(
    ({ terminalPromise }) => terminalPromise,
    () => undefined
  ).then(() => undefined, () => undefined)
  pendingFundScripts[fundCode] = result
  result.then(
    () => { delete pendingFundScripts[fundCode] },
    () => { delete pendingFundScripts[fundCode] }
  )
  return result
}

export interface IndexKlineResponse {
  rc?: number
  data?: {
    klines?: string[]
  }
}

/** The kline endpoint advertises Access-Control-Allow-Origin: *, so use HTTPS XHR instead of JSONP. */
export const requestIndexKlines = async (params: Record<string, string>): Promise<IndexKlineResponse> => {
  try {
    const response = await axios.get<IndexKlineResponse>('https://60.push2his.eastmoney.com/api/qt/stock/kline/get', {
      params,
      timeout: INDEX_TIMEOUT_MS
    })
    return response.data
  } catch (error) {
    const message = error && error.code === 'ECONNABORTED' ? '请求超时' : '网络请求失败'
    throw new MarketDataError('指数行情', message)
  }
}
