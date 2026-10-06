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
  canAdvanceManualAsOf,
  createManualAsOfSnapshot,
  getInitialManualAsOfDate,
  getNextManualAsOfDate,
  getNextManualAsOfQuoteDate,
  ManualAsOfSnapshot
} from './manual-asof-model'
import {
  ManualReplayConfig,
  ManualReplayResult,
  ManualReplayCancelledError,
  runManualReplayCooperatively
} from './manual-replay-model'
import {
  calculateManualReplayMetrics,
  getManualReplayChartMarkers,
  getManualReplayHoldingIntervals,
  getManualReplayTradeMovements
} from './manual-results-model'
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
  historyQuotes: ManualQuote[]
  quotes: ManualQuote[]
  asOfDate: string
  signals: ManualSignal[]
  selectedDate: string
  chartDateChoices: string[]
  signalMode: ManualSignalType | null
  hoveredDate: string
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
  selectedReplayTradeIndex: number | null
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
  private historyRequestId = 0
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
    historyQuotes: [],
    quotes: [],
    asOfDate: '',
    signals: [],
    selectedDate: '',
    chartDateChoices: [],
    signalMode: null,
    hoveredDate: '',
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
    replayResultRevision: null,
    selectedReplayTradeIndex: null
  }

  componentWillUnmount() {
    this.historyRequestId += 1
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
        replayError: '',
        selectedReplayTradeIndex: null
      }
    })
  }

  private getSequenceValidation = (): ManualSequenceValidation => {
    const snapshot = this.getCurrentAsOfSnapshot()
    return snapshot
      ? snapshot.sequenceValidation
      : validateManualSignalSequence(this.state.signals)
  }

  private getCurrentAsOfSnapshot = (): ManualAsOfSnapshot | null => {
    const query = this.state.activeQuery
    if (!query) {
      return null
    }
    const requestedAsOfDate = this.state.asOfDate || query.endDate
    const sourceQuotes = this.state.historyQuotes.length > 0 ? this.state.historyQuotes : this.state.quotes
    return createManualAsOfSnapshot(sourceQuotes, this.state.signals, query, requestedAsOfDate)
  }

  private canAdvanceAsOf = (): boolean => {
    const query = this.state.activeQuery
    if (!query) {
      return false
    }
    const currentAsOfDate = this.state.asOfDate || query.endDate
    return canAdvanceManualAsOf(query.startDate, currentAsOfDate, query.endDate)
  }

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
      this.historyRequestId += 1
      this.invalidateReplayInputs()
    }
    this.setState({ draftFundCode, error: '', loading: false })
  }

  private handleDateChange = (field: 'draftStartDate' | 'draftEndDate') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value
    if (value !== this.state[field]) {
      this.historyRequestId += 1
      this.invalidateReplayInputs()
    }
    this.setState({ [field]: value, error: '', loading: false } as Pick<ManualWorkspaceState, 'draftStartDate' | 'draftEndDate' | 'error' | 'loading'>)
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

    const requestId = ++this.historyRequestId
    this.invalidateReplayInputs()
    this.setState({ loading: true, error: '', chartDateChoices: [] })
    loadManualHistory(query.fundCode, query.startDate, query.endDate).then(quotes => {
      if (requestId !== this.historyRequestId) {
        return
      }
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
      if (requestId !== this.historyRequestId) {
        return
      }
      this.setState({
        loading: false,
        error: errorMessage(error)
      })
    })
  }

  private commitSelection = (query: ManualQuery, quotes: ManualQuote[], invalidSignals: ManualSignal[]) => {
    const invalidIds = new Set(invalidSignals.map(signal => signal.id))
    const asOfDate = getInitialManualAsOfDate(query.startDate, query.endDate)
    this.setState((previousState) => {
      const signals = previousState.signals.filter(signal => !invalidIds.has(signal.id))
      const snapshot = createManualAsOfSnapshot(quotes, signals, query, asOfDate)
      const selectedSignalId = previousState.selectedSignalId !== null
        && snapshot.signals.some(signal => signal.id === previousState.selectedSignalId)
        ? previousState.selectedSignalId
        : null
      const selectedDate = previousState.selectedDate && hasManualQuoteDate(snapshot.quotes, previousState.selectedDate)
        ? previousState.selectedDate
        : (snapshot.quotes.length > 0 ? snapshot.quotes[0].date : '')
      return {
        activeQuery: query,
        draftFundCode: query.fundCode,
        draftStartDate: query.startDate,
        draftEndDate: query.endDate,
        historyQuotes: quotes.slice(),
        quotes: snapshot.quotes,
        asOfDate,
        signals,
        selectedSignalId,
        selectedDate,
        chartDateChoices: [],
        signalMode: null,
        hoveredDate: '',
        pendingSelection: null,
        loading: false,
        error: '',
        undo: null
      }
    })
  }

  private advanceAsOf = () => {
    if (!this.canAdvanceAsOf()) {
      return
    }
    this.invalidateReplayInputs()
    this.setState(previousState => {
      const query = previousState.activeQuery
      if (!query) {
        return null
      }
      const historyQuotes = previousState.historyQuotes.length > 0
        ? previousState.historyQuotes
        : previousState.quotes
      const currentAsOfDate = previousState.asOfDate || query.endDate
      if (!canAdvanceManualAsOf(query.startDate, currentAsOfDate, query.endDate)) {
        return null
      }
      const nextAsOfDate = getNextManualAsOfDate(query.startDate, currentAsOfDate, query.endDate)
      if (!nextAsOfDate) {
        return null
      }
      const snapshot = createManualAsOfSnapshot(historyQuotes, previousState.signals, query, nextAsOfDate)
      const selectedDate = snapshot.quotes.some(quote => quote.date === previousState.selectedDate)
        ? previousState.selectedDate
        : snapshot.quotes.length > 0 ? snapshot.quotes[0].date : ''
      const selectedSignalId = previousState.selectedSignalId !== null
        && snapshot.signals.some(signal => signal.id === previousState.selectedSignalId)
        ? previousState.selectedSignalId
        : null
      return {
        asOfDate: nextAsOfDate,
        quotes: snapshot.quotes,
        selectedDate,
        selectedSignalId,
        chartDateChoices: []
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
    const snapshot = this.getCurrentAsOfSnapshot()
    if (snapshot && hasManualQuoteDate(snapshot.quotes, date)) {
      this.setState({ selectedDate: date, selectedSignalId: null, chartDateChoices: [] })
    }
  }

  private setSignalMode = (type: ManualSignalType) => {
    this.setState(previousState => ({
      signalMode: previousState.signalMode === type ? null : type,
      chartDateChoices: []
    }))
  }

  private getChartHitCandidates = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = event.currentTarget
    const screenMatrix = svg.getScreenCTM()
    if (!screenMatrix) {
      return []
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
    const snapshot = this.getCurrentAsOfSnapshot()
    return getManualChartHitCandidates(
      plotManualHistory(snapshot ? snapshot.quotes : []),
      chartPoint.x,
      chartPoint.y,
      this.state.selectedDate,
      viewBoxUnitsPerScreenPixel
    )
  }

  private handleChartMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const candidates = this.getChartHitCandidates(event)
    const hoveredDate = candidates.length > 0 ? candidates[0].date : ''
    if (hoveredDate !== this.state.hoveredDate) {
      this.setState({ hoveredDate })
    }
  }

  private clearChartHover = () => {
    if (this.state.hoveredDate) {
      this.setState({ hoveredDate: '' })
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
    const candidates = this.getChartHitCandidates(event)

    if (candidates.length === 1) {
      if (this.state.signalMode) {
        this.addSignalAtDate(candidates[0].date, this.state.signalMode)
      } else {
        this.selectDate(candidates[0].date)
      }
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
      if (this.state.signalMode) {
        this.addSignalAtDate(date, this.state.signalMode)
      } else {
        this.selectDate(date)
      }
    }
  }

  private addSignalAtDate = (date: string, type: ManualSignalType) => {
    const snapshot = this.getCurrentAsOfSnapshot()
    if (!snapshot || !hasManualQuoteDate(snapshot.quotes, date)) {
      return
    }
    this.invalidateReplayInputs()
    this.setState((previousState) => {
      const signal: ManualSignal = {
        id: previousState.nextSignalId,
        date,
        type
      }
      return {
        signals: sortManualSignals(previousState.signals.concat(signal)),
        selectedDate: date,
        selectedSignalId: signal.id,
        nextSignalId: previousState.nextSignalId + 1,
        chartDateChoices: [],
        undo: {
          signals: previousState.signals.slice(),
          selectedSignalId: previousState.selectedSignalId
        }
      }
    })
  }

  private addSignal = (type: ManualSignalType) => this.addSignalAtDate(this.state.selectedDate, type)

  private resolveChartDateChoice = (date: string) => {
    if (!this.state.chartDateChoices.includes(date)) {
      return
    }
    if (this.state.signalMode) {
      this.addSignalAtDate(date, this.state.signalMode)
    } else {
      this.selectDate(date)
    }
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

  private handleChartSignalClick = (signal: ManualSignal, event: React.MouseEvent<SVGGElement>) => {
    event.stopPropagation()
    this.selectSignal(signal)
  }

  private handleChartSignalKeyDown = (signal: ManualSignal, event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      this.selectSignal(signal)
    }
  }

  private handleSignalRowKeyDown = (signal: ManualSignal, event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.selectSignal(signal)
    }
  }

  private getCurrentReplayResult = (): ManualReplayResult | null => this.state.replayResult
    && this.state.replayStatus === 'success'
    && this.state.replayResultRevision === this.state.replayInputRevision
    ? this.state.replayResult
    : null

  private selectReplayTrade = (tradeIndex: number, date?: string) => {
    const result = this.getCurrentReplayResult()
    if (!result || !result.trades[tradeIndex]) {
      return
    }
    this.setState({
      selectedReplayTradeIndex: tradeIndex,
      selectedDate: date || result.trades[tradeIndex].entrySignalDate,
      selectedSignalId: null,
      chartDateChoices: []
    })
  }

  private handleReplayMarkerKeyDown = (tradeIndex: number, date: string, event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      this.selectReplayTrade(tradeIndex, date)
    }
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
    const snapshot = this.getCurrentAsOfSnapshot()
    const query = this.state.activeQuery
    if (!query || !snapshot || snapshot.quotes.length === 0) {
      this.setState({
        replayStatus: 'failure',
        replayStatusMessage: '本次运行失败；点位和参数已保留，可以修正后重试。',
        replayError: '请先加载所选区间内的有效基金净值。'
      })
      return
    }
    const validation = snapshot.sequenceValidation
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
    const quotes = snapshot.quotes.slice()
    const range = { startDate: query.startDate, endDate: snapshot.asOfDate }
    const cancellation: ManualReplayCancellation = { cancelled: false }
    this.activeReplayCancellation = cancellation
    this.replayExecutionPending = true
    this.setState({
      replayStatus: 'running',
      replayStatusMessage: '正在按已确认的基金、区间、信号和参数运行；可取消本次运行。',
      replayProgress: { processedDates: 0, totalDates: quotes.length },
      replayError: '',
      selectedReplayTradeIndex: null
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
    const { selectedDate, selectedSignalId, selectedReplayTradeIndex, hoveredDate, signalMode } = this.state
    const snapshot = this.getCurrentAsOfSnapshot()
    const quotes = snapshot ? snapshot.quotes : []
    const signals = snapshot ? snapshot.signals : []
    const plotted = plotManualHistory(quotes)
    const hoveredPoint = hoveredDate ? plotted.find(point => point.date === hoveredDate) || null : null
    const hoverTooltipX = hoveredPoint
      ? Math.max(PLOT_LEFT, Math.min(hoveredPoint.x + 12, PLOT_RIGHT - 220))
      : 0
    const hoverTooltipY = hoveredPoint
      ? Math.max(PLOT_TOP + 4, Math.min(hoveredPoint.y - 34, PLOT_BOTTOM - 30))
      : 0
    if (plotted.length === 0) {
      return null
    }
    const replayResult = this.getCurrentReplayResult()
    const replayMarkers = replayResult ? getManualReplayChartMarkers(replayResult.trades) : []
    const holdingIntervals = replayResult ? getManualReplayHoldingIntervals(replayResult) : []
    const replayMarkersByDate: Record<string, typeof replayMarkers> = {}
    replayMarkers.forEach(marker => {
      replayMarkersByDate[marker.date] = (replayMarkersByDate[marker.date] || []).concat(marker)
    })
    const pointsAttribute = plotted.map(point => `${point.x},${point.y}`).join(' ')
    const minVal = Math.min.apply(null, quotes.map(item => item.val))
    const maxVal = Math.max.apply(null, quotes.map(item => item.val))
    const signalsByDate: Record<string, ManualSignal[]> = {}
    signals.forEach(signal => {
      signalsByDate[signal.date] = (signalsByDate[signal.date] || []).concat(signal)
    })
    const sequenceValidation = snapshot ? snapshot.sequenceValidation : this.getSequenceValidation()
    const issuesBySignalId = this.getSignalIssuesById(sequenceValidation)
    const openSignalIds = this.getOpenSignalIds(sequenceValidation)

    return <div className={styles.chartWrap}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="group"
        aria-label="基金历史单位净值图；选择一个实际净值点以编辑手动买卖信号"
        onClick={this.handleChartClick}
        onMouseMove={this.handleChartMouseMove}
        onMouseLeave={this.clearChartHover}
      >
        <rect x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} fill="transparent" pointerEvents="all" aria-hidden="true" />
        <line x1={PLOT_LEFT} y1={PLOT_BOTTOM} x2={PLOT_RIGHT} y2={PLOT_BOTTOM} className={styles.axis} />
        <line x1={PLOT_LEFT} y1={PLOT_TOP} x2={PLOT_LEFT} y2={PLOT_BOTTOM} className={styles.axis} />
        {holdingIntervals.map(interval => {
          const startPoint = plotted.filter(point => point.date === interval.startDate)[0]
          const endPoint = plotted.filter(point => point.date === interval.endDate)[0]
          if (!startPoint || !endPoint) {
            return null
          }
          const left = Math.min(startPoint.x, endPoint.x)
          const width = Math.max(2, Math.abs(endPoint.x - startPoint.x))
          const isSelected = selectedReplayTradeIndex === interval.tradeIndex
          return <rect
            key={`holding-${interval.tradeIndex}`}
            x={left}
            y={PLOT_TOP}
            width={width}
            height={PLOT_BOTTOM - PLOT_TOP}
            className={isSelected ? `${styles.holdingInterval} ${styles.selectedHoldingInterval}` : styles.holdingInterval}
            aria-label={`${interval.isOpen ? '未平仓' : '已平仓'}持仓区间 ${interval.startDate} 至 ${interval.endDate}`}
            pointerEvents="none"
          />
        })}
        <text x={PLOT_LEFT} y={20} className={styles.axisLabel}>{maxVal.toFixed(4)}</text>
        <text x={PLOT_LEFT} y={PLOT_BOTTOM - 5} className={styles.axisLabel}>{minVal.toFixed(4)}</text>
        {plotted.length > 1
          ? <polyline points={pointsAttribute} className={styles.line} />
          : null}
        {hoveredPoint ? <g className={styles.hoverReadout} role="status" aria-label={`悬停真实净值：${hoveredPoint.date}，单位净值 ${hoveredPoint.val.toFixed(4)}`} pointerEvents="none">
          <line x1={hoveredPoint.x} y1={PLOT_TOP} x2={hoveredPoint.x} y2={PLOT_BOTTOM} className={styles.crosshair} />
          <line x1={PLOT_LEFT} y1={hoveredPoint.y} x2={PLOT_RIGHT} y2={hoveredPoint.y} className={styles.crosshair} />
          <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={6} className={styles.hoveredPoint} />
          <rect x={hoverTooltipX} y={hoverTooltipY} width={216} height={24} rx={3} className={styles.hoverTooltip} />
          <text x={hoverTooltipX + 8} y={hoverTooltipY + 16} className={styles.hoverTooltipText}>
            {hoveredPoint.date} · 单位净值 {hoveredPoint.val.toFixed(4)}
          </text>
        </g> : null}
        {plotted.map(point => {
          const isSelected = selectedDate === point.date
          const dateSignals = signalsByDate[point.date] || []
          const dateReplayMarkers = replayMarkersByDate[point.date] || []
          const isSelectedReplayPoint = selectedReplayTradeIndex !== null
            && dateReplayMarkers.some(marker => marker.tradeIndex === selectedReplayTradeIndex)
          return <g key={point.date}>
            {dateSignals.map((signal, index) => {
              const offset = (index - (dateSignals.length - 1) / 2) * 15
              const markerY = Math.max(18, point.y - 20)
              const signalIssues = issuesBySignalId[signal.id] || []
              const nextExecutionDate = snapshot ? getNextManualAsOfQuoteDate(snapshot, signal.date) : null
              const executionDateLabel = nextExecutionDate
                ? nextExecutionDate
                : snapshot && snapshot.asOfDate < snapshot.selectedEndDate
                  ? '尚未在当前 as-of 范围内揭示'
                  : '所选区间内无下一有效净值'
              const isSelectedSignal = selectedSignalId === signal.id
              const issueLabel = signalIssues.length > 0
                ? `；校验提示：${signalIssues.map(issue => issue.message).join('；')}`
                : openSignalIds.has(signal.id)
                  ? '；序列校验通过，期末未平仓且尚未估值'
                  : '；序列校验通过'
              return <g
                key={signal.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelectedSignal}
                aria-label={`${signal.date} ${signal.type === 'buy' ? '买入' : '卖出'}信号日；下一有效净值成交日 ${executionDateLabel}${issueLabel}`}
                onClick={event => this.handleChartSignalClick(signal, event)}
                onKeyDown={event => this.handleChartSignalKeyDown(signal, event)}
              >
                <circle
                  cx={point.x + offset}
                  cy={markerY}
                  r={isSelectedSignal ? 10 : 8}
                  fill={signal.type === 'buy' ? '#237804' : '#cf1322'}
                  className={[
                    styles.signalMarker,
                    signalIssues.length > 0 ? styles.invalidSignalMarker : '',
                    isSelectedSignal ? styles.selectedSignalMarker : ''
                  ].filter(Boolean).join(' ')}
                />
                <text x={point.x + offset} y={markerY + 3} textAnchor="middle" className={styles.signalMarkerText}>
                  {signal.type === 'buy' ? '买' : '卖'}
                </text>
              </g>
            })}
            {dateReplayMarkers.map((marker, markerIndex) => {
              const isSignal = marker.kind.indexOf('signal') >= 0
              const isBuy = marker.side === 'buy'
              const isTradeSelected = selectedReplayTradeIndex === marker.tradeIndex
              const markerX = point.x + (markerIndex - (dateReplayMarkers.length - 1) / 2) * 9
              const markerY = Math.max(PLOT_TOP + 12, Math.min(PLOT_BOTTOM - 12, point.y + (isSignal ? -22 : 22)))
              const markerLabel = marker.kind === 'entry-signal' ? '买入信号'
                : marker.kind === 'entry-execution' ? '买入成交'
                  : marker.kind === 'exit-signal' ? '卖出信号' : '卖出成交'
              const markerClass = [
                styles.replayTradeMarker,
                isBuy ? styles.replayBuyMarker : styles.replaySellMarker,
                isSignal ? styles.replaySignalMarker : styles.replayExecutionMarker,
                isTradeSelected ? styles.replayTradeMarkerSelected : ''
              ].filter(Boolean).join(' ')
              return <g
                key={`${marker.kind}-${marker.tradeIndex}`}
                role="button"
                tabIndex={0}
                aria-pressed={isTradeSelected}
                aria-label={`交易 ${marker.tradeIndex + 1} ${markerLabel}日 ${marker.date}；选择以定位交易明细`}
                onClick={event => {
                  event.stopPropagation()
                  this.selectReplayTrade(marker.tradeIndex, marker.date)
                }}
                onKeyDown={event => this.handleReplayMarkerKeyDown(marker.tradeIndex, marker.date, event)}
              >
                <line x1={point.x} y1={point.y} x2={markerX} y2={markerY} className={styles.replayMarkerConnector} />
                {isSignal && isBuy
                  ? <circle cx={markerX} cy={markerY} r={6} className={markerClass} />
                  : isSignal
                    ? <rect x={markerX - 5.5} y={markerY - 5.5} width={11} height={11} className={markerClass} />
                    : isBuy
                      ? <path d={`M ${markerX} ${markerY - 7} L ${markerX + 6} ${markerY + 5} L ${markerX - 6} ${markerY + 5} Z`} className={markerClass} />
                      : <path d={`M ${markerX} ${markerY - 7} L ${markerX + 7} ${markerY} L ${markerX} ${markerY + 7} L ${markerX - 7} ${markerY} Z`} className={markerClass} />}
                <text x={markerX} y={markerY + (isSignal ? -9 : 15)} textAnchor="middle" className={styles.replayMarkerText}>
                  {markerLabel}
                </text>
              </g>
            })}
            {isSelected || isSelectedReplayPoint ? <circle
              cx={point.x}
              cy={point.y}
              r={isSelectedReplayPoint ? MANUAL_CHART_SELECTED_RING_RADIUS + 3 : MANUAL_CHART_SELECTED_RING_RADIUS}
              strokeWidth={MANUAL_CHART_SELECTED_RING_STROKE_WIDTH}
              className={isSelectedReplayPoint ? styles.replaySelectedRing : styles.selectedRing}
            /> : null}
            <circle
              cx={point.x}
              cy={point.y}
              r={isSelected ? MANUAL_CHART_SELECTED_POINT_RADIUS : MANUAL_CHART_POINT_RADIUS}
              strokeWidth={MANUAL_CHART_POINT_STROKE_WIDTH}
              className={styles.quotePoint}
              role="button"
              tabIndex={0}
              aria-label={signalMode
                ? `在真实净值日 ${point.date}，单位净值 ${point.val.toFixed(4)} 添加${signalMode === 'buy' ? '买入' : '卖出'}信号`
                : `选择真实净值日期 ${point.date}，单位净值 ${point.val.toFixed(4)}`}
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
        <span><i className={styles.holdingIntervalLegend} />实际持仓区间（买入成交至卖出成交/期末）</span>
        <span>空心圆/方块为买/卖信号日；实心三角/菱形为买/卖成交日。</span>
        <span>图上点位命中区已扩大；重叠点会显示真实 NAV 候选日期。</span>
        <span>信号标记位于信号日，成交日按下一条已揭示的有效 NAV 显示在点位清单中。</span>
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
      selectedDate,
      chartDateChoices,
      signalMode,
      selectedSignalId,
      selectedReplayTradeIndex,
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
    const snapshot = this.getCurrentAsOfSnapshot()
    const quotes = snapshot ? snapshot.quotes : []
    const signals = snapshot ? snapshot.signals : []
    const asOfDate = snapshot ? snapshot.asOfDate : ''
    const canAdvanceAsOf = this.canAdvanceAsOf()
    const hasHistoryQuotes = this.state.historyQuotes.length > 0 || quotes.length > 0
    const orderedSignals = sortManualSignals(signals)
    const selectedQuote = quotes.filter(item => item.date === selectedDate)[0]
    const sequenceValidation = snapshot ? snapshot.sequenceValidation : this.getSequenceValidation()
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
    const replayResultIsStale = Boolean(replayResult && (
      replayResultRevision !== replayInputRevision || replayStatus !== 'success'
    ))
    const replayMetrics = replayResult && !replayResultIsStale
      ? calculateManualReplayMetrics(replayResult)
      : null
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
      {!loading && activeQuery && !hasHistoryQuotes
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

      {activeQuery && (quotes.length > 0 || canAdvanceAsOf) ? <div className={styles.workspaceGrid}>
        <Card title="历史单位净值" className={styles.chartCard}>
          <p className={styles.chartSummary}>{activeQuery ? `${activeQuery.fundCode} · ${quotes.length} 个实际净值交易日` : ''}</p>
          <div className={styles.asOfControls} role="group" aria-label="历史净值 as-of 回放">
            <span>模拟 as-of 截止日：<strong>{asOfDate}</strong>　所选范围：{activeQuery.startDate} 至 {activeQuery.endDate}</span>
            <Button disabled={!canAdvanceAsOf} onClick={this.advanceAsOf}>下一周</Button>
          </div>
          <p className={styles.asOfNotice}>按 7 个日历日逐步累计揭示历史净值；当前图表、信号和回测仅使用此截止日及之前的数据。此功能模拟历史当时可见数据，不承诺源 NAV 的实际发布时间或修订信息（NAV 数据可能后补）。</p>
          {quotes.length > 0 ? <div>
            <div className={styles.signalModeControls} role="group" aria-label="选择买入或卖出信号模式">
              <strong>先选信号模式，再点击图上的真实 NAV 点</strong>
              <Button
                type={signalMode === 'buy' ? 'primary' : 'default'}
                aria-pressed={signalMode === 'buy'}
                onClick={() => this.setSignalMode('buy')}
              >买入信号模式</Button>
              <Button
                type={signalMode === 'sell' ? 'danger' : 'default'}
                aria-pressed={signalMode === 'sell'}
                onClick={() => this.setSignalMode('sell')}
              >卖出信号模式</Button>
              {signalMode ? <Button onClick={() => this.setState({ signalMode: null, chartDateChoices: [] })}>退出信号模式</Button> : null}
            </div>
            <p className={styles.signalModeHint} role="status" aria-live="polite">
              {signalMode
                ? `当前为${signalMode === 'buy' ? '买入' : '卖出'}模式；点击任一真实净值点即可在该交易日添加信号。`
                : '尚未选择信号模式；点击净值点只会定位日期，不会新增信号。'}
            </p>
          </div> : null}
          {quotes.length === 0 ? <p className={styles.chartSummary}>当前 as-of 窗口内暂无实际净值交易日；如仍有后续区间数据，可点击“下一周”继续揭示。</p> : null}
          {this.renderHistoryChart()}
          {chartDateChoices.length > 0 ? <div className={styles.chartDisambiguation} role="group" aria-label="选择图表重叠区域对应的净值日期" aria-live="polite">
            <p>这个点击位置覆盖多个净值点；当前选择未更改。请明确选择目标日期：</p>
            <div className={styles.chartDateOptions}>
              {chartDateChoices.map(date => {
                const quote = quotes.find(item => item.date === date)
                return quote ? <Button key={date} size="small" onClick={() => this.resolveChartDateChoice(date)}>
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
            <Button disabled={!undo} onClick={this.undoLastEdit}>撤销最近一次点位操作</Button>
          </div>
        </Card>

        <Card title={`点位清单（${signals.length}）`} className={styles.listCard}>
          {orderedSignals.length === 0
            ? <p className={styles.emptyList}>尚未添加手动买卖点。先在图上方选择买入或卖出信号模式，再点击真实净值点。</p>
            : <div className={styles.tableWrap}>
              <table className={styles.signalTable}>
                <thead><tr><th>信号</th><th>信号日</th><th>下一有效 NAV 成交日</th><th>校验提示</th><th>操作</th></tr></thead>
                <tbody>
                  {orderedSignals.map(signal => {
                    const signalIssues = issuesBySignalId[signal.id] || []
                    const executionDate = snapshot ? getNextManualAsOfQuoteDate(snapshot, signal.date) : null
                    const executionDateLabel = executionDate
                      ? executionDate
                      : snapshot && snapshot.asOfDate < snapshot.selectedEndDate
                        ? '待后续 as-of 揭示；不推断未来日期'
                        : '所选区间内无下一有效净值'
                    const rowClass = [
                      selectedSignalId === signal.id ? styles.selectedRow : '',
                      signalIssues.length > 0 ? styles.invalidSignalRow : ''
                    ].filter(Boolean).join(' ')
                    return <tr
                      key={signal.id}
                      className={rowClass}
                      onClick={() => this.selectSignal(signal)}
                      onKeyDown={event => this.handleSignalRowKeyDown(signal, event)}
                      tabIndex={0}
                      role="button"
                      aria-label={`定位${signal.type === 'buy' ? '买入' : '卖出'}信号；信号日 ${signal.date}；成交日 ${executionDateLabel}`}
                      aria-selected={selectedSignalId === signal.id}
                      aria-describedby={signalIssues.length > 0 ? `signal-validation-${signal.id}` : undefined}
                    >
                      <td><span className={signal.type === 'buy' ? styles.buyType : styles.sellType}>{signal.type === 'buy' ? '买入' : '卖出'}</span></td>
                      <td>{signal.date}</td>
                      <td className={executionDate ? styles.executionDate : styles.pendingExecutionDate}>{executionDateLabel}</td>
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
          <p className={styles.disclaimer}>成交日按 #4 的“信号日后下一条有效 NAV”规则，仅从当前 as-of 已揭示数据确定；未揭示时显示待揭示状态，不推算未来日期。此清单记录本地手动回测输入；只有显式填写参数并主动运行后才执行历史模拟，不会提交任何真实订单。</p>
        </Card>
      </div> : null}

      {activeQuery && quotes.length > 0 ? <Card title="手动回放参数（全部必填，无默认数值）" className={styles.replayCard}>
        <h3>本次运行前确认</h3>
        <dl className={styles.replaySummary}>
          <div><dt>基金与当前回放区间</dt><dd>{activeQuery.fundCode} · {activeQuery.startDate} 至 {asOfDate}（所选结束：{activeQuery.endDate}）</dd></div>
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

      {replayResult ? <Card title={replayResultIsStale ? '逐日模拟结果（已过期 / 非当前运行）' : '逐日模拟结果'} className={styles.replayCard}>
        {replayResultIsStale
          ? <Alert
            className={styles.feedback}
            type="warning"
            showIcon
            message="此处保留的是先前成功结果；输入已变化或当前运行尚未成功，不能作为当前指标。"
            description="旧指标、图表叠加和可定位交易明细均已隐藏；请在当前输入运行成功后查看新结果。失败或取消不会展示貌似有效的指标。"
          />
          : replayMetrics ? <>
            <Alert type="warning" showIcon message="仅历史模拟，不会向真实账户下单" description={replayResult.summary.endingPositionStatus === 'open'
              ? `期末持仓仍为 open/unclosed，按 ${replayResult.summary.lastNavDate} 最后有效净值估值；不合成卖出，也不计入已完成交易。`
              : '所有成交按显式参数回放；本结果不代表实盘成交或真实收益。'} />
            <h3>回测结果指标</h3>
            <dl className={styles.replaySummary}>
              <div><dt>总收益率</dt><dd>{replayMetrics.totalReturnRatePercent.toFixed(2)}%</dd></div>
              <div><dt>总资产变动</dt><dd>{replayMetrics.totalProfitAmount.toFixed(2)} 元</dd></div>
              <div><dt>最大回撤</dt><dd>{replayMetrics.maximumDrawdownPercent.toFixed(2)}%</dd></div>
              <div><dt>胜率（已平仓）</dt><dd>{replayMetrics.winRatePercent === null ? '—（暂无已完成交易）' : `${replayMetrics.winRatePercent.toFixed(2)}%`}</dd></div>
              <div><dt>已完成往返交易</dt><dd>{replayMetrics.completedTradeCount} 笔</dd></div>
              <div><dt>期末未平仓</dt><dd>{replayMetrics.openTradeCount} 笔（另行标注，不计入胜率/交易数）</dd></div>
            </dl>
            <p className={styles.metricsNotice}>
              口径：总收益率 =（期末总资产 − 配置初始资金）÷ 配置初始资金；最大回撤 = 从初始资金起的逐日总资产曲线相对历史高点的最大跌幅；胜率 = 已平仓交易中扣除费用并按滑点成交后 realizedProfit &gt; 0 的笔数 ÷ 已平仓笔数；交易数仅计已完成往返交易，未平仓另列。无已平仓交易时胜率记为“暂无”，不强行记 0%。
            </p>
            <dl className={styles.replaySummary}>
              <div><dt>期末总资产</dt><dd>{replayResult.summary.endingTotalAssets.toFixed(2)} 元</dd></div>
              <div><dt>现金余额</dt><dd>{replayResult.summary.endingCash.toFixed(2)} 元</dd></div>
              <div><dt>累计红利复投</dt><dd>{replayResult.summary.totalDividendReinvested.toFixed(2)} 元（已同步计入份额）</dd></div>
              <div><dt>期末持仓估值</dt><dd>{replayResult.summary.openPositionValue.toFixed(2)} 元</dd></div>
              <div><dt>持仓状态</dt><dd>{replayResult.summary.endingPositionStatus === 'open' ? 'open / 未平仓' : 'flat / 空仓'}</dd></div>
              <div><dt>已实现收益</dt><dd>{replayResult.summary.realizedProfit.toFixed(2)} 元</dd></div>
              <div><dt>未实现估值变动</dt><dd>{replayResult.summary.unrealizedProfit.toFixed(2)} 元</dd></div>
              <div><dt>最后有效净值</dt><dd>{replayResult.summary.lastNavDate} · {replayResult.summary.lastNav.toFixed(4)}</dd></div>
            </dl>

            <h3>交易账本（信号日与成交日分列；选择行可定位图表）</h3>
            {replayResult.trades.length === 0
              ? <p className={styles.emptyList}>没有交易信号；结果仅显示区间现金快照。</p>
              : <div className={styles.tableWrap}>
                <table className={styles.replayTable}>
                  <thead><tr><th>状态</th><th>买入类型：信号日 → 成交日</th><th>买入净值：市场 / 成交</th><th>卖出类型：信号日 → 成交日</th><th>卖出净值：市场 / 成交</th><th>费用 / 滑点金额</th><th>现金 / 持仓变化</th><th>交易盈亏</th><th>图表</th></tr></thead>
                  <tbody>{replayResult.trades.map((trade, index) => {
                    const movements = getManualReplayTradeMovements(trade)
                    return <tr
                      key={`${trade.entrySignalDate}-${index}`}
                      className={selectedReplayTradeIndex === index ? styles.selectedRow : ''}
                      aria-selected={selectedReplayTradeIndex === index}
                      onClick={() => this.selectReplayTrade(index)}
                    >
                      <td>{trade.status === 'open' ? 'open / 未平仓' : 'closed / 已完成'}</td>
                      <td>买入：{trade.entrySignalDate} → {trade.entryExecutionDate}</td>
                      <td>{trade.entryMarketNav.toFixed(4)} / {trade.entryFillNav.toFixed(4)}</td>
                      <td>{trade.exitSignalDate
                        ? `卖出：${trade.exitSignalDate} → ${trade.exitExecutionDate || '—'}`
                        : '卖出：未平仓'}</td>
                      <td>{trade.exitMarketNav === null ? '—' : `${trade.exitMarketNav.toFixed(4)} / ${trade.exitFillNav!.toFixed(4)}`}</td>
                      <td>
                        <div>买费 {trade.entryFee.toFixed(2)} 元；买滑点 {movements.entrySlippageAmount.toFixed(2)} 元（{movements.entrySlippageRatePercent.toFixed(2)}%）</div>
                        <div>{trade.exitFee === null ? '卖费 / 卖滑点 —' : `卖费 ${trade.exitFee.toFixed(2)} 元；卖滑点 ${movements.exitSlippageAmount!.toFixed(2)} 元（${movements.exitSlippageRatePercent!.toFixed(2)}%）`}</div>
                      </td>
                      <td>
                        <div>现金 Δ：{movements.entryCashChange.toFixed(2)} / {movements.exitCashChange === null ? '—' : movements.exitCashChange.toFixed(2)} 元</div>
                        <div>持仓 Δ：+{movements.entryPositionChange.toFixed(6)} / {movements.exitPositionChange === null ? '—' : movements.exitPositionChange.toFixed(6)} 份</div>
                      </td>
                      <td>{trade.status === 'open'
                        ? `未实现 ${((trade.currentValue || 0) - trade.entryNotional - trade.entryFee).toFixed(2)} 元（期末估值）`
                        : `${Number(trade.realizedProfit).toFixed(2)} 元（已实现）`}</td>
                      <td><Button
                        size="small"
                        type={selectedReplayTradeIndex === index ? 'primary' : undefined}
                        aria-pressed={selectedReplayTradeIndex === index}
                        onClick={event => {
                          event.stopPropagation()
                          this.selectReplayTrade(index)
                        }}
                      >定位图表</Button></td>
                    </tr>
                  })}</tbody>
                </table>
              </div>}

            <p className={styles.metricsNotice}>滑点金额按市场净值与成交净值差额乘以该侧成交份额推导；现金流、费用、成交净值及 realizedProfit 均沿用 #4 回放账本字段。拆分/红利产生的持仓调整可在逐日快照及下方披露中核对。</p>
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
          </>
          : null}
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
