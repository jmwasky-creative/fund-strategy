import React, { Component, FormEvent, KeyboardEvent } from 'react'
import Alert from 'antd/es/alert'
import Button from 'antd/es/button'
import Card from 'antd/es/card'
import Input from 'antd/es/input'
import Modal from 'antd/es/modal'
import Select from 'antd/es/select'
import Spin from 'antd/es/spin'
import 'antd/dist/antd.css'
import { FundInfo, getFundInfo } from '@/utils/fund-stragegy/fetch-fund-data'
import { loadManualHistory } from '@/utils/fund-stragegy/manual-history'
import {
  getSignalsInvalidatedByQuery,
  hasManualQuoteDate,
  ManualQuery,
  ManualQuote,
  ManualSignal,
  ManualSignalType,
  ManualSequenceIssue,
  ManualSequenceValidation,
  sortManualSignals,
  validateManualSignalSequence
} from './manual-model'
import {
  ManualReplayConfig,
  ManualReplayResult,
  ManualReplayCancelledError,
  runManualReplayCooperatively
} from './manual-replay-model'
import {
  getManualChartHitCandidates,
  MANUAL_CHART_LAYOUT,
  MANUAL_CHART_POINT_RADIUS,
  MANUAL_CHART_POINT_STROKE_WIDTH,
  MANUAL_CHART_SELECTED_POINT_RADIUS,
  MANUAL_CHART_SELECTED_RING_RADIUS,
  MANUAL_CHART_SELECTED_RING_STROKE_WIDTH,
  plotManualHistory
} from './manual-chart-model'
import styles from './index.css'

const { Option } = Select
const CHART_WIDTH = MANUAL_CHART_LAYOUT.width
const CHART_HEIGHT = MANUAL_CHART_LAYOUT.height
const PLOT_LEFT = MANUAL_CHART_LAYOUT.plotLeft
const PLOT_RIGHT = MANUAL_CHART_LAYOUT.plotRight
const PLOT_TOP = MANUAL_CHART_LAYOUT.plotTop
const PLOT_BOTTOM = MANUAL_CHART_LAYOUT.plotBottom

const dateInputValue = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const initialRange = (): { startDate: string, endDate: string } => {
  const end = new Date()
  const start = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate())
  return { startDate: dateInputValue(start), endDate: dateInputValue(end) }
}

interface UndoSnapshot {
  signals: ManualSignal[]
  selectedSignalId: number | null
}

interface PendingSelection {
  query: ManualQuery
  quotes: ManualQuote[]
  invalidSignals: ManualSignal[]
}

interface ManualReplayFormState {
  initialCash: string
  buyAmount: string
  buyFeeRatePercent: string
  sellFeeRatePercent: string
  buySlippageRatePercent: string
  sellSlippageRatePercent: string
}

type ManualReplayStatus = 'idle' | 'running' | 'success' | 'failure' | 'cancelled'

interface ManualWorkspaceState {
  draftFundCode: string
  draftStartDate: string
  draftEndDate: string
  fundOptions: FundInfo[]
  searchingFunds: boolean
  fundSearchError: string
  activeQuery: ManualQuery | null
  quotes: ManualQuote[]
  signals: ManualSignal[]
  selectedDate: string
  chartDateChoices: string[]
  selectedSignalId: number | null
  nextSignalId: number
  undo: UndoSnapshot | null
  pendingSelection: PendingSelection | null
  loading: boolean
  error: string
  replayConfig: ManualReplayFormState
  replayResult: ManualReplayResult | null
  replayError: string
  replayStatus: ManualReplayStatus
  replayStatusMessage: string
  replayProgress: { processedDates: number, totalDates: number } | null
  replayInputRevision: number
  replayResultRevision: number | null
}

const errorMessage = (error: any): string => error && typeof error.message === 'string'
  ? error.message
  : '行情读取失败，请检查网络后重试。'

interface ManualReplayCancellation {
  cancelled: boolean
}

export default class ManualBacktestPage extends Component<{}, ManualWorkspaceState> {
  private searchTimeout: any = null
  private searchVersion = 0
  private replayRequestId = 0
  private replayStartTimer: any = null
  private replayExecutionPending = false

  private activeReplayCancellation: ManualReplayCancellation | null = null

  state: ManualWorkspaceState = {
    draftFundCode: '',
    draftStartDate: initialRange().startDate,
    draftEndDate: initialRange().endDate,
    fundOptions: [],
    searchingFunds: false,
    fundSearchError: '',
    activeQuery: null,
    quotes: [],
    signals: [],
    selectedDate: '',
    chartDateChoices: [],
    selectedSignalId: null,
    nextSignalId: 1,
    undo: null,
    pendingSelection: null,
    loading: false,
    error: '',
    replayConfig: {
      initialCash: '',
      buyAmount: '',
      buyFeeRatePercent: '',
      sellFeeRatePercent: '',
      buySlippageRatePercent: '',
      sellSlippageRatePercent: ''
    },
    replayResult: null,
    replayError: '',
    replayStatus: 'idle',
    replayStatusMessage: '待运行；请确认基金、区间、信号和所有显式参数。',
    replayProgress: null,
    replayInputRevision: 0,
    replayResultRevision: null
  }

