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
})
