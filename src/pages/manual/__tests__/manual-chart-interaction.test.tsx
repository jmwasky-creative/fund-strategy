import React from 'react'
import renderer, { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer'
import ManualBacktestPage from '..'
import { ManualQuote } from '../manual-model'

jest.mock('@/utils/fund-stragegy/manual-history', () => ({ loadManualHistory: jest.fn() }))

jest.mock('antd/es/alert', () => {
  const ReactModule = require('react')
  return { __esModule: true, default: (props: any) => ReactModule.createElement('div', null, props.message, props.description) }
})
jest.mock('antd/es/button', () => {
  const ReactModule = require('react')
  return {
    __esModule: true,
    default: (props: any) => ReactModule.createElement('button', {
      type: 'button',
      disabled: props.disabled,
      onClick: props.onClick
    }, props.children)
  }
})
jest.mock('antd/es/card', () => {
  const ReactModule = require('react')
  return { __esModule: true, default: (props: any) => ReactModule.createElement('section', null, props.children) }
})
jest.mock('antd/es/input', () => {
  const ReactModule = require('react')
  return { __esModule: true, default: (props: any) => ReactModule.createElement('input', props) }
})
jest.mock('antd/es/modal', () => ({ __esModule: true, default: () => null }))
jest.mock('antd/es/select', () => {
  const ReactModule = require('react')
  const SelectMock: any = (props: any) => ReactModule.createElement('select', null, props.children)
  SelectMock.Option = (props: any) => ReactModule.createElement('option', { value: props.value }, props.children)
  return { __esModule: true, default: SelectMock }
})
jest.mock('antd/es/spin', () => {
  const ReactModule = require('react')
  return { __esModule: true, default: (props: any) => ReactModule.createElement('div', null, props.tip) }
})
jest.mock('antd/dist/antd.css', () => ({}))
jest.mock('../index.css', () => new Proxy({}, { get: (_target: any, property: string) => property }))

const createDenseQuotes = (): ManualQuote[] => {
  const dates: string[] = []
  const current = new Date(Date.UTC(2025, 0, 1))
  while (dates.length < 241) {
    const weekday = current.getUTCDay()
    if (weekday !== 0 && weekday !== 6) {
      dates.push(current.toISOString().slice(0, 10))
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates.map((date, index) => ({
    date,
    val: date === '2025-11-10' || date === '2025-11-11'
      ? 1.121
      : 1.1 + index * 0.00008 + Math.sin(index / 9) * 0.0004
  }))
}

const buttonByText = (tree: ReactTestRenderer, text: string): ReactTestInstance => tree.root
  .findAllByType('button')
  .filter(button => button.children.join('').indexOf(text) !== -1)[0]

const renderedText = (instance: any): string => {
  if (typeof instance === 'string' || typeof instance === 'number') {
    return String(instance)
  }
  if (!instance || !instance.children) {
    return ''
  }
  return instance.children.map(renderedText).join('')
}

const invalidChartPoints = (tree: ReactTestRenderer): ReactTestInstance[] => tree.root.findAllByType('g').filter(point =>
  point.props.role === 'img' && String(point.props['aria-label']).indexOf('校验提示') >= 0
)

const flushReplayTimers = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    jest.runOnlyPendingTimers()
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve()
    }
  }
}

const setReadyReplayState = (page: any) => page.setState({
  draftFundCode: '260108',
  draftStartDate: '2024-01-02',
  draftEndDate: '2024-01-03',
  activeQuery: { fundCode: '260108', startDate: '2024-01-02', endDate: '2024-01-03' },
  quotes: [
    { date: '2024-01-02', val: 1.02 },
    { date: '2024-01-03', val: 1.03 }
  ],
  signals: [{ id: 1, date: '2024-01-02', type: 'buy' }],
  selectedDate: '2024-01-02',
  nextSignalId: 2,
  replayConfig: {
    initialCash: '1000',
    buyAmount: '500',
    buyFeeRatePercent: '0',
    sellFeeRatePercent: '0',
    buySlippageRatePercent: '0',
    sellSlippageRatePercent: '0'
  }
})

const manualHistoryMock = require('@/utils/fund-stragegy/manual-history').loadManualHistory as jest.Mock

afterEach(() => {
  jest.useRealTimers()
  manualHistoryMock.mockReset()
})

