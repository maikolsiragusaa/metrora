import { useMemo } from 'react'
import type { CSSProperties } from 'react'

import { formatCompact, formatUsd } from '../lib/format'
import { seriesColorForModel } from '../lib/modelSeries'
import { formatChartDate } from '../lib/period'
import type { DailyHistoryEntry } from '../lib/types'

type ChartSegment = { name: string; cost: number; color: string }

const TOP_MODEL_LIMIT = 5

function modelSeries(daily: DailyHistoryEntry[]): { names: string[]; hasEvidence: boolean } {
  const totals = new Map<string, number>()
  let hasEvidence = false
  for (const day of daily) {
    if (day.topModels.length > 0) hasEvidence = true
    for (const model of day.topModels) totals.set(model.name, (totals.get(model.name) ?? 0) + Math.max(0, model.cost))
  }
  return {
    hasEvidence,
    names: [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_MODEL_LIMIT)
      .map(([name]) => name),
  }
}

function segmentsForDay(day: DailyHistoryEntry, modelNames: string[], hasEvidence: boolean): ChartSegment[] {
  if (!hasEvidence) {
    return day.cost > 0 ? [{ name: 'Observed spend', cost: day.cost, color: 'var(--s-other)' }] : []
  }

  const byName = new Map(day.topModels.map(model => [model.name, Math.max(0, model.cost)]))
  const selected = modelNames
    .map(name => ({ name, cost: byName.get(name) ?? 0, color: seriesColorForModel(name) }))
    .filter(segment => segment.cost > 0)
  const represented = selected.reduce((sum, segment) => sum + segment.cost, 0)
  const other = Math.max(0, day.cost - represented)
  if (other > 0) selected.push({ name: 'Other', cost: other, color: 'var(--s-other)' })
  return selected
}

export function SpendDailyChart({
  daily,
  animateKey,
}: {
  daily: DailyHistoryEntry[]
  animateKey: string
}) {
  const { names, hasEvidence } = useMemo(() => modelSeries(daily), [daily])
  const maxCost = Math.max(...daily.map(day => day.cost), 0)
  const labelStride = Math.max(1, Math.ceil(daily.length / 7))
  const legend = hasEvidence
    ? names.map(name => ({ name, color: seriesColorForModel(name) })).concat([{ name: 'Other', color: 'var(--s-other)' }])
    : [{ name: 'Observed spend', color: 'var(--s-other)' }]

  if (daily.length === 0 || maxCost <= 0) return null

  return (
    <div
      className="spend-chart"
      data-testid="spend-daily-chart"
      data-chart-mode={hasEvidence ? 'model' : 'observed'}
      aria-label={hasEvidence ? 'Daily spend by model' : 'Daily observed spend'}
    >
      <div className="spend-chart-y" aria-hidden="true">
        {[1, .75, .5, .25, 0].map(value => <span key={value}>{formatUsd(maxCost * value)}</span>)}
      </div>
      <div className="spend-chart-main">
        <div className="spend-chart-plot" style={{ '--spend-chart-columns': daily.length } as CSSProperties}>
          <div className="spend-chart-grid" aria-hidden="true">
            {[1, .75, .5, .25, 0].map(value => <i key={value} style={{ bottom: `${value * 100}%` }} />)}
          </div>
          <div className="spend-chart-bars" key={animateKey}>
            {daily.map((day, index) => {
              const segments = segmentsForDay(day, names, hasEvidence)
              return (
                <div
                  className="spend-chart-column"
                  key={day.date}
                  title={`${formatChartDate(day.date)} · ${formatUsd(day.cost)} · ${day.calls.toLocaleString('en-US')} calls`}
                  aria-label={`${formatChartDate(day.date)}. Spend ${formatUsd(day.cost)}. ${day.calls.toLocaleString('en-US')} calls.`}
                >
                  <div className="spend-chart-stack" style={{ height: `${(day.cost / maxCost) * 100}%` }}>
                    {segments.map(segment => (
                      <span
                        className="spend-chart-segment"
                        key={segment.name}
                        style={{ background: segment.color, height: `${(segment.cost / Math.max(day.cost, 0.000001)) * 100}%` }}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  {(index % labelStride === 0 || index === daily.length - 1) && (
                    <span className="spend-chart-date" aria-hidden="true">{formatChartDate(day.date)}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="spend-chart-summary" aria-hidden="true">
          <span>{daily.length.toLocaleString('en-US')} days</span>
          <span>{formatCompact(daily.reduce((sum, day) => sum + day.calls, 0))} calls</span>
        </div>
      </div>
      <div className="spend-chart-legend" aria-label="Chart legend">
        {legend.map(item => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}
      </div>
    </div>
  )
}
