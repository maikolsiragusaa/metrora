import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CliErrorPanel } from '../components/CliErrorPanel'
import { ActivityHeatmap } from '../components/ActivityHeatmap'
import { EmptyNote } from '../components/EmptyState'
import { ListRow } from '../components/ListRow'
import { SectionSkeleton } from '../components/Skeleton'
import { StaleBanner } from '../components/StaleBanner'
import { useBarGrowIn } from '../lib/motion'
import { type Polled, usePolled } from '../hooks/usePolled'
import { formatCompact, formatUsd } from '../lib/format'
import { codeburn } from '../lib/ipc'
import { contiguousDailyWindow, dataStartKey, formatChartDate, localDateKey, sliceDailyToPeriod, sliceDailyToRange } from '../lib/period'
import type {
  ActReportJson,
  DailyHistoryEntry,
  DateRange,
  MenubarPayload,
  Period,
  YieldJsonReport,
} from '../lib/types'
import { deriveEfficiency } from './overviewEfficiency'
import { OverviewHomeSummary } from './OverviewHomeSummary'
import { deriveOverviewDecision } from './overviewDecision'
import { aggregateModels, buildModelIndex, sessionModelKey, topModelsToAggregated, type AggregatedModel } from './overviewModels'
import { deriveCostPerOutcome } from './overviewOutcome'
import { deriveSignals, deriveStats, mean, streakDays, type SignalGroups } from './overviewTrends'
import { formatWorkflowDuration, workflowCoachingNote } from './overviewWorkflow'

export { localDateKey } from '../lib/period'
export { sessionModelKey } from './overviewModels'
export { deriveSignals } from './overviewTrends'

function EfficiencyScorecard({ current, bare = false }: { current: MenubarPayload['current']; bare?: boolean }) {
  const { oneShot, cacheFraction: cacheFrac, retrySpendFraction, retryPenalty, score, grade, gradeTone } = deriveEfficiency(current)

  return (
    <div className={`${bare ? '' : 'ov-card '}ov-efficiency`}>
      <div className="ov-efficiency-head">
        <div><div className="ov-label">Efficiency</div><div className="ov-efficiency-score">{Math.round(score)} / 100</div></div>
        <div className={`ov-grade ${gradeTone}`} aria-label={`Efficiency grade ${grade}`}>{grade}</div>
      </div>
      <div className="ov-component-list">
        <div className="ov-component-row">
          <div><span>One-shot</span><strong>{formatRate(current.oneShotRate)}</strong></div>
          <div className="ov-component-track"><span style={{ width: `${oneShot * 100}%` }} /></div>
        </div>
        <div className="ov-component-row">
          <div><span>Cache hit</span><strong>{Math.round(current.cacheHitPercent)}%</strong></div>
          <div className="ov-component-track"><span style={{ width: `${cacheFrac * 100}%` }} /></div>
        </div>
        <div className="ov-component-row">
          <div><span>Retry tax</span><strong>{formatUsd(current.retryTax.totalUSD)} · {(retrySpendFraction * 100).toFixed(1)}% of spend</strong></div>
          <div className="ov-component-track adverse"><span style={{ width: `${retryPenalty * 100}%` }} /></div>
        </div>
      </div>
      <p className="ov-widget-caption">Composite of one-shot, cache hit, and retry tax.{current.oneShotRate === null ? ' Partial grade: one-shot is unavailable.' : ''}</p>
    </div>
  )
}

function CostPerOutcome({ outcome }: { outcome: Polled<YieldJsonReport> }) {
  const report = outcome.data
  let body: React.ReactNode

  if (!report) {
    body = <EmptyNote>{outcome.error ? 'Yield data is unavailable for this period.' : 'Correlating sessions with git…'}</EmptyNote>
  } else if (report.summary.total.sessions === 0 && report.details.length === 0) {
    body = <EmptyNote>No git-correlated outcomes in this period.</EmptyNote>
  } else {
    const outcome = deriveCostPerOutcome(report)
    body = (
      <>
        <div className="ov-outcome-metrics">
          <div><span>$ / commit</span><strong>{outcome.costPerCommit === null ? '—' : formatUsd(outcome.costPerCommit)}</strong></div>
          <div><span>$ / productive session</span><strong>{outcome.costPerProductiveSession === null ? '—' : formatUsd(outcome.costPerProductiveSession)}</strong></div>
        </div>
        <div className="ov-outcome-split">
          productive {Math.round(outcome.productivePercent)}% · reverted {Math.round(outcome.revertedPercent)}% · abandoned {Math.round(outcome.abandonedPercent)}%
        </div>
      </>
    )
  }

  return (
    <div className="ov-card ov-panel">
      <div className="ov-panel-head"><h3>Cost per outcome</h3><span className="r">Yield</span></div>
      <div className="ov-panel-body">
        {body}
        <p className="ov-widget-caption">Git-correlated. Reverted/abandoned = spend that didn't ship.</p>
      </div>
    </div>
  )
}