  componentWillUnmount() {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout)
    }
    this.replayRequestId += 1
    this.replayExecutionPending = false
    if (this.activeReplayCancellation) {
      this.activeReplayCancellation.cancelled = true
      this.activeReplayCancellation = null
    }
    if (this.replayStartTimer) {
      clearTimeout(this.replayStartTimer)
      this.replayStartTimer = null
    }
  }

  private invalidateReplayInputs = () => {
    this.replayRequestId += 1
    this.replayExecutionPending = false
    if (this.activeReplayCancellation) {
      this.activeReplayCancellation.cancelled = true
      this.activeReplayCancellation = null
    }
    if (this.replayStartTimer) {
      clearTimeout(this.replayStartTimer)
      this.replayStartTimer = null
    }
    this.setState(previousState => {
      const wasRunning = previousState.replayStatus === 'running'
      return {
        replayInputRevision: previousState.replayInputRevision + 1,
        replayStatus: wasRunning ? 'cancelled' : 'idle',
        replayStatusMessage: wasRunning
          ? '输入已变化，旧运行已取消；请按当前点位和参数重新运行。'
          : previousState.replayResult
            ? '输入已变化；上一次结果已过期，不可作为当前结果，请重新运行。'
            : '输入已更新；请在确认后运行回测。',
        replayProgress: null,
        replayError: ''
      }
    })
  }

  private getSequenceValidation = (): ManualSequenceValidation => validateManualSignalSequence(
    this.state.signals,
    this.state.activeQuery ? this.state.activeQuery.endDate : undefined
  )

  private getSignalIssuesById = (validation: ManualSequenceValidation): { [key: number]: ManualSequenceIssue[] } => {
    const issuesBySignalId: { [key: number]: ManualSequenceIssue[] } = {}
    validation.issues.forEach(issue => {
      issuesBySignalId[issue.signalId] = (issuesBySignalId[issue.signalId] || []).concat(issue)
    })
    return issuesBySignalId
  }

  private getOpenSignalIds = (validation: ManualSequenceValidation): Set<number> => {
    const openSignalIds = new Set<number>()
    const sequence = validation.standardizedSequence
    if (sequence) {
      sequence.trades.filter(trade => trade.status === 'open').forEach(trade => {
        openSignalIds.add(trade.entrySignal.id)
      })
    }
    return openSignalIds
  }

  private searchFunds = async (query: string, version: number) => {
    try {
      const fundOptions = await getFundInfo(query)
      if (version === this.searchVersion) {
        this.setState({ fundOptions, searchingFunds: false, fundSearchError: '' })
      }
    } catch (error) {
      if (version === this.searchVersion) {
        this.setState({
          fundOptions: [],
          searchingFunds: false,
          fundSearchError: errorMessage(error)
        })
      }
    }
  }

  private handleFundSearch = (value: string) => {
    const query = String(value || '').trim()
    const version = ++this.searchVersion
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout)
      this.searchTimeout = null
    }
    if (!query) {
      this.setState({ fundOptions: [], searchingFunds: false, fundSearchError: '' })
      return
    }
    if (/^\d{6}$/.test(query)) {
      this.setState({
        fundOptions: [{ code: query, name: `基金代码 ${query}` }],
        searchingFunds: false,
        fundSearchError: ''
      })
      return
    }
    this.setState({ searchingFunds: true, fundSearchError: '' })
    this.searchTimeout = setTimeout(() => this.searchFunds(query, version), 300)
  }

  private handleFundChange = (value: string) => {
    const draftFundCode = String(value || '')
    if (draftFundCode !== this.state.draftFundCode) {
      this.invalidateReplayInputs()
    }
    this.setState({ draftFundCode, error: '' })
  }

  private handleDateChange = (field: 'draftStartDate' | 'draftEndDate') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value
    if (value !== this.state[field]) {
      this.invalidateReplayInputs()
    }
    this.setState({ [field]: value, error: '' } as Pick<ManualWorkspaceState, 'draftStartDate' | 'draftEndDate' | 'error'>)
  }

  private submitQuery = (event?: FormEvent<HTMLFormElement>) => {
    if (event) {
      event.preventDefault()
    }
    if (this.state.loading || this.state.pendingSelection) {
      return
    }

    const query: ManualQuery = {
      fundCode: this.state.draftFundCode.trim(),
      startDate: this.state.draftStartDate,
      endDate: this.state.draftEndDate
    }
    if (!/^\d{6}$/.test(query.fundCode)) {
      this.setState({ error: '请选择搜索结果或输入 6 位基金代码。' })
      return
    }
    if (!query.startDate || !query.endDate || query.startDate > query.endDate) {
      this.setState({ error: '请选择有效的开始日期和结束日期。' })
      return
    }

    this.invalidateReplayInputs()
    this.setState({ loading: true, error: '', chartDateChoices: [] })
    loadManualHistory(query.fundCode, query.startDate, query.endDate).then(quotes => {
      const previousFund = this.state.activeQuery ? this.state.activeQuery.fundCode : ''
      const invalidSignals = getSignalsInvalidatedByQuery(
        this.state.signals,
        previousFund,
        query,
        quotes
      )
      if (invalidSignals.length > 0) {
        this.setState({
          loading: false,
          pendingSelection: { query, quotes, invalidSignals }
        })
        return
      }
      this.commitSelection(query, quotes, [])
    }).catch(error => {
      this.setState({
        loading: false,
        error: errorMessage(error)
      })
    })
  }

  private commitSelection = (query: ManualQuery, quotes: ManualQuote[], invalidSignals: ManualSignal[]) => {
    const invalidIds = new Set(invalidSignals.map(signal => signal.id))
    this.setState((previousState) => {
      const signals = previousState.signals.filter(signal => !invalidIds.has(signal.id))
      const selectedSignalId = previousState.selectedSignalId !== null
        && signals.some(signal => signal.id === previousState.selectedSignalId)
        ? previousState.selectedSignalId
        : null
      const selectedDate = previousState.selectedDate && hasManualQuoteDate(quotes, previousState.selectedDate)
        ? previousState.selectedDate
        : (quotes.length > 0 ? quotes[0].date : '')
      return {
        activeQuery: query,
        draftFundCode: query.fundCode,
        draftStartDate: query.startDate,
        draftEndDate: query.endDate,
        quotes,
        signals,
        selectedSignalId,
        selectedDate,
        chartDateChoices: [],
        pendingSelection: null,
        loading: false,
        error: '',
        undo: null
      }
    })
  }

  private cancelPendingSelection = () => {
    this.setState((previousState) => ({
      pendingSelection: null,
      draftFundCode: previousState.activeQuery ? previousState.activeQuery.fundCode : previousState.draftFundCode,
      draftStartDate: previousState.activeQuery ? previousState.activeQuery.startDate : previousState.draftStartDate,
      draftEndDate: previousState.activeQuery ? previousState.activeQuery.endDate : previousState.draftEndDate
    }))
  }

  private confirmPendingSelection = () => {
    const pending = this.state.pendingSelection
    if (pending) {
      this.commitSelection(pending.query, pending.quotes, pending.invalidSignals)
    }
  }

  private selectDate = (date: string) => {
    if (hasManualQuoteDate(this.state.quotes, date)) {
      this.setState({ selectedDate: date, selectedSignalId: null, chartDateChoices: [] })
    }
  }

  private cancelChartDateChoices = () => {
    this.setState({ chartDateChoices: [] })
  }

  private handleChartClick = (event: React.MouseEvent<SVGSVGElement>) => {
    // A keyboard-generated click is handled by the focused point's key handler.
    if (event.nativeEvent.detail === 0) {
      return
    }
    const svg = event.currentTarget
    const screenMatrix = svg.getScreenCTM()
    if (!screenMatrix) {
      return
    }
    const pointer = svg.createSVGPoint()
    pointer.x = event.clientX
    pointer.y = event.clientY
    const chartPoint = pointer.matrixTransform(screenMatrix.inverse())
    const screenScaleX = Math.sqrt(screenMatrix.a * screenMatrix.a + screenMatrix.b * screenMatrix.b)
    const screenScaleY = Math.sqrt(screenMatrix.c * screenMatrix.c + screenMatrix.d * screenMatrix.d)
    const minScreenScale = Math.min(screenScaleX, screenScaleY)
    const viewBoxUnitsPerScreenPixel = Number.isFinite(minScreenScale) && minScreenScale > 0
      ? 1 / minScreenScale
      : 1
    const candidates = getManualChartHitCandidates(
      plotManualHistory(this.state.quotes),
      chartPoint.x,
      chartPoint.y,
      this.state.selectedDate,
      viewBoxUnitsPerScreenPixel
    )

    if (candidates.length === 1) {
      this.selectDate(candidates[0].date)
    } else if (candidates.length > 1) {
      // Preserve the current date until the user explicitly chooses one.
      this.setState({ chartDateChoices: candidates.map(point => point.date) })
    } else if (this.state.chartDateChoices.length > 0) {
      this.cancelChartDateChoices()
    }
  }

  private handleChartPointKeyDown = (date: string, event: KeyboardEvent<SVGCircleElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.selectDate(date)
    }
  }

  private addSignal = (type: ManualSignalType) => {
    const { selectedDate, quotes, chartDateChoices } = this.state
    if (chartDateChoices.length > 0 || !hasManualQuoteDate(quotes, selectedDate)) {
      return
    }
    this.invalidateReplayInputs()
    this.setState((previousState) => {
      const signal: ManualSignal = {
        id: previousState.nextSignalId,
        date: selectedDate,
        type
      }
      return {
        signals: sortManualSignals(previousState.signals.concat(signal)),
        selectedSignalId: signal.id,
        nextSignalId: previousState.nextSignalId + 1,
        undo: {
          signals: previousState.signals.slice(),
          selectedSignalId: previousState.selectedSignalId
        }
      }
    })
  }

  private removeSignal = (id: number, event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    this.invalidateReplayInputs()
    this.setState((previousState) => ({
      signals: previousState.signals.filter(signal => signal.id !== id),
      selectedSignalId: previousState.selectedSignalId === id ? null : previousState.selectedSignalId,
      undo: {
        signals: previousState.signals.slice(),
        selectedSignalId: previousState.selectedSignalId
      }
    }))
  }

  private selectSignal = (signal: ManualSignal) => {
    this.setState({ selectedSignalId: signal.id, selectedDate: signal.date, chartDateChoices: [] })
  }

  private undoLastEdit = () => {
    const snapshot = this.state.undo
    if (!snapshot) {
      return
    }
    this.invalidateReplayInputs()
    this.setState({
      signals: snapshot.signals,
      selectedSignalId: snapshot.selectedSignalId,
      undo: null
    })
  }

  private handleReplayConfigChange = (field: keyof ManualReplayFormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value
    if (value !== this.state.replayConfig[field]) {
      this.invalidateReplayInputs()
    }
    this.setState(previousState => ({
      replayConfig: { ...previousState.replayConfig, [field]: value }
    }))
  }

  private executeReplay = (
    validation: ManualSequenceValidation,
    quotes: ManualQuote[],
    range: { startDate: string, endDate: string },
    config: ManualReplayConfig,
    cancellation: ManualReplayCancellation,
    onProgress: (processedDates: number, totalDates: number) => void
  ): Promise<ManualReplayResult> => runManualReplayCooperatively(validation, quotes, range, config, {
    isCancelled: () => cancellation.cancelled,
    onProgress
  })

  private runReplay = () => {
    if (this.replayExecutionPending || this.state.replayStatus === 'running') {
      return
    }
    const validation = this.getSequenceValidation()
    const query = this.state.activeQuery
    if (!query || this.state.quotes.length === 0) {
      this.setState({
        replayStatus: 'failure',
        replayStatusMessage: '本次运行失败；点位和参数已保留，可以修正后重试。',
        replayError: '请先加载所选区间内的有效基金净值。'
      })
      return
    }
    if (!validation.isValid || !validation.standardizedSequence) {
      this.setState({
        replayStatus: 'failure',
        replayStatusMessage: '本次运行失败；点位和参数已保留，可以修正后重试。',
        replayError: '信号序列未通过 #3 校验；请先修正清单中的问题。'
      })
      return
    }
    const input = this.state.replayConfig
    const missing = Object.keys(input).filter(key => !input[key as keyof ManualReplayFormState].trim())
    if (missing.length > 0) {
      this.setState({
        replayStatus: 'failure',
        replayStatusMessage: '本次运行失败；点位和参数已保留，可以修正后重试。',
        replayError: '请显式填写初始资金、每笔买入金额、买入/卖出费率和买入/卖出滑点；系统不设置猜测值。'
      })
      return
    }
    const config: ManualReplayConfig = {
      initialCash: Number(input.initialCash),
      buyAmount: Number(input.buyAmount),
      buyFeeRatePercent: Number(input.buyFeeRatePercent),
      sellFeeRatePercent: Number(input.sellFeeRatePercent),
      buySlippageRatePercent: Number(input.buySlippageRatePercent),
      sellSlippageRatePercent: Number(input.sellSlippageRatePercent)
    }
    const requestId = ++this.replayRequestId
    const inputRevision = this.state.replayInputRevision
    const quotes = this.state.quotes.slice()
    const range = { startDate: query.startDate, endDate: query.endDate }
    const cancellation: ManualReplayCancellation = { cancelled: false }
    this.activeReplayCancellation = cancellation
    this.replayExecutionPending = true
    this.setState({
      replayStatus: 'running',
      replayStatusMessage: '正在按已确认的基金、区间、信号和参数运行；可取消本次运行。',
      replayProgress: { processedDates: 0, totalDates: quotes.length },
      replayError: ''
    })
    // Yield a paint opportunity so the busy state and cancel control are visible before local calculation starts.
    this.replayStartTimer = setTimeout(() => {
      this.replayStartTimer = null
      if (requestId !== this.replayRequestId) {
        return
      }
      Promise.resolve().then(() => this.executeReplay(validation, quotes, range, config, cancellation, (processedDates, totalDates) => {
        if (requestId !== this.replayRequestId || cancellation.cancelled) {
          return
        }
        this.setState({
          replayProgress: { processedDates, totalDates },
          replayStatusMessage: `正在处理 ${processedDates} / ${totalDates} 个净值日期；可取消本次运行。`
        })
      })).then(replayResult => {
        if (requestId !== this.replayRequestId || inputRevision !== this.state.replayInputRevision) {
          return
        }
        this.replayExecutionPending = false
        this.activeReplayCancellation = null
        this.setState({
          replayResult,
          replayResultRevision: inputRevision,
          replayStatus: 'success',
          replayStatusMessage: '运行成功；结果与当前点位和全部回测参数一致。',
          replayError: ''
        })
      }).catch(error => {
        if (error instanceof ManualReplayCancelledError) {
          if (requestId === this.replayRequestId && inputRevision === this.state.replayInputRevision) {
            this.replayExecutionPending = false
            this.activeReplayCancellation = null
            this.setState({
              replayStatus: 'cancelled',
              replayStatusMessage: '已取消；本次运行的部分结果不会展示，点位和参数已完整保留。',
              replayError: ''
            })
          }
          return
        }
        if (requestId !== this.replayRequestId || inputRevision !== this.state.replayInputRevision) {
          return
        }
        this.replayExecutionPending = false
        this.activeReplayCancellation = null
        this.setState({
          replayStatus: 'failure',
          replayStatusMessage: '运行失败；未展示本次部分结果，点位和参数均已保留，可使用相同输入重试。',
          replayError: errorMessage(error)
        })
      })
    }, 50)
  }

  private cancelReplay = () => {
    if (!this.replayExecutionPending && this.state.replayStatus !== 'running') {
      return
    }
    if (this.activeReplayCancellation) {
      this.activeReplayCancellation.cancelled = true
      this.activeReplayCancellation = null
    }
    this.replayRequestId += 1
    this.replayExecutionPending = false
    if (this.replayStartTimer) {
      clearTimeout(this.replayStartTimer)
      this.replayStartTimer = null
    }
    this.setState({
      replayStatus: 'cancelled',
      replayStatusMessage: '已取消；本次运行的部分结果不会展示，点位和参数已完整保留。',
      replayError: ''
    })
  }

  private renderHistoryChart = () => {
    const { quotes, signals, selectedDate, selectedSignalId } = this.state
    const plotted = plotManualHistory(quotes)
    if (plotted.length === 0) {
      return null
    }
    const pointsAttribute = plotted.map(point => `${point.x},${point.y}`).join(' ')
    const minVal = Math.min.apply(null, quotes.map(item => item.val))
    const maxVal = Math.max.apply(null, quotes.map(item => item.val))
    const signalsByDate: Record<string, ManualSignal[]> = {}
    signals.forEach(signal => {
      signalsByDate[signal.date] = (signalsByDate[signal.date] || []).concat(signal)
    })
    const sequenceValidation = this.getSequenceValidation()
    const issuesBySignalId = this.getSignalIssuesById(sequenceValidation)
    const openSignalIds = this.getOpenSignalIds(sequenceValidation)

    return <div className={styles.chartWrap}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="group"
        aria-label="基金历史单位净值图；选择一个实际净值点以编辑手动买卖信号"
        onClick={this.handleChartClick}
      >
        <rect x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} fill="transparent" pointerEvents="all" aria-hidden="true" />
        <line x1={PLOT_LEFT} y1={PLOT_BOTTOM} x2={PLOT_RIGHT} y2={PLOT_BOTTOM} className={styles.axis} />
        <line x1={PLOT_LEFT} y1={PLOT_TOP} x2={PLOT_LEFT} y2={PLOT_BOTTOM} className={styles.axis} />
        <text x={PLOT_LEFT} y={20} className={styles.axisLabel}>{maxVal.toFixed(4)}</text>
        <text x={PLOT_LEFT} y={PLOT_BOTTOM - 5} className={styles.axisLabel}>{minVal.toFixed(4)}</text>
        {plotted.length > 1
          ? <polyline points={pointsAttribute} className={styles.line} />
          : null}
        {plotted.map(point => {
          const isSelected = selectedDate === point.date
          const dateSignals = signalsByDate[point.date] || []
          return <g key={point.date}>
            {dateSignals.map((signal, index) => {
              const offset = (index - (dateSignals.length - 1) / 2) * 15
              const markerY = Math.max(18, point.y - 20)
              const signalIssues = issuesBySignalId[signal.id] || []
              const issueLabel = signalIssues.length > 0
                ? `；校验提示：${signalIssues.map(issue => issue.message).join('；')}`
                : openSignalIds.has(signal.id)
                  ? '；序列校验通过，期末未平仓且尚未估值'
                  : '；序列校验通过'
              return <g
                key={signal.id}
                role="img"
                aria-label={`${signal.date} ${signal.type === 'buy' ? '买入' : '卖出'}点${issueLabel}`}
              >
                <circle
                  cx={point.x + offset}
                  cy={markerY}
                  r={8}
                  fill={signal.type === 'buy' ? '#237804' : '#cf1322'}
                  className={signalIssues.length > 0
                    ? `${styles.signalMarker} ${styles.invalidSignalMarker}`
                    : styles.signalMarker}
                />
                <text x={point.x + offset} y={markerY + 3} textAnchor="middle" className={styles.signalMarkerText}>
                  {signal.type === 'buy' ? '买' : '卖'}
                </text>
              </g>
            })}
            {isSelected ? <circle
              cx={point.x}
              cy={point.y}
              r={MANUAL_CHART_SELECTED_RING_RADIUS}
              strokeWidth={MANUAL_CHART_SELECTED_RING_STROKE_WIDTH}
              className={styles.selectedRing}
            /> : null}
            <circle
              cx={point.x}
              cy={point.y}
              r={isSelected ? MANUAL_CHART_SELECTED_POINT_RADIUS : MANUAL_CHART_POINT_RADIUS}
              strokeWidth={MANUAL_CHART_POINT_STROKE_WIDTH}
              className={styles.quotePoint}
              role="button"
              tabIndex={0}
              aria-label={`选择净值日期 ${point.date}，单位净值 ${point.val.toFixed(4)}`}
              onKeyDown={event => this.handleChartPointKeyDown(point.date, event)}
            />
          </g>
        })}
        <text x={PLOT_LEFT} y={CHART_HEIGHT - 14} className={styles.axisLabel}>{quotes[0].date}</text>
        <text x={PLOT_RIGHT} y={CHART_HEIGHT - 14} textAnchor="end" className={styles.axisLabel}>{quotes[quotes.length - 1].date}</text>
      </svg>
      <div className={styles.chartLegend}>
        <span><i className={styles.buyLegend} />买入点</span>
        <span><i className={styles.sellLegend} />卖出点</span>
        <span>图上重叠点会先显示候选日期；也可用下方选项精确选择实际净值交易日。</span>
        <span>红色描边点位存在校验问题或待确认规则；详情见清单。</span>
      </div>
      {selectedSignalId !== null
        ? <span className={styles.srOnly}>当前选中点位编号 {selectedSignalId}</span>
        : null}
    </div>
  }

  render() {
    const {
      draftFundCode,
      draftStartDate,
      draftEndDate,
      fundOptions,
      searchingFunds,
      fundSearchError,
      activeQuery,
      quotes,
      signals,
      selectedDate,
      chartDateChoices,
      selectedSignalId,
      undo,
      pendingSelection,
      loading,
      error,
      replayConfig,
      replayResult,
      replayError,
      replayStatus,
      replayStatusMessage,
      replayProgress,
      replayInputRevision,
      replayResultRevision
    } = this.state
    const orderedSignals = sortManualSignals(signals)
    const selectedQuote = quotes.filter(item => item.date === selectedDate)[0]
    const sequenceValidation = this.getSequenceValidation()
    const issuesBySignalId = this.getSignalIssuesById(sequenceValidation)
    const openSignalIds = this.getOpenSignalIds(sequenceValidation)
    const openTradeCount = sequenceValidation.standardizedSequence
      ? sequenceValidation.standardizedSequence.trades.filter(trade => trade.status === 'open').length
      : 0
    const validSequenceDescription = signals.length === 0
      ? '当前没有点位；添加、移除或撤销后会自动重新校验。'
      : openTradeCount > 0
        ? `信号序列合法；${openTradeCount} 笔持仓仍未平仓。这里只输出未平仓状态，不计算或声称期末估值；估值由独立回测引擎范围处理。`
        : '当前点位符合多头单持仓顺序约束。'
    const replayResultIsStale = Boolean(replayResult && replayResultRevision !== replayInputRevision)
    const replayStatusLabel: Record<ManualReplayStatus, string> = {
      idle: '待运行',
      running: '运行中',
      success: '成功',
      failure: '失败，可重试',
      cancelled: '已取消'
    }
    const replayStatusType: Record<ManualReplayStatus, 'info' | 'success' | 'warning' | 'error'> = {
      idle: 'info',
      running: 'info',
      success: 'success',
      failure: 'error',
      cancelled: 'warning'
    }
    const previewValue = (value: string, suffix: string = '') => value.trim()
      ? `${value}${suffix}`
      : `待填写（无默认值）${suffix}`
    const queryDraftChanged = Boolean(activeQuery && (
      draftFundCode.trim() !== activeQuery.fundCode
      || draftStartDate !== activeQuery.startDate
      || draftEndDate !== activeQuery.endDate
    ))

    return <main className={styles.workspace}>
      <header className={styles.intro}>
        <h2>手动回测工作区</h2>
        <p>选择基金和日期范围，在历史单位净值图上标记买入或卖出信号。点位只作为回测输入，不会发送真实交易委托。</p>
      </header>

      <Card title="基金与日期范围" className={styles.queryCard}>
        <form onSubmit={this.submitQuery}>
          <div className={styles.queryGrid}>
            <label className={styles.field}>
              <span>基金（输入名称或 6 位代码）</span>
              <Select
                showSearch
                allowClear
                showArrow={false}
                filterOption={false}
                value={draftFundCode || undefined}
                placeholder="搜索基金名称或代码"
                disabled={loading || !!pendingSelection}
                notFoundContent={searchingFunds ? <Spin size="small" /> : (fundSearchError || '输入名称搜索，或输入 6 位代码')}
                onSearch={this.handleFundSearch}
                onChange={this.handleFundChange}
              >
                {fundOptions.map(item => <Option key={item.code} value={item.code}>{item.name} [{item.code}]</Option>)}
              </Select>
              {fundSearchError ? <small className={styles.searchError}>{fundSearchError}</small> : null}
            </label>
            <label className={styles.field}>
              <span>开始日期</span>
              <Input
                type="date"
                value={draftStartDate}
                disabled={loading || !!pendingSelection}
                onChange={this.handleDateChange('draftStartDate')}
              />
            </label>
            <label className={styles.field}>
              <span>结束日期</span>
              <Input
                type="date"
                value={draftEndDate}
                disabled={loading || !!pendingSelection}
                onChange={this.handleDateChange('draftEndDate')}
              />
            </label>
          </div>
          <div className={styles.queryActions}>
            <Button type="primary" htmlType="submit" loading={loading} disabled={!!pendingSelection}>加载历史净值</Button>
            {activeQuery ? <span className={styles.activeRange}>当前：{activeQuery.fundCode} · {activeQuery.startDate} 至 {activeQuery.endDate}</span> : null}
          </div>
        </form>
      </Card>

      {error ? <Alert className={styles.feedback} type="error" showIcon message="无法加载基金净值" description={error} /> : null}
      {loading ? <div className={styles.loading}><Spin tip="正在读取基金历史净值…" /></div> : null}
      {!loading && activeQuery && quotes.length === 0
        ? <Alert className={styles.feedback} type="info" showIcon message="所选范围暂无可显示的净值" description="请检查基金代码或扩大日期范围后重试。" />
        : null}
      {activeQuery && !loading ? <div className={styles.validationSummary} role="status" aria-live="polite">
        <Alert
          className={styles.validationAlert}
          type={sequenceValidation.isValid ? 'success' : 'error'}
          showIcon
          message={sequenceValidation.isValid
            ? '买卖信号序列校验通过'
            : `有 ${sequenceValidation.issues.length} 个需要处理的序列问题`}
          description={sequenceValidation.isValid
            ? validSequenceDescription
            : '请按清单中的具体提示修正。点位不会被自动丢弃或重排；同日相反信号必须由用户调整，系统不会猜测顺序。'}
        />
        <p className={styles.engineNotice}>有效序列可进入独立的历史模拟引擎；非法序列不会被修补或重排。引擎不会调用旧自动策略，也不会发送真实订单。</p>
      </div> : null}

      {quotes.length > 0 ? <div className={styles.workspaceGrid}>
        <Card title="历史单位净值" className={styles.chartCard}>
          <p className={styles.chartSummary}>{activeQuery ? `${activeQuery.fundCode} · ${quotes.length} 个实际净值交易日` : ''}</p>
          {this.renderHistoryChart()}
          {chartDateChoices.length > 0 ? <div className={styles.chartDisambiguation} role="group" aria-label="选择图表重叠区域对应的净值日期" aria-live="polite">
            <p>这个点击位置覆盖多个净值点；当前选择未更改。请明确选择目标日期：</p>
            <div className={styles.chartDateOptions}>
              {chartDateChoices.map(date => {
                const quote = quotes.find(item => item.date === date)
                return quote ? <Button key={date} size="small" onClick={() => this.selectDate(date)}>
                  {date} · 净值 {quote.val.toFixed(4)}
                </Button> : null
              })}
              <Button size="small" onClick={this.cancelChartDateChoices}>取消选择</Button>
            </div>
          </div> : null}
          <div className={styles.selectedQuote}>
            {selectedQuote
              ? <span>选中实际交易日：<strong>{selectedQuote.date}</strong>　单位净值：<strong>{selectedQuote.val.toFixed(4)}</strong></span>
              : <span>请在图上选择一个实际净值交易日。</span>}
          </div>
          <label className={styles.dateSelector}>
            <span>精确选择交易日</span>
            <Select
              value={selectedDate || undefined}
              placeholder="请选择有净值的交易日"
              showSearch
              optionFilterProp="children"
              onChange={this.selectDate}
            >
              {quotes.map(item => <Option key={item.date} value={item.date}>{item.date} · 净值 {item.val.toFixed(4)}</Option>)}
            </Select>
          </label>
          <div className={styles.signalActions}>
            <Button type="primary" disabled={!selectedQuote || chartDateChoices.length > 0} onClick={() => this.addSignal('buy')}>添加买入点</Button>
            <Button type="danger" disabled={!selectedQuote || chartDateChoices.length > 0} onClick={() => this.addSignal('sell')}>添加卖出点</Button>
            <Button disabled={!undo} onClick={this.undoLastEdit}>撤销最近一次点位操作</Button>
          </div>
        </Card>

        <Card title={`点位清单（${signals.length}）`} className={styles.listCard}>
          {orderedSignals.length === 0
            ? <p className={styles.emptyList}>尚未添加手动买卖点。先从图上选择一个实际净值日期，再添加信号。</p>
            : <div className={styles.tableWrap}>
              <table className={styles.signalTable}>
                <thead><tr><th>信号</th><th>日期</th><th>校验提示</th><th>操作</th></tr></thead>
                <tbody>
                  {orderedSignals.map(signal => {
                    const signalIssues = issuesBySignalId[signal.id] || []
                    const rowClass = [
                      selectedSignalId === signal.id ? styles.selectedRow : '',
                      signalIssues.length > 0 ? styles.invalidSignalRow : ''
                    ].filter(Boolean).join(' ')
                    return <tr
                      key={signal.id}
                      className={rowClass}
                      onClick={() => this.selectSignal(signal)}
                      aria-selected={selectedSignalId === signal.id}
                      aria-describedby={signalIssues.length > 0 ? `signal-validation-${signal.id}` : undefined}
                    >
                      <td><span className={signal.type === 'buy' ? styles.buyType : styles.sellType}>{signal.type === 'buy' ? '买入' : '卖出'}</span></td>
                      <td>{signal.date}</td>
                      <td>
                        {signalIssues.length > 0
                          ? <ul id={`signal-validation-${signal.id}`} className={styles.validationIssueList}>
                            {signalIssues.map(issue => <li key={issue.code} className={styles.validationIssue}>{issue.message}</li>)}
                          </ul>
                          : <span className={styles.validSignal}>{openSignalIds.has(signal.id) ? '期末未平仓（尚未估值）' : '序列有效'}</span>}
                      </td>
                      <td><Button size="small" onClick={event => this.removeSignal(signal.id, event)}>移除</Button></td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>}
          <p className={styles.disclaimer}>此清单记录本地手动回测输入；只有显式填写参数并主动运行后才执行历史模拟，不会提交任何真实订单。</p>
        </Card>
      </div> : null}

      {activeQuery && quotes.length > 0 ? <Card title="手动回放参数（全部必填，无默认数值）" className={styles.replayCard}>
        <h3>本次运行前确认</h3>
        <dl className={styles.replaySummary}>
          <div><dt>基金与区间</dt><dd>{activeQuery.fundCode} · {activeQuery.startDate} 至 {activeQuery.endDate}</dd></div>
          <div><dt>本次信号清单</dt><dd>{orderedSignals.length > 0
            ? orderedSignals.map(signal => `${signal.date} ${signal.type === 'buy' ? '买入' : '卖出'}`).join('；')
            : '无信号'}</dd></div>
          <div><dt>成交日期规则</dt><dd>默认在信号日后的下一条区间内有效净值成交；信号日与成交日分开记录</dd></div>
          <div><dt>待应用的基金/区间修改</dt><dd>{queryDraftChanged ? '有修改尚未加载；先加载并确认新范围后才能运行。' : '无'}</dd></div>
          <div><dt>初始资金</dt><dd>{previewValue(replayConfig.initialCash, ' 元')}</dd></div>
          <div><dt>每笔固定买入金额</dt><dd>{previewValue(replayConfig.buyAmount, ' 元；费前金额')}</dd></div>
          <div><dt>买入 / 卖出费用</dt><dd>{previewValue(replayConfig.buyFeeRatePercent, '%')} / {previewValue(replayConfig.sellFeeRatePercent, '%')}；按成交名义金额计费</dd></div>
          <div><dt>买入 / 卖出滑点</dt><dd>{previewValue(replayConfig.buySlippageRatePercent, '%')} / {previewValue(replayConfig.sellSlippageRatePercent, '%')}；按比例调整成交净值</dd></div>
          <div><dt>红利与基金事件</dt><dd>仅明确每份现金红利按规则复投；事件先于当日订单；未知事件空仓警示、持仓报错</dd></div>
        </dl>
        <p className={styles.formulaNotice}>金额与费率均须由本次输入明确确认；费率即使为 0 也必须显式输入，系统不会补默认值。买入手续费另扣；明确分红按 #4 已确认公式复投；不明确的费用、金额或事件口径不会猜测。</p>
        <div className={styles.replayConfigGrid}>
          <label className={styles.field}>
            <span>初始现金（元）</span>
            <Input type="number" min="0" step="any" value={replayConfig.initialCash} placeholder="必填；无默认值" onChange={this.handleReplayConfigChange('initialCash')} />
          </label>
          <label className={styles.field}>
            <span>每笔买入费前金额（元）</span>
            <Input type="number" min="0" step="any" value={replayConfig.buyAmount} placeholder="必填；无默认值" onChange={this.handleReplayConfigChange('buyAmount')} />
          </label>
          <label className={styles.field}>
            <span>买入费率（%）</span>
            <Input type="number" min="0" step="any" value={replayConfig.buyFeeRatePercent} placeholder="必填；可明确输入 0" onChange={this.handleReplayConfigChange('buyFeeRatePercent')} />
          </label>
          <label className={styles.field}>
            <span>卖出费率（%）</span>
            <Input type="number" min="0" step="any" value={replayConfig.sellFeeRatePercent} placeholder="必填；可明确输入 0" onChange={this.handleReplayConfigChange('sellFeeRatePercent')} />
          </label>
          <label className={styles.field}>
            <span>买入滑点（%）</span>
            <Input type="number" min="0" step="any" value={replayConfig.buySlippageRatePercent} placeholder="必填；可明确输入 0" onChange={this.handleReplayConfigChange('buySlippageRatePercent')} />
          </label>
          <label className={styles.field}>
            <span>卖出滑点（%）</span>
            <Input type="number" min="0" step="any" value={replayConfig.sellSlippageRatePercent} placeholder="必填；可明确输入 0" onChange={this.handleReplayConfigChange('sellSlippageRatePercent')} />
          </label>
        </div>
        <p className={styles.formulaNotice}>口径明示：每笔买入按此处填写的固定费前名义金额下单；卖出信号平掉单笔未平仓交易的全部份额。买入费另计；费用 = 对应成交名义金额 × 显式费率。买入成交净值 = 当日净值 × (1 + 买入滑点%)；卖出成交净值 = 当日净值 × (1 - 卖出滑点%)。资金不足不截断订单；所有金额/费率均由本次模拟参数提供。</p>
        <div className={styles.replayActions}>
          <Button type="primary" disabled={!sequenceValidation.isValid || loading || !!pendingSelection || queryDraftChanged || replayStatus === 'running'} onClick={this.runReplay}>
            {replayStatus === 'failure' ? '使用当前参数重试' : replayStatus === 'success' ? '重新运行模拟回测' : '运行模拟回测'}
          </Button>
          {replayStatus === 'running' ? <Button onClick={this.cancelReplay}>取消本次运行</Button> : null}
          <span>信号次日后的下一条区间内有效净值成交；信号日和成交日分别展示。</span>
        </div>
        <div className={styles.replayStatus} role="status" aria-live="polite">
          <Alert
            type={replayStatusType[replayStatus]}
            showIcon
            message={`运行状态：${replayStatusLabel[replayStatus]}`}
            description={replayStatusMessage}
          />
          {replayStatus === 'running' ? <Spin size="small" tip="正在计算历史模拟…" /> : null}
          {replayStatus === 'running' && replayProgress ? <div aria-live="polite">
            <progress max={replayProgress.totalDates} value={replayProgress.processedDates} aria-label="手动回放进度" />
            <span> 已处理 {replayProgress.processedDates} / {replayProgress.totalDates} 个净值日期</span>
          </div> : null}
        </div>
        {replayError ? <Alert className={styles.feedback} type="error" showIcon message="无法完成手动回放" description={replayError} /> : null}
      </Card> : null}

      {replayResult ? <Card title={replayResultIsStale ? '逐日模拟结果（已过期）' : '逐日模拟结果'} className={styles.replayCard}>
        {replayResultIsStale ? <Alert
          className={styles.feedback}
          type="warning"
          showIcon
          message="此结果基于先前输入，已过期，不可作为当前点位或参数的结果。"
          description="点位、基金/日期范围或回测参数已变化；用户输入仍保留，请重新运行后再使用结果。"
        /> : null}
        <Alert type="warning" showIcon message="仅历史模拟，不会向真实账户下单" description={replayResult.summary.endingPositionStatus === 'open'
          ? `期末持仓仍为 open/unclosed，按 ${replayResult.summary.lastNavDate} 最后有效净值估值；不合成卖出，也不计入已完成交易。`
          : '所有成交按显式参数回放；本结果不代表实盘成交或真实收益。'} />
        <dl className={styles.replaySummary}>
          <div><dt>期末总资产</dt><dd>{replayResult.summary.endingTotalAssets.toFixed(2)} 元</dd></div>
          <div><dt>现金余额</dt><dd>{replayResult.summary.endingCash.toFixed(2)} 元</dd></div>
          <div><dt>累计红利复投</dt><dd>{replayResult.summary.totalDividendReinvested.toFixed(2)} 元（已同步计入份额）</dd></div>
          <div><dt>期末持仓估值</dt><dd>{replayResult.summary.openPositionValue.toFixed(2)} 元</dd></div>
          <div><dt>持仓状态</dt><dd>{replayResult.summary.endingPositionStatus === 'open' ? 'open / 未平仓' : 'flat / 空仓'}</dd></div>
          <div><dt>已完成交易</dt><dd>{replayResult.summary.completedTradeCount} 笔</dd></div>
          <div><dt>未平仓交易</dt><dd>{replayResult.summary.openTradeCount} 笔（不计入已完成）</dd></div>
          <div><dt>已实现收益</dt><dd>{replayResult.summary.realizedProfit.toFixed(2)} 元</dd></div>
          <div><dt>未实现估值变动</dt><dd>{replayResult.summary.unrealizedProfit.toFixed(2)} 元</dd></div>
          <div><dt>总资产变动（含未平仓估值）</dt><dd>{replayResult.summary.totalProfit.toFixed(2)} 元 · {replayResult.summary.totalReturnRatePercent.toFixed(2)}%</dd></div>
          <div><dt>最后有效净值</dt><dd>{replayResult.summary.lastNavDate} · {replayResult.summary.lastNav.toFixed(4)}</dd></div>
        </dl>

        <h3>交易账本（信号日与成交日分列）</h3>
        {replayResult.trades.length === 0
          ? <p className={styles.emptyList}>没有交易信号；结果仅显示区间现金快照。</p>
          : <div className={styles.tableWrap}>
            <table className={styles.replayTable}>
              <thead><tr><th>状态</th><th>买入信号日 → 成交日</th><th>买入净值 / 成交净值</th><th>卖出信号日 → 成交日</th><th>卖出净值 / 成交净值</th><th>份额</th><th>买入费</th><th>卖出费</th><th>已实现收益 / 期末估值</th></tr></thead>
              <tbody>{replayResult.trades.map((trade, index) => <tr key={`${trade.entrySignalDate}-${index}`}>
                <td>{trade.status === 'open' ? 'open / 未平仓' : 'closed / 已完成'}</td>
                <td>{trade.entrySignalDate} → {trade.entryExecutionDate}</td>
                <td>{trade.entryMarketNav.toFixed(4)} / {trade.entryFillNav.toFixed(4)}</td>
                <td>{trade.exitSignalDate || '—'} → {trade.exitExecutionDate || '—'}</td>
                <td>{trade.exitMarketNav === null ? '—' : `${trade.exitMarketNav.toFixed(4)} / ${trade.exitFillNav!.toFixed(4)}`}</td>
                <td>{trade.shares.toFixed(6)}</td>
                <td>{trade.entryFee.toFixed(2)}</td>
                <td>{trade.exitFee === null ? '—' : trade.exitFee.toFixed(2)}</td>
                <td>{trade.status === 'open' ? `期末估值 ${Number(trade.currentValue).toFixed(2)}` : `${Number(trade.realizedProfit).toFixed(2)} 元`}</td>
              </tr>)}</tbody>
            </table>
          </div>}

        <h3>逐日资产快照</h3>
        <div className={styles.tableWrap}>
          <table className={styles.replayTable}>
            <thead><tr><th>日期</th><th>净值</th><th>现金</th><th>当日红利复投</th><th>份额</th><th>持仓估值</th><th>总资产</th><th>持仓状态</th><th>已完成交易数</th></tr></thead>
            <tbody>{replayResult.dailySnapshots.map(snapshot => <tr key={snapshot.date}>
              <td>{snapshot.date}</td><td>{snapshot.nav.toFixed(4)}</td><td>{snapshot.cash.toFixed(2)}</td>
              <td>{snapshot.dividendReinvestmentAmount.toFixed(2)}</td><td>{snapshot.shares.toFixed(6)}</td><td>{snapshot.positionValue.toFixed(2)}</td><td>{snapshot.totalAssets.toFixed(2)}</td>
              <td>{snapshot.positionStatus === 'open' ? 'open / 未平仓' : 'flat / 空仓'}</td><td>{snapshot.completedTradeCount}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <h3>数据口径与披露</h3>
        <ul className={styles.disclosureList}>{replayResult.disclosures.map((disclosure, index) => <li key={index}>{disclosure}</li>)}</ul>
      </Card> : null}

      <Modal
        visible={!!pendingSelection}
        title="确认切换基金或日期范围"
        okText="确认并移除失效点位"
        cancelText="取消，保留当前选择"
        onOk={this.confirmPendingSelection}
        onCancel={this.cancelPendingSelection}
        maskClosable={false}
      >
        {pendingSelection ? <div>
          <p>切换到基金 {pendingSelection.query.fundCode}（{pendingSelection.query.startDate} 至 {pendingSelection.query.endDate}）后，以下 {pendingSelection.invalidSignals.length} 个点位将不再适用并被移除：</p>
          <ul>{pendingSelection.invalidSignals.map(signal => <li key={signal.id}>{signal.date} · {signal.type === 'buy' ? '买入' : '卖出'}</li>)}</ul>
          <p>取消将完整保留当前基金、日期范围和所有点位。</p>
        </div> : null}
      </Modal>
    </main>
  }
}