describe('manual chart date selection', () => {
  it('asks before resolving overlapping 2025-11-10 and 2025-11-11 markers, then preserves signal editing', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes = createDenseQuotes()
    page.setState({
      activeQuery: { fundCode: '260108', startDate: quotes[0].date, endDate: quotes[quotes.length - 1].date },
      quotes,
      signals: [],
      selectedDate: '2025-11-07',
      chartDateChoices: [],
      selectedSignalId: null,
      nextSignalId: 1,
      undo: null
    })

    const selectedMarker = tree.root.findAllByType('circle').filter(marker =>
      marker.props['aria-label'] === '选择净值日期 2025-11-10，单位净值 1.1210'
    )[0]
    const chart = tree.root.findAllByType('svg').filter(svg => svg.props['aria-label'])[0]
    const chartSvg = {
      getScreenCTM: () => ({ inverse: () => ({ scale: 1 / 0.75, translateX: -40 / 0.75, translateY: -15 / 0.75 }) }),
      createSVGPoint: () => {
        const pointer: any = { x: 0, y: 0 }
        pointer.matrixTransform = (matrix: any) => ({
          x: pointer.x * matrix.scale + matrix.translateX,
          y: pointer.y * matrix.scale + matrix.translateY
        })
        return pointer
      }
    }

    chart.props.onClick({
      nativeEvent: { detail: 1 },
      currentTarget: chartSvg,
      clientX: selectedMarker.props.cx * 0.75 + 40,
      clientY: selectedMarker.props.cy * 0.75 + 15
    })

    expect(page.state.selectedDate).toBe('2025-11-07')
    expect(page.state.chartDateChoices).toEqual(expect.arrayContaining(['2025-11-10', '2025-11-11']))
    expect(buttonByText(tree, '2025-11-10 · 净值 1.1210')).toBeTruthy()
    expect(buttonByText(tree, '2025-11-11 · 净值 1.1210')).toBeTruthy()
    expect(buttonByText(tree, '添加买入点').props.disabled).toBe(true)

    buttonByText(tree, '2025-11-10 · 净值 1.1210').props.onClick()
    expect(page.state.selectedDate).toBe('2025-11-10')
    expect(page.state.selectedDate).not.toBe('2025-11-11')
    expect(page.state.chartDateChoices).toEqual([])

    buttonByText(tree, '添加买入点').props.onClick()
    buttonByText(tree, '添加卖出点').props.onClick()
    expect(page.state.signals.map((signal: any) => [signal.date, signal.type])).toEqual([
      ['2025-11-10', 'buy'],
      ['2025-11-10', 'sell']
    ])

    buttonByText(tree, '移除').props.onClick({ stopPropagation: jest.fn() })
    expect(page.state.signals).toHaveLength(1)
    buttonByText(tree, '撤销最近一次点位操作').props.onClick()
    expect(page.state.signals).toHaveLength(2)
    expect(page.state.signals[1].type).toBe('sell')

    tree.unmount()
  })

  it('keeps the selected date when clicking its rendered marker stroke beside an equal-NAV neighbor', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes = createDenseQuotes()
    page.setState({
      activeQuery: { fundCode: '260108', startDate: quotes[0].date, endDate: quotes[quotes.length - 1].date },
      quotes,
      signals: [],
      selectedDate: '2025-11-10',
      chartDateChoices: [],
      selectedSignalId: null,
      nextSignalId: 1,
      undo: null
    })

    const selectedMarker = tree.root.findAllByType('circle').filter(marker =>
      marker.props['aria-label'] === '选择净值日期 2025-11-10，单位净值 1.1210'
    )[0]
    const selectedRing = tree.root.findAllByType('circle').filter(marker =>
      marker.props.cx === selectedMarker.props.cx && marker.props.cy === selectedMarker.props.cy
        && marker.props.r === 9
    )[0]
    const chart = tree.root.findAllByType('svg').filter(svg => svg.props['aria-label'])[0]
    const screenScale = 0.75
    const clickOffset = 5.2
    const chartSvg = {
      getScreenCTM: () => ({
        a: screenScale,
        b: 0,
        c: 0,
        d: screenScale,
        inverse: () => ({
          scale: 1 / screenScale,
          translateX: -40 / screenScale,
          translateY: -15 / screenScale
        })
      }),
      createSVGPoint: () => {
        const pointer: any = { x: 0, y: 0 }
        pointer.matrixTransform = (matrix: any) => ({
          x: pointer.x * matrix.scale + matrix.translateX,
          y: pointer.y * matrix.scale + matrix.translateY
        })
        return pointer
      }
    }

    expect(selectedMarker.props.r).toBe(5)
    expect(selectedRing.props.r).toBe(9)
    // The non-scaling 1.5px point stroke extends past r=5; 5.2 viewBox units is still visible.
    expect(clickOffset).toBeLessThan(selectedMarker.props.r + 1.5 / 2 / screenScale)

    chart.props.onClick({
      nativeEvent: { detail: 1 },
      currentTarget: chartSvg,
      clientX: (selectedMarker.props.cx + clickOffset) * screenScale + 40,
      clientY: selectedMarker.props.cy * screenScale + 15
    })

    expect(page.state.selectedDate).toBe('2025-11-10')
    expect(page.state.chartDateChoices).toEqual(expect.arrayContaining(['2025-11-10', '2025-11-11']))
    expect(buttonByText(tree, '添加买入点').props.disabled).toBe(true)
    expect(buttonByText(tree, '添加卖出点').props.disabled).toBe(true)
    expect(page.state.signals).toEqual([])

    buttonByText(tree, '2025-11-11 · 净值 1.1210').props.onClick()
    expect(page.state.selectedDate).toBe('2025-11-11')
    expect(page.state.chartDateChoices).toEqual([])
    expect(buttonByText(tree, '添加买入点').props.disabled).toBe(false)
    buttonByText(tree, '添加买入点').props.onClick()
    expect(page.state.signals.map((signal: any) => [signal.date, signal.type])).toEqual([['2025-11-11', 'buy']])

    tree.unmount()
  })
})

