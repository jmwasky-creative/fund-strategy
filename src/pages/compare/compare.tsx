import React, { Component } from 'react'
import commonStyle from '../index.css'
import { CompareSearchForm, CompareFormObj } from './search-form'
import { CompareChart, StragegyItem } from './compare-chart'
import { allSavedCondition } from '../components/saved-search'
import { FundFormObj } from '../components/search-form'
import { runInvestmentStrategy } from '../index'
import { InvestDateSnapshot } from '@/utils/fund-stragegy'
import { roundToFix } from '@/utils/common'
import Alert from 'antd/es/alert'
import Spin from 'antd/es/spin'

export type ChartSnapshot = Pick<InvestDateSnapshot, 'totalAmount' | 'leftAmount' | 'date' | 'profit' | 'profitRate' | 'fundAmount' | 'fundGrowthRate' | 'dateBuyAmount' | 'dateSellAmount' | 'accumulatedProfit' | 'maxPrincipal' | 'totalProfitRate'> & {
  fundVal: number,
  position?: number,
  txnType?: 'buy' | 'sell' | 'fixedBuy'
  origin: InvestDateSnapshot
  name?: string
}

export default class CompareStrategyChart extends Component<{}, {
  stragegyData: StragegyItem[]
  chartList: string[]
  loading: boolean
  error: string
}> {
  state = {
    stragegyData: [] as StragegyItem[],
    chartList: [] as string[],
    loading: false,
    error: ''
  }

  handleSearch = async (formObj: CompareFormObj) => {
    if (this.state.loading) {
      return
    }
    this.setState({ stragegyData: [], chartList: [], loading: true, error: '' })
    try {
      if (!formObj.stragegyChecked || formObj.stragegyChecked.length === 0) {
        throw new Error('请至少选择一个已保存策略。')
      }

      const allChartData = await Promise.all(formObj.stragegyChecked.map(async name => {
        const savedCondition = allSavedCondition[name]
        if (!savedCondition) {
          throw new Error(`已保存策略“${name}”不存在，请重新选择。`)
        }
        const curCondition: FundFormObj = {
          ...savedCondition,
          dateRange: formObj.dateRange.slice() as [any, any]
        }
        const investment = await runInvestmentStrategy(curCondition)
        const investmentData: ChartSnapshot[] = investment.data.map(item => ({
          name,
          origin: item,
          totalAmount: item.totalAmount,
          leftAmount: item.leftAmount,
          date: item.date,
          profit: item.profit,
          profitRate: item.profitRate,
          fundAmount: item.fundAmount,
          fundVal: Number(item.curFund.val),
          fundGrowthRate: item.fundGrowthRate,
          dateBuyAmount: item.dateBuyAmount,
          dateSellAmount: item.dateSellAmount,
          accumulatedProfit: item.accumulatedProfit,
          maxPrincipal: item.maxPrincipal,
          totalProfitRate: item.totalProfitRate,
          position: roundToFix(item.fundAmount / item.totalAmount, 4)
        } as ChartSnapshot))

        if (investmentData.length === 0) {
          throw new Error(`策略“${name}”没有生成回测数据，请调整日期后重试。`)
        }
        return { name, data: investmentData }
      }))

      this.setState({
        stragegyData: allChartData,
        chartList: formObj.chartChecked || []
      })
    } catch (error) {
      this.setState({
        stragegyData: [],
        chartList: [],
        error: error && typeof error.message === 'string'
          ? error.message
          : '行情查询失败，请检查网络后重试。'
      })
    } finally {
      this.setState({ loading: false })
    }
  }

  render() {
    const { stragegyData, chartList, loading, error } = this.state
    return <div className={commonStyle.normal}>
      <CompareSearchForm onSearch={this.handleSearch} loading={loading} />
      {error ? <Alert type="error" showIcon message="策略比较失败" description={error} /> : null}
      {loading ? <Spin tip="正在读取行情并比较策略…" /> : null}
      {stragegyData.length > 0 ? <CompareChart data={stragegyData} chartList={chartList} /> : null}
    </div>
  }
}