function WorkflowCard({ current }: { current: MenubarPayload['current'] }) {
  const workflow = current.workflow
  const topReworked = current.topReworkedFiles?.[0]
  const hasSignal = !!workflow && (
    workflow.correctionRate !== null ||
    workflow.medianTimeToFirstEditMs !== null ||
    workflow.corrections > 0 ||
    !!topReworked
  )
  if (!workflow || !hasSignal) return null

  const coverage = current.pricingCoverage
  const showCoverage = typeof coverage === 'number' && coverage < 1
  const note = workflowCoachingNote(workflow, topReworked)
  const { correctionRate, corrections, medianTimeToFirstEditMs } = workflow

  return (
    <div className="ov-card ov-panel ov-workflow-widget">
      <div className="ov-panel-head">
        <h3>Workflow</h3>
        {showCoverage && <span className="ov-priced-chip">{Math.min(99, Math.round(coverage * 100))}% priced</span>}
      </div>
      <div className="ov-panel-body">
        <div className="ov-outcome-metrics">
          <div>
            <span>Correction rate</span>
            <strong>{correctionRate === null ? '—' : `${Math.round(correctionRate * 100)}%`}</strong>
            {correctionRate !== null && <span>{corrections} {corrections === 1 ? 'correction' : 'corrections'}</span>}
          </div>
          <div>
            <span>Time to first edit</span>
            <strong>{medianTimeToFirstEditMs === null ? '—' : formatWorkflowDuration(medianTimeToFirstEditMs)}</strong>
            <span>median</span>
          </div>
        </div>
        {topReworked && (
          <div className="ov-workflow-rework">
            Top rework: <strong>{topReworked.path}</strong> · {topReworked.sessions} {topReworked.sessions === 1 ? 'session' : 'sessions'} · {topReworked.edits} {topReworked.edits === 1 ? 'edit' : 'edits'}
          </div>
        )}
        <p className="ov-widget-caption">{note ?? 'Corrections, first-edit latency, and file churn across your sessions.'}</p>
      </div>
    </div>
  )
}

const SIGNAL_GROUPS = [
  {
    key: 'wins' as const,
    label: 'Wins',
    icon: <><circle cx="12" cy="12" r="9" /><polyline points="8 12 11 15 16 9" /></>,
  },
  {
    key: 'improvements' as const,
    label: 'Improvements',
    icon: <><polyline points="7 17 17 7" /><polyline points="9 7 17 7 17 15" /></>,
  },
  {
    key: 'risks' as const,
    label: 'Risks',
    icon: <><path d="M12 4 21 19 3 19Z" /><line x1="12" y1="10" x2="12" y2="14" /><line x1="12" y1="16.5" x2="12" y2="16.6" /></>,
  },
]

