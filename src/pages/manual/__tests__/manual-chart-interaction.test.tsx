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
      onClick: props.onClick,
      onKeyDown: props.onKeyDown,
      'aria-pressed': props['aria-pressed']
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
  point.props.role === 'button' && String(point.props['aria-label']).indexOf('校验提示') >= 0
)

const createChartSvg = (scale: number = 1, offsetX: number = 0) => ({
  getScreenCTM: () => ({
    inverse: () => ({ a: 1 / scale, e: -offsetX / scale })
  })
})

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
  latchedQuote: { date: '2024-01-02', val: 1.02 },
  selectionSource: 'chart',
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
  it('selects by X alone and confirms buy or sell using the NAV latched before the cursor moves', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes = createDenseQuotes()
    page.setState({
      activeQuery: { fundCode: '260108', startDate: quotes[0].date, endDate: quotes[quotes.length - 1].date },
      quotes,
      signals: [],
      selectedDate: '',
      selectedSignalId: null,
      nextSignalId: 1,
      undo: null
    })

    const selectedMarker = tree.root.findAllByType('circle').filter(marker =>
      marker.props['aria-label'] === '选择真实净值日期 2025-11-10，单位净值 1.1210'
    )[0]
    const chart = tree.root.findAllByType('svg').filter(svg => svg.props['aria-label'])[0]
    const chartSvg = createChartSvg(0.75, 40)

    chart.props.onClick({
      nativeEvent: { detail: 1 },
      currentTarget: chartSvg,
      clientX: selectedMarker.props.cx * 0.75 + 40,
      clientY: -5000
    })

    expect(page.state.selectedDate).toBe('2025-11-10')
    expect(page.state.latchedQuote).toEqual({ date: '2025-11-10', val: 1.121 })
    expect(page.state.signals).toEqual([])
    expect(renderedText(tree.root)).toContain('2025-11-10　单位净值：1.1210')
    expect(buttonByText(tree, '确认买入信号').props.disabled).toBe(false)

    chart.props.onMouseMove({
      currentTarget: chartSvg,
      clientX: selectedMarker.props.cx * 0.75 + 40,
      clientY: 5000
    })
    expect(page.state.selectedDate).toBe('2025-11-10')
    expect(page.state.latchedQuote).toEqual({ date: '2025-11-10', val: 1.121 })

    buttonByText(tree, '确认买入信号').props.onClick()
    expect(page.state.selectedDate).toBe('2025-11-10')
    expect(page.state.signals.map((signal: any) => [signal.date, signal.type])).toEqual([['2025-11-10', 'buy']])
    // Moving the vertical locator elsewhere only updates hover; it cannot drift the latched confirmation target.
    const otherMarker = tree.root.findAllByType('circle').filter(marker =>
      marker.props['aria-label'] === '选择真实净值日期 2025-11-11，单位净值 1.1210'
    )[0]
    chart.props.onMouseMove({
      currentTarget: chartSvg,
      clientX: otherMarker.props.cx * 0.75 + 40,
      clientY: -9000
    })
    expect(page.state.hoveredDate).toBe('2025-11-11')
    expect(page.state.selectedDate).toBe('2025-11-10')
    expect(page.state.latchedQuote).toEqual({ date: '2025-11-10', val: 1.121 })
    buttonByText(tree, '确认卖出信号').props.onClick()
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

  it('removes only the signal when its nested button is keyboard-activated', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes = [
      { date: '2024-01-02', val: 1.02 },
      { date: '2024-01-03', val: 1.03 }
    ]
    const signals = [
      { id: 1, date: '2024-01-02', type: 'buy' },
      { id: 2, date: '2024-01-03', type: 'sell' }
    ]

    ;['Enter', ' '].forEach(key => {
      page.setState({
        activeQuery: { fundCode: '260108', startDate: '2024-01-02', endDate: '2024-01-03' },
        quotes,
        signals,
        selectedDate: '2024-01-03',
        selectedSignalId: 2,
        nextSignalId: 3,
        undo: null
      })

      const signalRow = tree.root.findAllByType('tr').filter(row =>
        row.props.role === 'button' && String(row.props['aria-label']).includes('2024-01-02')
      )[0]
      const removeButton = signalRow.findByType('button')
      const keyEvent = {
        key,
        stopPropagation: jest.fn(),
        preventDefault: jest.fn()
      }

      removeButton.props.onKeyDown(keyEvent)
      if (keyEvent.stopPropagation.mock.calls.length === 0) {
        signalRow.props.onKeyDown(keyEvent)
      }
      expect(keyEvent.stopPropagation).toHaveBeenCalled()
      expect(keyEvent.preventDefault).not.toHaveBeenCalled()
      expect(page.state.selectedSignalId).toBe(2)
      expect(page.state.selectedDate).toBe('2024-01-03')

      // Native button keyboard activation dispatches a click after Enter/Space.
      removeButton.props.onClick({ stopPropagation: jest.fn() })
      expect(page.state.signals.map((signal: any) => signal.id)).toEqual([2])
      expect(page.state.selectedSignalId).toBe(2)
      expect(page.state.selectedDate).toBe('2024-01-03')
    })

    tree.unmount()
  })

  it('restores the selected NAV date when undoing an add made on another date', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes = [
      { date: '2024-01-02', val: 1.02 },
      { date: '2024-01-03', val: 1.03 }
    ]
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-02', endDate: '2024-01-03' },
      quotes,
      signals: [],
      selectedDate: '2024-01-02',
      latchedQuote: { date: '2024-01-02', val: 1.02 },
      selectionSource: 'chart',
      selectedSignalId: null,
      nextSignalId: 1,
      undo: null
    })

    page.addSignal('buy')
    const signalA = page.state.signals[0]
    page.selectSignal(signalA)
    expect(page.state.selectedSignalId).toBe(signalA.id)
    expect(page.state.selectedDate).toBe('2024-01-02')

    const pointB = tree.root.findAllByType('circle').filter(circle =>
      circle.props.role === 'button' && String(circle.props['aria-label']).includes('2024-01-03')
    )[0]
    pointB.props.onKeyDown({ key: 'Enter', preventDefault: jest.fn() })
    expect(page.state.selectedDate).toBe('2024-01-03')
    expect(page.state.selectedSignalId).toBeNull()
    expect(page.state.signals).toHaveLength(1)
    buttonByText(tree, '确认卖出信号').props.onClick()
    expect(page.state.selectedSignalId).toBe(2)
    expect(page.state.signals).toHaveLength(2)

    buttonByText(tree, '撤销最近一次点位操作').props.onClick()

    expect(page.state.signals.map((signal: any) => signal.id)).toEqual([signalA.id])
    expect(page.state.selectedSignalId).toBeNull()
    expect(page.state.selectedDate).toBe('2024-01-03')
    expect(tree.root.findAllByType('tr').filter(row => row.props['aria-selected'] === true)).toHaveLength(0)
    const selectedPoint = tree.root.findAllByType('circle').filter(circle =>
      circle.props.role === 'button' && String(circle.props['aria-label']).includes('2024-01-02')
    )[0]
    const otherPoint = tree.root.findAllByType('circle').filter(circle =>
      circle.props.role === 'button' && String(circle.props['aria-label']).includes('2024-01-03')
    )[0]
    expect(selectedPoint.props.r).toBe(3.5)
    expect(otherPoint.props.r).toBe(5)

    tree.unmount()
  })

  it('follows the nearest horizontal date even when the clicked X is within a neighboring marker stroke', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes = createDenseQuotes()
    page.setState({
      activeQuery: { fundCode: '260108', startDate: quotes[0].date, endDate: quotes[quotes.length - 1].date },
      quotes,
      signals: [],
      selectedDate: '',
      selectedSignalId: null,
      nextSignalId: 1,
      undo: null
    })

    const selectedMarker = tree.root.findAllByType('circle').filter(marker =>
      marker.props['aria-label'] === '选择真实净值日期 2025-11-10，单位净值 1.1210'
    )[0]
    const selectedRing = tree.root.findAllByType('circle').filter(marker =>
      marker.props.cx === selectedMarker.props.cx && marker.props.cy === selectedMarker.props.cy
        && marker.props.r === 9
    )[0]
    const chart = tree.root.findAllByType('svg').filter(svg => svg.props['aria-label'])[0]
    const screenScale = 0.75
    const clickOffset = 5.2
    const chartSvg = createChartSvg(screenScale, 40)

    expect(selectedMarker.props.r).toBe(3.5)
    expect(selectedRing).toBeUndefined()

    chart.props.onClick({
      nativeEvent: { detail: 1 },
      currentTarget: chartSvg,
      clientX: (selectedMarker.props.cx + clickOffset) * screenScale + 40,
      clientY: 9000
    })

    expect(page.state.selectedDate).toBe('2025-11-11')
    expect(page.state.latchedQuote).toEqual({ date: '2025-11-11', val: 1.121 })
    expect(buttonByText(tree, '确认买入信号').props.disabled).toBe(false)
    expect(buttonByText(tree, '确认卖出信号').props.disabled).toBe(false)
    expect(page.state.signals).toEqual([])

    expect(page.state.signals).toEqual([])
    buttonByText(tree, '确认买入信号').props.onClick()
    expect(page.state.signals.map((signal: any) => [signal.date, signal.type])).toEqual([['2025-11-11', 'buy']])

    tree.unmount()
  })
})


