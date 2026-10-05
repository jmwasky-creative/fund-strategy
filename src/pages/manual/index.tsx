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
}

const errorMessage = (error: any): string => error && typeof error.message === 'string'
  ? error.message
  : '行情读取失败，请检查网络后重试。'

export default class ManualBacktestPage extends Component<{}, ManualWorkspaceState> {
  private searchTimeout: any = null
  private searchVersion = 0

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
    error: ''
  }

  componentWillUnmount() {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout)
    }
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
    this.setState({ draftFundCode: String(value || ''), error: '' })
  }

  private handleDateChange = (field: 'draftStartDate' | 'draftEndDate') => (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ [field]: event.currentTarget.value, error: '' } as Pick<ManualWorkspaceState, 'draftStartDate' | 'draftEndDate' | 'error'>)
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
      this.setState((previousState) => ({
        loading: false,
        error: errorMessage(error),
        draftFundCode: previousState.activeQuery ? previousState.activeQuery.fundCode : previousState.draftFundCode,
        draftStartDate: previousState.activeQuery ? previousState.activeQuery.startDate : previousState.draftStartDate,
        draftEndDate: previousState.activeQuery ? previousState.activeQuery.endDate : previousState.draftEndDate
      }))
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
    this.setState({
      signals: snapshot.signals,
      selectedSignalId: snapshot.selectedSignalId,
      undo: null
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
    const issuesBySignalId = this.getSignalIssuesById(this.getSequenceValidation())

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
      error
    } = this.state
    const orderedSignals = sortManualSignals(signals)
    const selectedQuote = quotes.filter(item => item.date === selectedDate)[0]
    const sequenceValidation = this.getSequenceValidation()
    const issuesBySignalId = this.getSignalIssuesById(sequenceValidation)

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
            ? (signals.length === 0 ? '当前没有点位；添加、移除或撤销后会自动重新校验。' : '当前点位符合多头单持仓顺序约束。')
            : '请按清单中的具体提示修正。点位不会被自动丢弃或重排；未决规则会明确阻止校验通过。'}
        />
        <p className={styles.engineNotice}>当前手动工作区尚无回测执行入口；本次只校验信号顺序，不会启动交易计算或发送真实订单。</p>
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
                          : <span className={styles.validSignal}>序列有效</span>}
                      </td>
                      <td><Button size="small" onClick={event => this.removeSignal(signal.id, event)}>移除</Button></td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>}
          <p className={styles.disclaimer}>此清单只记录本地手动回测输入；校验仅检查信号顺序，不执行回测或提交任何真实订单。</p>
        </Card>
      </div> : null}

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
