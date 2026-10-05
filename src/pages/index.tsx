import React, { Component } from 'react';
import styles from './index.css';
import { FundChart } from './components/fund-line'
import { SearchForm, FundFormObj } from './components/search-form'
import 'antd/dist/antd.css'
import { getFundData, FundJson, getIndexFundData, IndexFund, IndexData, txnByMacd } from '@/utils/fund-stragegy/fetch-fund-data';
import { InvestmentStrategy, InvestDateSnapshot } from '@/utils/fund-stragegy';
import Alert from 'antd/es/alert'
import Spin from 'antd/es/spin'
import moment from 'moment'
import { dateFormat, roundToFix } from '@/utils/common';

interface StrategyMarketData {
  szData: Record<string, IndexData>
  indexData: Record<string, IndexData>
}

const createInvestStrategy = (fundData: FundJson, formData: FundFormObj, opt: StrategyMarketData): InvestmentStrategy => {
  const investment = new InvestmentStrategy({
    totalAmount: formData.totalAmount + formData.purchasedFundAmount,
    salary: formData.salary,
    shangZhengData: opt.szData,
    indexData: opt.indexData,
    stop: {
      rate: 0.05,
      minAmount: 50000,
    },
    tInvest: {
      rate: 0.05,
      amount: 1000
    },
    fundJson: fundData,
    onEachDay(this: InvestmentStrategy, curDate: number) {
      const dateStr = dateFormat(curDate)
      const latestInvestment = this.latestInvestment
      const curSzIndex = this.getFundByDate(dateStr, { origin: opt.szData })
      const level = roundToFix(latestInvestment.fundAmount / latestInvestment.totalAmount, 2)
      const curReferIndex = (opt.indexData[dateStr] || {}) as any as IndexData

      if (
        level > formData.fundPosition / 100
        && curSzIndex.val > formData.shCompositeIndex
        && (!formData.sellAtTop || latestInvestment.maxAccumulatedProfit.date === latestInvestment.date)
        && (!formData.sellMacdPoint || curReferIndex.txnType === 'sell')
        && latestInvestment.profitRate > (formData.profitRate / 100 || -100)
      ) {
        const sellAmount = formData.sellUnit === 'amount'
          ? formData.sellNum
          : (formData.sellNum / 100 * latestInvestment.fundAmount).toFixed(2)
        this.sell(Number(sellAmount), dateStr)
      }

      if (formData.buyMacdPoint && curReferIndex.txnType === 'buy') {
        const buyAmount = formData.buyAmountPercent <= 100
          ? Math.round(latestInvestment.leftAmount * formData.buyAmountPercent / 100)
          : formData.buyAmountPercent
        this.buy(buyAmount, dateStr)
      }
    }
  })

  investment
    .buy(formData.purchasedFundAmount, formData.dateRange[0])
    .fixedInvest({
      fixedInvestment: {
        period: formData.period[0],
        amount: formData.fixedAmount,
        dateOrWeek: formData.period[1]
      },
      range: [dateFormat(formData.dateRange[0]), dateFormat(formData.dateRange[1])]
    })

  return investment
}

/** Shared by the automatic-strategy page and /compare; rejects instead of returning an empty backtest. */
export const runInvestmentStrategy = async (formData: FundFormObj): Promise<InvestmentStrategy> => {
  formData.referIndex = formData.referIndex || IndexFund.ShangZheng

  const [fundData, szData, referIndexData] = await Promise.all([
    getFundData(formData.fundId, formData.dateRange),
    getIndexFundData({
      code: IndexFund.ShangZheng,
      range: formData.dateRange
    }),
    getIndexFundData({
      code: formData.referIndex,
      range: formData.dateRange
    })
  ])

  if (!fundData || Object.keys(fundData.all || {}).length === 0) {
    throw new Error('基金行情为空，无法生成回测；请检查基金代码或日期范围后重试。')
  }
  if (!szData || Object.keys(szData).length === 0 || !referIndexData || Object.keys(referIndexData).length === 0) {
    throw new Error('指数行情为空，无法生成回测；请稍后重试。')
  }

  txnByMacd(Object.values(referIndexData), formData.sellMacdPoint / 100, formData.buyMacdPoint / 100)

  const earliestFundDate = new Date(Object.keys(fundData.all).pop()!)
  if (earliestFundDate.getTime() > new Date(formData.dateRange[0]).getTime()) {
    formData.dateRange[0] = moment(earliestFundDate)
  }

  const investment = createInvestStrategy(fundData, formData, {
    szData,
    indexData: referIndexData
  })
  if (!investment.data || investment.data.length === 0) {
    throw new Error('所选日期范围没有生成回测数据，请调整日期后重试。')
  }
  return investment
}

export default class App extends Component<{}, {
  fundData: InvestDateSnapshot[]
  loading: boolean
  error: string
}> {
  state = {
    fundData: [] as InvestDateSnapshot[],
    loading: false,
    error: ''
  }

  /** Existing automatic-strategy page: expose a retryable error rather than an unhandled rejection. */
  getFundData = async (formData: FundFormObj) => {
    if (this.state.loading) {
      return null
    }
    this.setState({ fundData: [], loading: true, error: '' })
    try {
      const investment = await runInvestmentStrategy(formData)
      this.setState({ fundData: investment.data, error: '' })
      return investment
    } catch (error) {
      const message = error && typeof error.message === 'string'
        ? error.message
        : '行情读取失败，请检查网络后重试。'
      this.setState({ fundData: [], error: message })
      return null
    } finally {
      this.setState({ loading: false })
    }
  }

  render() {
    const { fundData, loading, error } = this.state
    return (
      <div className={styles.normal}>
        <SearchForm onSearch={this.getFundData} loading={loading} />
        {error ? <Alert type="error" showIcon message="行情读取失败" description={error} /> : null}
        {loading ? <Spin tip="正在读取行情并运行策略…" /> : null}
        {fundData.length > 0 ? <FundChart data={fundData} /> : null}
      </div>
    );
  }
}