describe('manual point-mode chart workflow', () => {
  it('requires an explicit real NAV selection before confirming a signal and keeps as-of fills linked without shifting the target', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes: ManualQuote[] = [
      { date: '2024-01-01', val: 1.00 },
      { date: '2024-01-04', val: 1.04 },
      { date: '2024-01-08', val: 1.08 },
      { date: '2024-01-12', val: 1.12 }
    ]
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-01', endDate: '2024-01-12' },
      historyQuotes: quotes,
      quotes: quotes.slice(0, 2),
      asOfDate: '2024-01-07',
      signals: [],
      selectedDate: '',
      nextSignalId: 1
    })

    const chart = tree.root.findAllByType('svg').filter(svg => svg.props['aria-label'])[0]
    const chartSvg = createChartSvg()
    const chartReadout = () => tree.root.findAllByType('div').filter(node =>
      node.props.role === 'status' && node.props['aria-label'] !== undefined
    )[0]
    const quotePoint = () => tree.root.findAllByType('circle').filter(circle =>
      typeof circle.props['aria-label'] === 'string'
        && circle.props['aria-label'].includes('2024-01-04')
        && circle.props['aria-label'].includes('1.0400')
    )[0]
    const clickEvent = () => ({
      nativeEvent: { detail: 1 },
      currentTarget: chartSvg,
      clientX: quotePoint().props.cx,
      clientY: quotePoint().props.cy
    })
    const visibleQuoteDates = () => tree.root.findAllByType('circle')
      .filter(circle => typeof circle.props['aria-label'] === 'string'
        && circle.props['aria-label'].includes('真实净值日'))
      .map(circle => circle.props['aria-label'].match(/\d{4}-\d{2}-\d{2}/)![0])

    expect(visibleQuoteDates()).toEqual(['2024-01-01', '2024-01-04'])
    expect(buttonByText(tree, '确认买入信号').props.disabled).toBe(true)
    expect(buttonByText(tree, '确认卖出信号').props.disabled).toBe(true)
    const firstPoint = tree.root.findAllByType('circle').filter(circle =>
      typeof circle.props['aria-label'] === 'string'
        && circle.props['aria-label'].includes('2024-01-01')
        && circle.props['aria-label'].includes('1.0000')
    )[0]
    const realPoint = quotePoint()
    chart.props.onClick({
      nativeEvent: { detail: 1 },
      currentTarget: chartSvg,
      clientX: (firstPoint.props.cx + realPoint.props.cx) / 2,
      clientY: 12000
    })
    expect(page.state.selectedDate).toBe('2024-01-01')
    page.selectDate('2024-01-08')
    expect(page.state.selectedDate).toBe('2024-01-01')

    chart.props.onMouseMove({ currentTarget: chartSvg, clientX: quotePoint().props.cx, clientY: -12000 })
    expect(chartReadout().props['aria-label']).toBe('当前定位实际交易日：2024-01-04，单位净值 1.0400')
    expect(renderedText(chartReadout())).toContain('2024-01-04　单位净值：1.0400')
    expect(renderedText(chart)).not.toContain('2024-01-04 · 单位净值 1.0400')
    expect(page.state.selectedDate).toBe('2024-01-01')
    expect(buttonByText(tree, '确认买入信号').props.disabled).toBe(false)
    chart.props.onMouseLeave()

    chart.props.onClick(clickEvent())
    expect(page.state.signals).toEqual([])
    expect(page.state.selectedDate).toBe('2024-01-04')
    expect(renderedText(tree.root)).toContain('2024-01-04　单位净值：1.0400')
    expect(buttonByText(tree, '确认买入信号').props.disabled).toBe(false)
    expect(chartReadout().props['aria-label']).toBe('当前定位实际交易日：2024-01-04，单位净值 1.0400')
    const selectedCrosshair = tree.root.findAllByType('line').filter(line =>
      line.props.x1 === realPoint.props.cx
        && line.props.x2 === realPoint.props.cx
        && line.props.y1 !== line.props.y2
    )[0]
    expect(selectedCrosshair.props.x1).toBe(realPoint.props.cx)
    expect(selectedCrosshair.props.x2).toBe(realPoint.props.cx)
    chart.props.onMouseMove({ currentTarget: chartSvg, clientX: firstPoint.props.cx, clientY: 12000 })
    expect(page.state.hoveredDate).toBe('2024-01-01')
    expect(page.state.selectedDate).toBe('2024-01-04')
    expect(page.state.latchedQuote).toEqual({ date: '2024-01-04', val: 1.04 })
    expect(chartReadout().props['aria-label']).toBe('当前定位实际交易日：2024-01-01，单位净值 1.0000')
    chart.props.onMouseLeave()
    expect(chartReadout().props['aria-label']).toBe('当前定位实际交易日：2024-01-04，单位净值 1.0400')
    buttonByText(tree, '确认买入信号').props.onClick()
    expect(page.state.signals.map((signal: any) => [signal.date, signal.type])).toEqual([['2024-01-04', 'buy']])
    expect(page.state.selectedDate).toBe('2024-01-04')
    expect(renderedText(tree.root)).toContain('待后续 as-of 揭示；不推断未来日期')
    expect(JSON.stringify(tree.toJSON())).not.toContain('2024-01-08')

    buttonByText(tree, '下一周').props.onClick()
    expect(page.state.asOfDate).toBe('2024-01-12')
    expect(visibleQuoteDates()).toEqual(quotes.map(quote => quote.date))
    expect(renderedText(tree.root)).toContain('下一有效 NAV 成交日')
    expect(renderedText(tree.root)).toContain('2024-01-08')
    expect(page.state.signals[0].date).toBe('2024-01-04')

    page.setState({
      selectedSignalId: null,
      selectedDate: '2024-01-01',
      latchedQuote: { date: '2024-01-01', val: 1.00 },
      selectionSource: 'chart'
    })
    const signalRow = tree.root.findAllByType('tr').filter(row => renderedText(row).includes('2024-01-04'))[0]
    signalRow.props.onClick()
    expect(page.state.selectedSignalId).toBe(1)
    expect(page.state.selectedDate).toBe('2024-01-04')
    expect(page.state.selectionSource).toBe('signal-list')
    expect(buttonByText(tree, '确认买入信号').props.disabled).toBe(true)
    expect(tree.root.findAllByType('tr').some(row => row.props['aria-selected'] === true)).toBe(true)
    expect(tree.root.findAllByType('g').some(group =>
      group.props.role === 'button' && group.props['aria-pressed'] === true
    )).toBe(true)

    chart.props.onClick(clickEvent())
    expect(page.state.selectionSource).toBe('chart')
    expect(buttonByText(tree, '确认买入信号').props.disabled).toBe(false)
    page.setState({ selectedSignalId: null })
    const signalMarker = tree.root.findAllByType('g').filter(group =>
      group.props.role === 'button' && String(group.props['aria-label']).includes('2024-01-04 买入信号日')
    )[0]
    expect(signalMarker).toBeTruthy()
    signalMarker.props.onClick({ stopPropagation: jest.fn() })
    expect(page.state.selectedSignalId).toBe(1)
    expect(page.state.selectionSource).toBe('signal-list')
    expect(buttonByText(tree, '确认卖出信号').props.disabled).toBe(true)
    expect(tree.root.findAllByType('tr').some(row => row.props['aria-selected'] === true)).toBe(true)

    buttonByText(tree, '移除').props.onClick({ stopPropagation: jest.fn() })
    expect(page.state.signals).toEqual([])
    buttonByText(tree, '撤销最近一次点位操作').props.onClick()
    expect(page.state.signals.map((signal: any) => signal.date)).toEqual(['2024-01-04'])

    tree.unmount()
  })

  it('shows an empty state instead of stale or as-of-hidden NAV values when selection is invalid', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes: ManualQuote[] = [
      { date: '2024-01-01', val: 1.00 },
      { date: '2024-01-04', val: 1.04 },
      { date: '2024-01-08', val: 1.08 }
    ]
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-01', endDate: '2024-01-12' },
      historyQuotes: quotes,
      quotes: quotes.slice(0, 2),
      asOfDate: '2024-01-07',
      selectedDate: '2024-01-08',
      latchedQuote: quotes[2],
      selectionSource: 'chart',
      hoveredDate: '2024-01-08'
    })

    const chartReadout = () => tree.root.findAllByType('div').filter(node =>
      node.props.role === 'status' && node.props['aria-label'] !== undefined
    )[0]
    expect(chartReadout().props['aria-label']).toBe('请先在净值图上选择一个点位。')
    expect(renderedText(tree.root)).not.toContain('2024-01-08')

    page.setState({ selectedDate: '', latchedQuote: null, selectionSource: null, hoveredDate: '2024-01-04' })
    expect(chartReadout().props['aria-label']).toBe('当前定位实际交易日：2024-01-04，单位净值 1.0400')
    page.setState({ hoveredDate: '' })
    expect(chartReadout().props['aria-label']).toBe('请先在净值图上选择一个点位。')

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
      latchedQuote: { date: '2024-01-02', val: 1.02 },
      selectionSource: 'chart',
      selectedSignalId: null,
      nextSignalId: 1,
      undo: null
    })

    expect(renderedText(tree.root)).toContain('买卖信号序列校验通过')
    expect(renderedText(tree.root)).toContain('有效序列可进入独立的历史模拟引擎')

    page.addSignal('sell')
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
      latchedQuote: { date: '2024-01-02', val: 1.02 },
      selectionSource: 'chart',
      selectedSignalId: null,
      nextSignalId: 1,
      undo: null
    })

    page.addSignal('buy')
    page.addSignal('sell')

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
      latchedQuote: { date: '2024-01-02', val: 1.02 },
      selectionSource: 'chart',
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
      group.props.role === 'button' && String(group.props['aria-label']).includes('期末未平仓且尚未估值')
    )).toBe(true)

    tree.unmount()
  })

  it('revalidates add-on buys when a signal is added, removed, and restored by undo', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const quotes = [
      { date: '2024-01-02', val: 1.02 },
      { date: '2024-01-03', val: 1.03 },
      { date: '2024-01-04', val: 1.04 }
    ]
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-02', endDate: '2024-01-04' },
      quotes,
      signals: [{ id: 1, date: '2024-01-02', type: 'buy' }],
      selectedDate: '2024-01-03',
      latchedQuote: quotes[1],
      selectionSource: 'chart',
      selectedSignalId: null,
      nextSignalId: 2,
      undo: null
    })

    page.addSignal('buy')
    expect(page.getSequenceValidation().standardizedSequence.trades[0].entrySignals.map((signal: any) => signal.id)).toEqual([1, 2])

    page.removeSignal(2, { stopPropagation: jest.fn() } as any)
    expect(page.getSequenceValidation().standardizedSequence.trades[0].entrySignals.map((signal: any) => signal.id)).toEqual([1])

    page.undoLastEdit()
    expect(page.getSequenceValidation().standardizedSequence.trades[0].entrySignals.map((signal: any) => signal.id)).toEqual([1, 2])
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
        { id: 2, date: '2024-01-03', type: 'buy' },
        { id: 3, date: '2024-01-04', type: 'sell' }
      ],
      replayConfig: {
        initialCash: '1500',
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
    expect(successText).toContain('买入 1：2024-01-02 → 2024-01-03')
    expect(successText).toContain('买入 2：2024-01-03 → 2024-01-04')
    expect(successText).toContain('卖出：2024-01-04 → 2024-01-05')
    expect(tree.root.findAllByType('g').filter(group =>
      group.props.role === 'button' && String(group.props['aria-label']).startsWith('交易 1 ')
    )).toHaveLength(6)

    const tradeRow = tree.root.findAllByType('tr').filter(row =>
      renderedText(row).includes('买入 1：2024-01-02 → 2024-01-03')
    )[0]
    tradeRow.props.onClick()
    expect(page.state.selectedReplayTradeIndex).toBe(0)
    expect(page.state.selectedDate).toBe('2024-01-02')
    expect(tree.root.findAllByType('tr').some(row =>
      renderedText(row).includes('买入 1：2024-01-02 → 2024-01-03') && row.props['aria-selected'] === true
    )).toBe(true)

    const buyExecutionMarker = tree.root.findAllByType('g').filter(group =>
      group.props.role === 'button' && group.props['aria-label'] === '交易 1 第1次买入成交日 2024-01-03；选择以定位交易明细'
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


describe('manual as-of replay page', () => {
  const asOfQuotes: ManualQuote[] = [
    { date: '2024-01-01', val: 1.00 },
    { date: '2024-01-04', val: 1.04 },
    { date: '2024-01-08', val: 1.08 },
    { date: '2024-01-12', val: 1.12 },
    { date: '2024-01-15', val: 1.15 },
    { date: '2024-01-20', val: 1.20 },
    { date: '2024-01-22', val: 1.22 }
  ]

  it('reveals a complete first calendar week, accumulates each next week, clips the final partial week, then disables', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-01', endDate: '2024-01-22' },
      historyQuotes: asOfQuotes,
      quotes: asOfQuotes.slice(0, 2),
      asOfDate: '2024-01-07',
      signals: [
        { id: 1, date: '2024-01-04', type: 'buy' },
        { id: 2, date: '2024-01-08', type: 'sell' },
        { id: 3, date: '2024-01-20', type: 'buy' }
      ],
      selectedDate: '2024-01-04'
    })

    const visibleQuoteDates = () => tree.root.findAllByType('circle')
      .filter(circle => typeof circle.props['aria-label'] === 'string'
        && circle.props['aria-label'].includes('真实净值日'))
      .map(circle => circle.props['aria-label'].match(/\d{4}-\d{2}-\d{2}/)![0])
    expect(page.getCurrentAsOfSnapshot().asOfDate).toBe('2024-01-07')
    expect(visibleQuoteDates()).toEqual(['2024-01-01', '2024-01-04'])
    expect(page.getCurrentAsOfSnapshot().signals).toHaveLength(1)
    expect(renderedText(tree.root)).not.toContain('2024-01-08 卖出')
    expect(buttonByText(tree, '下一周').props.disabled).toBe(false)

    buttonByText(tree, '下一周').props.onClick()
    expect(page.state.asOfDate).toBe('2024-01-14')
    expect(visibleQuoteDates()).toEqual(['2024-01-01', '2024-01-04', '2024-01-08', '2024-01-12'])
    expect(page.getCurrentAsOfSnapshot().signals).toHaveLength(2)
    expect(renderedText(tree.root)).toContain('2024-01-08')

    buttonByText(tree, '下一周').props.onClick()
    expect(page.state.asOfDate).toBe('2024-01-21')
    expect(visibleQuoteDates()).toEqual([
      '2024-01-01', '2024-01-04', '2024-01-08', '2024-01-12', '2024-01-15', '2024-01-20'
    ])
    expect(page.getCurrentAsOfSnapshot().signals).toHaveLength(3)

    buttonByText(tree, '下一周').props.onClick()
    expect(page.state.asOfDate).toBe('2024-01-22')
    expect(visibleQuoteDates()).toEqual(asOfQuotes.map(quote => quote.date))
    expect(buttonByText(tree, '下一周').props.disabled).toBe(true)
    buttonByText(tree, '下一周').props.onClick()
    expect(page.state.asOfDate).toBe('2024-01-22')

    tree.unmount()
  })

  it('advances through the selected range without later NAV and keeps eligibility independent of hidden history', () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    const historyWithoutFutureNav = asOfQuotes.slice(0, 2)
    page.setState({
      activeQuery: { fundCode: '260108', startDate: '2024-01-01', endDate: '2024-01-22' },
      historyQuotes: historyWithoutFutureNav,
      quotes: historyWithoutFutureNav,
      asOfDate: '2024-01-07',
      signals: [],
      selectedDate: '2024-01-04'
    })

    expect(page.canAdvanceAsOf()).toBe(true)
    page.setState({ historyQuotes: asOfQuotes })
    expect(page.canAdvanceAsOf()).toBe(true)
    page.setState({ historyQuotes: historyWithoutFutureNav })

    buttonByText(tree, '下一周').props.onClick()
    expect(page.state.asOfDate).toBe('2024-01-14')
    expect(buttonByText(tree, '下一周').props.disabled).toBe(false)
    expect(page.getCurrentAsOfSnapshot().quotes.map((quote: ManualQuote) => quote.date))
      .toEqual(['2024-01-01', '2024-01-04'])

    buttonByText(tree, '下一周').props.onClick()
    expect(page.state.asOfDate).toBe('2024-01-21')
    expect(buttonByText(tree, '下一周').props.disabled).toBe(false)
    buttonByText(tree, '下一周').props.onClick()
    expect(page.state.asOfDate).toBe('2024-01-22')
    expect(buttonByText(tree, '下一周').props.disabled).toBe(true)

    tree.unmount()
  })

  it('passes only the current filtered NAV/signal snapshot and as-of range to the replay engine', async () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    jest.useFakeTimers()
    page.setState({
      draftFundCode: '260108',
      activeQuery: { fundCode: '260108', startDate: '2024-01-01', endDate: '2024-01-22' },
      historyQuotes: asOfQuotes,
      quotes: asOfQuotes.slice(0, 2),
      asOfDate: '2024-01-07',
      signals: [
        { id: 1, date: '2024-01-04', type: 'buy' },
        { id: 2, date: '2024-01-08', type: 'sell' }
      ],
      selectedDate: '2024-01-04',
      replayConfig: {
        initialCash: '1000',
        buyAmount: '500',
        buyFeeRatePercent: '0',
        sellFeeRatePercent: '0',
        buySlippageRatePercent: '0',
        sellSlippageRatePercent: '0'
      }
    })
    page.executeReplay = jest.fn(() => new Promise(() => undefined))

    buttonByText(tree, '运行模拟回测').props.onClick()
    await flushReplayTimers()

    expect(page.executeReplay).toHaveBeenCalledTimes(1)
    const [validation, replayQuotes, replayRange] = page.executeReplay.mock.calls[0]
    expect(replayQuotes.map((quote: ManualQuote) => quote.date)).toEqual(['2024-01-01', '2024-01-04'])
    expect(replayQuotes.every((quote: ManualQuote) => quote.date <= '2024-01-07')).toBe(true)
    expect(replayRange).toEqual({ startDate: '2024-01-01', endDate: '2024-01-07' })
    expect(validation.standardizedSequence.trades.map((trade: any) => trade.entrySignals[0].id)).toEqual([1])
    expect(JSON.stringify(validation)).not.toContain('2024-01-08')

    tree.unmount()
  })

  it('resets the as-of window for a new range and ignores a slower old history response', async () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    page.setState({
      draftFundCode: '260108',
      draftStartDate: '2024-01-01',
      draftEndDate: '2024-01-31'
    })
    let resolveFirst: (quotes: ManualQuote[]) => void = () => undefined
    let resolveSecond: (quotes: ManualQuote[]) => void = () => undefined
    manualHistoryMock
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve }))

    page.submitQuery({ preventDefault: jest.fn() })
    page.handleDateChange('draftStartDate')({ currentTarget: { value: '2024-02-01' } })
    page.handleDateChange('draftEndDate')({ currentTarget: { value: '2024-03-01' } })
    page.submitQuery({ preventDefault: jest.fn() })
    resolveSecond([
      { date: '2024-02-01', val: 1.00 },
      { date: '2024-02-07', val: 1.01 },
      { date: '2024-02-08', val: 1.02 },
      { date: '2024-02-28', val: 1.03 }
    ])
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve()
    }

    expect(page.state.activeQuery).toEqual({ fundCode: '260108', startDate: '2024-02-01', endDate: '2024-03-01' })
    expect(page.state.asOfDate).toBe('2024-02-07')
    expect(page.getCurrentAsOfSnapshot().quotes.map((quote: ManualQuote) => quote.date)).toEqual(['2024-02-01', '2024-02-07'])

    resolveFirst([
      { date: '2024-01-01', val: 2.00 },
      { date: '2024-01-08', val: 2.01 }
    ])
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve()
    }
    expect(page.state.activeQuery.startDate).toBe('2024-02-01')
    expect(page.state.asOfDate).toBe('2024-02-07')
    expect(page.state.historyQuotes.every((quote: ManualQuote) => quote.date >= '2024-02-01')).toBe(true)

    tree.unmount()
  })
})