describe('manual sequence validation feedback', () => {
  it('revalidates after add, remove, and undo while matching the point list to chart markers', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes = [
      { date: '2024-01-02', val: 1.02 },
      { date: '2024-01-03', val: 1.03 }
    ]
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-02', endDate: '2024-01-31' },
      quotes,
      signals: [],
      selectedDate: '2024-01-02',
      chartDateChoices: [],
      selectedSignalId: null,
      nextSignalId: 1,
      undo: null
    })

    expect(renderedText(tree.root)).toContain('买卖信号序列校验通过')
    expect(renderedText(tree.root)).toContain('有效序列可进入独立的历史模拟引擎')

    buttonByText(tree, '添加卖出点').props.onClick()
    expect(renderedText(tree.root)).toContain('空仓')
    expect(JSON.stringify(tree.toJSON())).toContain('不能在没有对应买入持仓时卖出')
    expect(invalidChartPoints(tree)).toHaveLength(1)

    buttonByText(tree, '移除').props.onClick({ stopPropagation: jest.fn() })
    expect(renderedText(tree.root)).toContain('买卖信号序列校验通过')
    expect(invalidChartPoints(tree)).toHaveLength(0)

    buttonByText(tree, '撤销最近一次点位操作').props.onClick()
    expect(renderedText(tree.root)).toContain('空仓')
    expect(invalidChartPoints(tree)).toHaveLength(1)

    tree.unmount()
  })

  it('rejects same-day opposing signals and marks both list rows and chart markers with the reason', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes = [{ date: '2024-01-02', val: 1.02 }]
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-02', endDate: '2024-01-31' },
      quotes,
      signals: [],
      selectedDate: '2024-01-02',
      chartDateChoices: [],
      selectedSignalId: null,
      nextSignalId: 1,
      undo: null
    })

    buttonByText(tree, '添加买入点').props.onClick()
    buttonByText(tree, '添加卖出点').props.onClick()

    const text = renderedText(tree.root)
    expect(text).toContain('需要处理的序列问题')
    expect(text).toContain('系统不会猜测先后顺序')
    expect(text).toContain('请调整信号日期或移除其中一个信号')
    expect(text).not.toContain('买卖信号序列校验通过')
    expect(invalidChartPoints(tree)).toHaveLength(2)
    expect(page.getSequenceValidation().standardizedSequence).toBeNull()

    tree.unmount()
  })

  it('shows an end-of-range open position as valid and unvalued in the summary, list, and chart label', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes = [
      { date: '2024-01-02', val: 1.02 },
      { date: '2024-01-03', val: 1.03 }
    ]
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-02', endDate: '2024-01-31' },
      quotes,
      signals: [{ id: 1, date: '2024-01-02', type: 'buy' }],
      selectedDate: '2024-01-02',
      chartDateChoices: [],
      selectedSignalId: null,
      nextSignalId: 2,
      undo: null
    })

    const text = renderedText(tree.root)
    expect(text).toContain('买卖信号序列校验通过')
    expect(text).toContain('1 笔持仓仍未平仓')
    expect(text).toContain('这里只输出未平仓状态，不计算或声称期末估值')
    expect(text).toContain('期末未平仓（尚未估值）')
    expect(page.getSequenceValidation().standardizedSequence.endingPositionStatus).toBe('open')
    expect(tree.root.findAllByType('g').some(group =>
      group.props.role === 'img' && String(group.props['aria-label']).includes('期末未平仓且尚未估值')
    )).toBe(true)

    tree.unmount()
  })

  it('requires explicit simulation parameters and renders an estimated but unclosed terminal holding', async () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    jest.useFakeTimers()
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-02', endDate: '2024-01-03' },
      quotes: [
        { date: '2024-01-02', val: 1.02 },
        { date: '2024-01-03', val: 1.03 }
      ],
      signals: [{ id: 1, date: '2024-01-02', type: 'buy' }]
    })

    buttonByText(tree, '运行模拟回测').props.onClick()
    await flushReplayTimers()
    expect(page.state.replayResult).toBeNull()
    expect(page.state.replayError).toContain('请显式填写初始资金')
    expect(page.state.replayStatus).toBe('failure')

    page.setState({ replayConfig: {
      initialCash: '1000',
      buyAmount: '500',
      buyFeeRatePercent: '0',
      sellFeeRatePercent: '0',
      buySlippageRatePercent: '0',
      sellSlippageRatePercent: '0'
    } })
    buttonByText(tree, '使用当前参数重试').props.onClick()
    expect(page.state.replayStatus).toBe('running')
    await flushReplayTimers()

    expect(page.state.replayError).toBe('')
    expect(page.state.replayStatus).toBe('success')
    expect(page.state.replayResult.summary).toMatchObject({
      endingPositionStatus: 'open',
      completedTradeCount: 0,
      openTradeCount: 1,
      lastNavDate: '2024-01-03'
    })
    expect(renderedText(tree.root)).toContain('open / 未平仓')
    expect(renderedText(tree.root)).toContain('不计入已完成交易')

    tree.unmount()
  })

  it('prevents quick duplicate submissions and displays the confirmed run inputs', async () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    jest.useFakeTimers()
    setReadyReplayState(page)
    const runButton = buttonByText(tree, '运行模拟回测')
    const execute = page.executeReplay.bind(page)
    page.executeReplay = jest.fn((...args: any[]) => execute(...args))

    runButton.props.onClick()
    runButton.props.onClick()
    expect(page.state.replayStatus).toBe('running')
    expect(buttonByText(tree, '取消本次运行')).toBeTruthy()
    const preview = renderedText(tree.root)
    expect(preview).toContain('260108 · 2024-01-02 至 2024-01-03')
    expect(preview).toContain('2024-01-02 买入')
    expect(preview).toContain('信号日后的下一条区间内有效净值成交')
    await flushReplayTimers()
    expect(page.executeReplay).toHaveBeenCalledTimes(1)
    expect(page.state.replayStatus).toBe('success')

    tree.unmount()
  })

  it('renders successful metrics and separate signal/fill dates, links the ledger row to the chart, and hides old metrics on failure', async () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    jest.useFakeTimers()
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-02', endDate: '2024-01-05' },
      quotes: [
        { date: '2024-01-02', val: 1.0 },
        { date: '2024-01-03', val: 1.1 },
        { date: '2024-01-04', val: 1.2 },
        { date: '2024-01-05', val: 1.3 }
      ],
      signals: [
        { id: 1, date: '2024-01-02', type: 'buy' },
        { id: 2, date: '2024-01-04', type: 'sell' }
      ],
      replayConfig: {
        initialCash: '1000',
        buyAmount: '500',
        buyFeeRatePercent: '0.2',
        sellFeeRatePercent: '0.2',
        buySlippageRatePercent: '0.1',
        sellSlippageRatePercent: '0.2'
      }
    })

    buttonByText(tree, '运行模拟回测').props.onClick()
    await flushReplayTimers()

    expect(page.state.replayStatus).toBe('success')
    const successText = renderedText(tree.root)
    expect(successText).toContain('总收益率')
    expect(successText).toContain('最大回撤')
    expect(successText).toContain('胜率（已平仓）')
    expect(successText).toContain('已完成往返交易')
    expect(successText).toContain('扣除费用并按滑点成交后 realizedProfit')
    expect(successText).toContain('买入：2024-01-02 → 2024-01-03')
    expect(successText).toContain('卖出：2024-01-04 → 2024-01-05')
    expect(tree.root.findAllByType('g').filter(group =>
      group.props.role === 'button' && String(group.props['aria-label']).startsWith('交易 1 ')
    )).toHaveLength(4)

    const tradeRow = tree.root.findAllByType('tr').filter(row =>
      renderedText(row).includes('买入：2024-01-02 → 2024-01-03')
    )[0]
    tradeRow.props.onClick()
    expect(page.state.selectedReplayTradeIndex).toBe(0)
    expect(page.state.selectedDate).toBe('2024-01-02')
    expect(tree.root.findAllByType('tr').some(row =>
      renderedText(row).includes('买入：2024-01-02 → 2024-01-03') && row.props['aria-selected'] === true
    )).toBe(true)

    const buyExecutionMarker = tree.root.findAllByType('g').filter(group =>
      group.props.role === 'button' && group.props['aria-label'] === '交易 1 买入成交日 2024-01-03；选择以定位交易明细'
    )[0]
    buyExecutionMarker.props.onClick({ stopPropagation: jest.fn() })
    expect(page.state.selectedReplayTradeIndex).toBe(0)
    expect(page.state.selectedDate).toBe('2024-01-03')

    page.executeReplay = jest.fn(() => Promise.reject(new Error('重跑失败')))
    buttonByText(tree, '重新运行模拟回测').props.onClick()
    await flushReplayTimers()
    expect(page.state.replayStatus).toBe('failure')
    expect(renderedText(tree.root)).toContain('此处保留的是先前成功结果')
    expect(renderedText(tree.root)).not.toContain('最大回撤')
    expect(tree.root.findAllByType('g').filter(group =>
      group.props.role === 'button' && String(group.props['aria-label']).startsWith('交易 1 ')
    )).toHaveLength(0)

    tree.unmount()
  })

  it('cancels without partial results and ignores a late completion', async () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    jest.useFakeTimers()
    setReadyReplayState(page)
    let resolveRun: (value: any) => void = () => undefined
    page.executeReplay = jest.fn(() => new Promise(resolve => {
      resolveRun = resolve
    }))

    buttonByText(tree, '运行模拟回测').props.onClick()
    await flushReplayTimers()
    expect(page.state.replayStatus).toBe('running')
    buttonByText(tree, '取消本次运行').props.onClick()
    expect(page.state.replayStatus).toBe('cancelled')
    resolveRun({ summary: { endingPositionStatus: 'open' } })
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve()
    }
    expect(page.state.replayResult).toBeNull()
    expect(page.state.replayStatus).toBe('cancelled')
    expect(page.state.signals).toHaveLength(1)
    expect(page.state.replayConfig.buyAmount).toBe('500')
    expect(renderedText(tree.root)).toContain('已取消；本次运行的部分结果不会展示')

    tree.unmount()
  })

  it('preserves fund/date drafts, markers, and financial inputs when the history API fails', async () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    page.setState({
      draftFundCode: '000001',
      draftStartDate: '2025-01-01',
      draftEndDate: '2025-02-01',
      activeQuery: { fundCode: '260108', startDate: '2024-01-02', endDate: '2024-01-03' },
      quotes: [
        { date: '2024-01-02', val: 1.02 },
        { date: '2024-01-03', val: 1.03 }
      ],
      signals: [{ id: 7, date: '2024-01-02', type: 'buy' }],
      replayConfig: {
        initialCash: '1200',
        buyAmount: '600',
        buyFeeRatePercent: '0.3',
        sellFeeRatePercent: '0.4',
        buySlippageRatePercent: '0.1',
        sellSlippageRatePercent: '0.2'
      }
    })
    manualHistoryMock.mockRejectedValue(new Error('行情服务暂时不可用'))

    page.submitQuery({ preventDefault: jest.fn() })
    await Promise.resolve()
    await Promise.resolve()

    expect(page.state.loading).toBe(false)
    expect(page.state.error).toContain('行情服务暂时不可用')
    expect(page.state.draftFundCode).toBe('000001')
    expect(page.state.draftStartDate).toBe('2025-01-01')
    expect(page.state.draftEndDate).toBe('2025-02-01')
    expect(page.state.signals).toEqual([{ id: 7, date: '2024-01-02', type: 'buy' }])
    expect(page.state.replayConfig).toEqual({
      initialCash: '1200',
      buyAmount: '600',
      buyFeeRatePercent: '0.3',
      sellFeeRatePercent: '0.4',
      buySlippageRatePercent: '0.1',
      sellSlippageRatePercent: '0.2'
    })

    tree.unmount()
  })

  it('retains inputs on failure, retries with the same values, and marks completed results stale after edits', async () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    jest.useFakeTimers()
    setReadyReplayState(page)
    const execute = page.executeReplay.bind(page)
    let attempts = 0
    page.executeReplay = (...args: any[]) => {
      attempts += 1
      return attempts === 1 ? Promise.reject(new Error('临时计算错误')) : execute(...args)
    }

    buttonByText(tree, '运行模拟回测').props.onClick()
    await flushReplayTimers()
    expect(page.state.replayStatus).toBe('failure')
    expect(page.state.replayResult).toBeNull()
    expect(page.state.replayError).toContain('临时计算错误')
    expect(page.state.signals).toHaveLength(1)
    expect(page.state.replayConfig.buyAmount).toBe('500')

    buttonByText(tree, '使用当前参数重试').props.onClick()
    await flushReplayTimers()
    expect(attempts).toBe(2)
    expect(page.state.replayStatus).toBe('success')
    expect(page.state.replayConfig.buyAmount).toBe('500')

    const priorResult = page.state.replayResult
    page.selectDate('2024-01-03')
    page.addSignal('sell')
    expect(page.state.signals).toHaveLength(2)
    expect(page.state.replayResult).toBe(priorResult)
    expect(renderedText(tree.root)).toContain('此处保留的是先前成功结果')

    page.handleReplayConfigChange('buyAmount')({ currentTarget: { value: '600' } })
    expect(page.state.replayResult).toBe(priorResult)
    expect(page.state.replayConfig.buyAmount).toBe('600')
    expect(page.state.replayStatus).toBe('idle')
    expect(renderedText(tree.root)).toContain('此处保留的是先前成功结果')
    expect(renderedText(tree.root)).toContain('不能作为当前指标')

    page.handleDateChange('draftEndDate')({ currentTarget: { value: '2024-01-04' } })
    expect(renderedText(tree.root)).toContain('有修改尚未加载')
    expect(buttonByText(tree, '运行模拟回测').props.disabled).toBe(true)

    tree.unmount()
  })

  it('cancels the real UI replay after ledger dates advance and keeps the page interactive without partial results', async () => {
    jest.useRealTimers()
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const replayQuotes = createDenseQuotes()
    const startDate = replayQuotes[0].date
    const endDate = replayQuotes[replayQuotes.length - 1].date
    page.setState({
      draftFundCode: '260108',
      draftStartDate: startDate,
      draftEndDate: endDate,
      activeQuery: { fundCode: '260108', startDate, endDate },
      quotes: replayQuotes,
      signals: [{ id: 1, date: startDate, type: 'buy' }],
      selectedDate: startDate,
      selectedSignalId: null,
      nextSignalId: 2,
      replayConfig: {
        initialCash: '1000',
        buyAmount: '500',
        buyFeeRatePercent: '0',
        sellFeeRatePercent: '0',
        buySlippageRatePercent: '0',
        sellSlippageRatePercent: '0'
      },
      replayResult: null,
      replayProgress: null
    })

    buttonByText(tree, '运行模拟回测').props.onClick()
    const deadline = Date.now() + 3000
    while ((!page.state.replayProgress || page.state.replayProgress.processedDates < 24) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(page.state.replayStatus).toBe('running')
    expect(page.state.replayProgress.processedDates).toBeGreaterThanOrEqual(24)
    expect(page.state.replayProgress.totalDates).toBe(replayQuotes.length)
    expect(page.state.replayProgress.processedDates).toBeLessThan(replayQuotes.length)
    buttonByText(tree, '取消本次运行').props.onClick()
    expect(page.state.replayStatus).toBe('cancelled')
    expect(page.state.replayResult).toBeNull()
    expect(page.state.replayError).toBe('')

    const stoppedAt = page.state.replayProgress.processedDates
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(page.state.replayProgress.processedDates).toBe(stoppedAt)
    expect(page.state.replayStatus).toBe('cancelled')
    expect(page.state.replayResult).toBeNull()
    expect(page.state.signals).toEqual([{ id: 1, date: startDate, type: 'buy' }])
    expect(page.state.replayConfig.buyAmount).toBe('500')
    expect(renderedText(tree.root)).toContain('已取消；本次运行的部分结果不会展示')

    page.selectSignal({ id: 1, date: startDate, type: 'buy' })
    expect(page.state.selectedSignalId).toBe(1)
    expect(page.state.replayStatus).toBe('cancelled')
    tree.unmount()
  })
})