function SignalsCard({ signals }: { signals: SignalGroups }) {
  const groups = SIGNAL_GROUPS.filter(group => signals[group.key].length > 0)
  if (!groups.length) return null
  return (
    <div className="ov-card ov-signals" aria-label="Coaching signals">
      {groups.map(group => (
        <div className={`ov-signal-group ${group.key}`} key={group.key}>
          <div className="ov-signal-head">
            <svg viewBox="0 0 24 24" aria-hidden="true">{group.icon}</svg>
            <span>{group.label}</span>
          </div>
          <ul className="ov-signal-list">
            {signals[group.key].map((signal, index) => (
              <li className="ov-signal" key={`${signal.text}-${index}`}>
                <span title={signal.text}>{signal.text}</span>
                {signal.trailing && <span className="ov-signal-trailing">{signal.trailing}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function RoutingWhatIf({ routing, onNavigate }: {
  routing: MenubarPayload['current']['routingWaste']
  onNavigate?: (section: 'optimize') => void
}) {
  if (routing.totalSavingsUSD <= 0 || !routing.baselineModel) return null
  return (
    <div className="ov-card ov-routing">
      <div><span className="ov-label">Routing what-if</span><p>Routing to <strong>{routing.baselineModel}</strong> could save ~<strong>{formatUsd(routing.totalSavingsUSD)}</strong> this period.</p></div>
      <button className="ov-link" type="button" onClick={() => onNavigate?.('optimize')}>Optimize →</button>
    </div>
  )
}

function formatShortDay(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${month}/${day}`
}

function ModelsTable({ models }: { models: AggregatedModel[] }) {
  if (!models.length) return <EmptyNote>No model usage in this range yet.</EmptyNote>

  return (
    <div className="ov-model-scroll">
      <table className="ov-models" aria-label="Models this period">
        <thead>
          <tr>
            <th>Model</th>
            <th className="num">Input tok</th>
            <th className="num">Output tok</th>
            <th className="num">Cost</th>
            <th className="num">Calls</th>
          </tr>
        </thead>
        <tbody>
          {models.map(model => (
            <tr key={model.name}>
              <td className="ov-model-name">{model.name}</td>
              <td className="num mono">{model.inputTokens === undefined ? '—' : formatCompact(model.inputTokens)}</td>
              <td className="num mono">{model.outputTokens === undefined ? '—' : formatCompact(model.outputTokens)}</td>
              <td className="num mono">{formatUsd(model.cost)}</td>
              <td className="num">{model.calls.toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DailyChart({ daily, dataStart = null, animateKey = '' }: { daily: DailyHistoryEntry[]; dataStart?: string | null; animateKey?: string }) {
  const isNoData = (day: DailyHistoryEntry) => dataStart !== null && day.date < dataStart
  const max = Math.max(...daily.map(day => day.cost), 0)
  const peakIndex = daily.reduce((peak, day, index) => day.cost > (daily[peak]?.cost ?? -1) ? index : peak, 0)
  const peak = daily[peakIndex]
  const yesterday = daily.at(-2)
  const average = mean(daily.map(day => day.cost))
  const ticks = daily.filter((_, index) => index % 7 === 0)
  const [tip, setTip] = useState<{ day: DailyHistoryEntry; x: number; y: number } | null>(null)
  const [tipPosition, setTipPosition] = useState<{ left: number; top: number } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  useBarGrowIn(chartRef, '.col', [animateKey])

  useLayoutEffect(() => {
    if (!tip) {
      setTipPosition(null)
      return
    }
    const width = tipRef.current?.offsetWidth ?? 220
    const height = tipRef.current?.offsetHeight ?? 62
    const gutter = 8
    const cursorGap = 12
    let left = tip.x + cursorGap
    if (left + width > window.innerWidth - gutter) left = tip.x - width - cursorGap
    left = Math.max(gutter, Math.min(left, window.innerWidth - width - gutter))
    let top = tip.y - height - cursorGap
    if (top < gutter) top = tip.y + cursorGap
    top = Math.max(gutter, Math.min(top, window.innerHeight - height - gutter))
    setTipPosition({ left, top })
  }, [tip])

  return (
    <>
      <div className="chart" ref={chartRef}>
        {daily.map((day, index) => {
          const noData = isNoData(day)
          return (
            <button
              type="button"
              aria-label={`${day.date}: ${noData ? 'no data recorded' : formatUsd(day.cost)}`}
              className={`col${index === peakIndex && !noData ? ' hi' : ''}${noData ? ' nodata' : ''}`}
              key={day.date}
              style={{ height: `${max > 0 ? Math.max(2, day.cost / max * 100) : 2}%` }}
              data-date={day.date}
              data-cost={day.cost}
              data-calls={day.calls}
              data-led={day.topModels[0]?.name ?? ''}
              data-nodata={noData ? 'true' : 'false'}
              onMouseEnter={event => setTip({ day, x: event.clientX, y: event.clientY })}
              onMouseMove={event => setTip({ day, x: event.clientX, y: event.clientY })}
              onMouseLeave={() => setTip(null)}
            />
          )
        })}
      </div>
      <div className="ov-xax">
        {ticks.map(day => {
          const index = daily.indexOf(day)
          return <span key={day.date} style={{ left: `${daily.length > 1 ? index / (daily.length - 1) * 100 : 0}%` }}>{formatChartDate(day.date)}</span>
        })}
      </div>
      <div className="ov-chart-summaries" aria-label="Daily spend summary">
        <div className="ov-summary-chip"><span>Avg/day</span><strong>{formatUsd(average)}</strong></div>
        <div className="ov-summary-chip"><span>Peak</span><strong>{peak ? `${formatUsd(peak.cost)} · ${formatShortDay(peak.date)}` : '$0.00'}</strong></div>
        <div className="ov-summary-chip"><span>Yesterday</span><strong>{formatUsd(yesterday?.cost ?? 0)}</strong></div>
      </div>
      {tip && createPortal(
        <div
          ref={tipRef}
          className={`chart-tip${tipPosition ? ' on' : ''}`}
          style={{ position: 'fixed', ...(tipPosition ?? { left: 0, top: 0 }) }}
          role="tooltip"
        >
          <div className="chart-tip-d">{formatChartDate(tip.day.date)}</div>
          {isNoData(tip.day) ? (
            <div className="chart-tip-s">No data recorded</div>
          ) : (
            <>
              <div className="chart-tip-v">{formatUsd(tip.day.cost)}</div>
              <div className="chart-tip-s">{tip.day.calls} calls · {tip.day.topModels[0]?.name ?? 'No model'} led</div>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

function TopActivities({ activities }: { activities: MenubarPayload['current']['topActivities'] }) {
  const rows = [...activities].sort((a, b) => b.cost - a.cost).slice(0, 6)
  if (!rows.length) return <EmptyNote>No activity in this range yet.</EmptyNote>
  const maxCost = rows[0].cost

  return (
    <div className="ov-activities">
      {rows.map(activity => (
        <div className="ov-activity" key={activity.name}>
          <div className="ov-activity-bar" aria-hidden="true">
            <span style={{ width: `${maxCost > 0 ? activity.cost / maxCost * 100 : 0}%` }} />
          </div>
          <div className="ov-activity-main">
            <span className="ov-activity-name">{activity.name}</span>
            <strong>{formatUsd(activity.cost)}</strong>
          </div>
          <div className="ov-activity-meta">
            <span>{activity.turns.toLocaleString('en-US')} turns</span>
            <span>{formatRate(activity.oneShotRate)} one-shot</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function Overview({ period, provider }: { period: Period; provider: string }) {
  const overview = usePolled<MenubarPayload>(() => codeburn.getOverview(period, provider), [period, provider])
  return <OverviewContent period={period} provider={provider} overview={overview} />
}

export function OverviewContent({
  period,
  provider = 'all',
  range = null,
  overview,
  onNavigate,
  ready = true,
}: {
  period: Period
  provider?: string
  range?: DateRange | null
  overview: Polled<MenubarPayload>
  onNavigate?: (section: 'optimize' | 'sessions') => void
  ready?: boolean
}) {
  const actReport = usePolled<ActReportJson>(() => codeburn.getActReport(), [], { enabled: ready, memoKey: 'overview-act' })
  const yieldReport = usePolled<YieldJsonReport>(() => codeburn.getYield(period, provider), [period, provider], { enabled: ready, memoKey: `overview-yield|${period}|${provider}` })
  const { data, error } = overview
  const modelIndex = useMemo(() => data ? buildModelIndex(data) : new Map<string, string>(), [data])

  if (!data) {
    if (error) return <CliErrorPanel error={error} subject="your usage" />
    return <SectionSkeleton label="Scanning sessions…" rows={3} chart />
  }

  const now = new Date()
  const rangeActive = !!range
  const animateKey = `${period}|${provider}|${range?.from ?? ''}|${range?.to ?? ''}`
  const stats = deriveStats(data, now)
  const periodDaily = sliceDailyToPeriod(data.history.daily, period, now)
  const defaultChartStart = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29))
  const chartDaily = rangeActive
    ? contiguousDailyWindow(data.history.daily, range.from, range.to)
    : contiguousDailyWindow(
        data.history.daily,
        periodDaily[0] && periodDaily[0].date < defaultChartStart ? periodDaily[0].date : defaultChartStart,
        localDateKey(now),
      )
  const models = provider !== 'all'
    ? topModelsToAggregated(data.current.topModels)
    : aggregateModels(rangeActive ? sliceDailyToRange(data.history.daily, range.from, range.to) : periodDaily)
  const topModel = data.current.topModels[0]
  const saved = actReport.data?.totals.realizedCostUSD ?? 0
  const applied = saved > 0 ? (actReport.data?.totals.measuredActions ?? 0) : 0
  const localSaved = data.current.localModelSavings.totalUSD
  const signals = deriveSignals(data, now, rangeActive)
  const decision = deriveOverviewDecision(data, signals, rangeActive)
  const streak = streakDays(data.history.daily, now)
  return (
    <div className="ov-dashboard">
      {error && <StaleBanner error={error} />}
      <div className="ov-card ov-home-shell" aria-label="Key performance indicators">
        <OverviewHomeSummary
          current={data.current}
          decision={decision}
          streak={streak}
          saved={saved}
          applied={applied}
          localSaved={localSaved}
          animateKey={animateKey}
          onNavigate={onNavigate}
        />
        <ActivityHeatmap daily={data.history.daily} bare />
        <EfficiencyScorecard current={data.current} bare />
      </div>

      {!rangeActive && (
        <div className="ov-card ov-stats3">
          <div className="ov-stat"><div className="ov-label">Month to date</div><div className="v">{formatUsd(stats.mtd)}</div><div className="d">{stats.pacePct === null ? `No ${stats.prevMonthName} pace yet` : `${stats.pacePct >= 0 ? '+' : ''}${Math.round(stats.pacePct)}% vs ${stats.prevMonthName} pace`}</div></div>
          <div className="ov-stat"><div className="ov-label">Projected month</div><div className="v">{formatUsd(stats.projected)} <small>est</small></div><div className="d warn">{formatUsd(Math.max(0, stats.projected - stats.mtd))} to go</div></div>
        </div>
      )}

      <div className="ov-card ov-panel ov-chart-widget">
        <div className="ov-panel-head"><h3>Daily spend</h3><span className="r">{topModel ? `Biggest driver: ${topModel.name}` : 'No model driver yet'}</span></div>
        <div className="ov-panel-body">{data.history.daily.length ? <DailyChart daily={chartDaily} dataStart={dataStartKey(data.history.daily)} animateKey={animateKey} /> : <EmptyNote>No spend yet.</EmptyNote>}</div>
      </div>

      <WorkflowCard current={data.current} />

      <SignalsCard signals={signals} />

      <div className="ov-analytics-row">
        <CostPerOutcome outcome={yieldReport} />
        <RoutingWhatIf routing={data.current.routingWaste} onNavigate={onNavigate} />
      </div>

      <div className="ov-body-grid">
        <div className="ov-main-column">
          <div className="ov-card ov-panel ov-models-widget">
            <div className="ov-panel-head"><h3>Models this period</h3><span className="r">Sorted by cost</span></div>
            <div className="ov-panel-body ov-model-panel"><ModelsTable models={models} /></div>
          </div>

          <div className="ov-card ov-panel ov-sessions-widget">
            <div className="ov-panel-head"><h3>Most expensive sessions</h3><span className="r"><button className="ov-link" type="button" onClick={() => onNavigate?.('sessions')}>See all →</button></span></div>
            <div className="ov-panel-body">
              {data.current.topSessions.length ? data.current.topSessions.map((session, index) => {
                const model = modelIndex.get(sessionModelKey(session.project, session.date, session.calls, session.cost))
                const sub = [formatChartDate(session.date), model, `${session.calls} calls`].filter(Boolean).join(' · ')
                return <ListRow key={`${session.project}-${session.date}-${index}`} no={String(index + 1).padStart(2, '0')} title={session.project} sub={sub} value={formatUsd(session.cost)} onClick={() => onNavigate?.('sessions')} />
              }) : <EmptyNote>No sessions in this range.</EmptyNote>}
            </div>
          </div>
        </div>

        <div className="ov-side-column">
          <div className="ov-card ov-panel ov-activities-widget">
            <div className="ov-panel-head"><h3>Top activities</h3><span className="r">Sorted by cost</span></div>
            <div className="ov-panel-body"><TopActivities activities={data.current.topActivities} /></div>
          </div>
        </div>
      </div>
    </div>
  )
}