describe('manual as-of replay async invalidation', () => {
  it('cancels an in-flight replay when the as-of week advances and ignores its late completion', async () => {
    const tree = renderer.create(<ManualBacktestPage />)
    const page = tree.getInstance() as any
    jest.useFakeTimers()
    const historyQuotes: ManualQuote[] = [
      { date: '2024-01-01', val: 1.00 },
      { date: '2024-01-04', val: 1.04 },
      { date: '2024-01-08', val: 1.08 },
      { date: '2024-01-12', val: 1.12 }
    ]
    page.setState({
      draftFundCode: '260108',
      draftStartDate: '2024-01-01',
      draftEndDate: '2024-01-14',
      activeQuery: { fundCode: '260108', startDate: '2024-01-01', endDate: '2024-01-14' },
      historyQuotes,
      quotes: historyQuotes.slice(0, 2),
      asOfDate: '2024-01-07',
      signals: [{ id: 1, date: '2024-01-04', type: 'buy' }],
      selectedDate: '2024-01-04',
      replayConfig: {
        initialCash: '1000',
        buyAmount: '500',
        buyFeeRatePercent: '0',
        sellFeeRatePercent: '0',
        buySlippageRatePercent: '0',
        sellSlippageRatePercent: '0'
      }
    })
    let resolveRun: (result: any) => void = () => undefined
    page.executeReplay = jest.fn(() => new Promise(resolve => { resolveRun = resolve }))

    buttonByText(tree, '运行模拟回测').props.onClick()
    await flushReplayTimers()
    expect(page.state.replayStatus).toBe('running')
    buttonByText(tree, '下一周').props.onClick()
    expect(page.state.asOfDate).toBe('2024-01-14')
    expect(page.state.replayStatus).toBe('cancelled')

    resolveRun({ summary: { endingPositionStatus: 'open' } })
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve()
    }
    expect(page.state.replayResult).toBeNull()
    expect(page.state.replayStatus).toBe('cancelled')

    tree.unmount()
  })
})
