import React from 'react'
import renderer, { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer'
import ManualBacktestPage from '..'
import { ManualQuote } from '../manual-model'

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
    expect(renderedText(tree.root)).toContain('尚无回测执行入口')

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
})
