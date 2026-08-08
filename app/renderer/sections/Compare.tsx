import { useCallback, useEffect, useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { Dropdown } from '../components/Dropdown'
import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { SectionSkeleton } from '../components/Skeleton'
import { usePolled } from '../hooks/usePolled'
import { formatCompact, formatUsd } from '../lib/format'
import { metrora } from '../lib/ipc'
import { cacheReuseMultiple, cacheShare, costPerMillionObserved, formatReuseMultiple, observedTokenTotal } from '../lib/usageMetrics'
import type { CompareJsonReport, ComparisonRow, DateRange, ModelStats, Period, WorkingStyleRow } from '../lib/types'

function fmtMetric(v: number | null, fn: 'cost' | 'number' | 'percent' | 'decimal'): string | null {
  if (v === null) return null
  if (fn === 'cost') return formatUsd(v)
  if (fn === 'percent') return `${v.toFixed(0)}%`
  if (fn === 'decimal') return v.toFixed(2)
  return Math.round(v).toLocaleString('en-US')
}

function DenseMetricValue({
  value,
  model,
  metric,
  better = false,
}: {
  value: string | null
  model: string
  metric: string
  better?: boolean
}) {
  const accessibleValue = value ?? 'Not available'
  return (
    <span
      role="cell"
      className={`cmp-value${better ? ' cmp-best' : ''}`}
      aria-label={`${model}, ${metric}: ${accessibleValue}${better ? '. Better value' : ''}`}
      title={value === null ? 'Not available' : better ? 'Better value' : undefined}
    >
      {value === null ? <span aria-hidden="true">—</span> : value}
      {better && <> <span aria-hidden="true">✓</span></>}
    </span>
  )
}

// The CLI `compare` command has no --from/--to, so a custom range falls back to
// the selected period. Say so instead of silently ignoring the dates.
function RangeNote() {
  return (
    <p className="cmp-range-note" role="note">
      Compare uses the selected period; custom dates are not supported yet.
    </p>
  )
}

export function Compare({
  period,
  provider,
  range = null,
  refreshToken = 0,
  ready = true,
}: {
  period: Period
  provider: string
  range?: DateRange | null
  refreshToken?: number
  ready?: boolean
}) {
  const models = usePolled<ModelStats[]>(
    () => metrora.getCompareModels(period, provider),
    [period, provider, refreshToken],
    { enabled: ready, memoKey: `comparemodels|${period}|${provider}` },
  )
  const [modelA, setModelA] = useState<string | null>(null)
  const [modelB, setModelB] = useState<string | null>(null)

  useEffect(() => {
    if (!models.data) return
    const available = new Set(models.data.map(model => model.model))
    setModelA(current => current && available.has(current) ? current : models.data?.[0]?.model ?? null)
    setModelB(current => current && available.has(current) ? current : models.data?.[1]?.model ?? null)
  }, [models.data])

  const resetToDefaults = useCallback(() => {
    if (!models.data) return
    setModelA(models.data[0]?.model ?? null)
    setModelB(models.data[1]?.model ?? null)
  }, [models.data])

  if (!models.data) {
    if (models.error) return <CliErrorPanel error={models.error} subject="model comparisons" />
    return <SectionSkeleton label="Loading model comparison data…" rows={4} />
  }

  if (models.data.length < 2) {
    return (
      <Panel title="Compare">
        <EmptyNote>Need at least two models with usage in this range to compare.</EmptyNote>
      </Panel>
    )
  }

  const modelRows = models.data
  const nudgeDistinct = (chosen: string) => modelRows.find(model => model.model !== chosen)?.model ?? null

  return (
    <>
      {range && <RangeNote />}
      <div className="cmp-picker" aria-label="Models being compared">
        <Dropdown
          id="compare-first-model"
          ariaLabel="First model"
          value={modelA ?? ''}
          options={modelRows.map(model => ({ value: model.model, label: `${model.model} · ${model.calls.toLocaleString('en-US')} calls` }))}
          onChange={next => {
            setModelA(next)
            if (next === modelB) setModelB(nudgeDistinct(next))
          }}
        />
        <span className="cmp-vs">vs</span>
        <Dropdown
          id="compare-second-model"
          ariaLabel="Second model"
          value={modelB ?? ''}
          options={modelRows.map(model => ({ value: model.model, label: `${model.model} · ${model.calls.toLocaleString('en-US')} calls` }))}
          onChange={next => {
            setModelB(next)
            if (next === modelA) setModelA(nudgeDistinct(next))
          }}
        />
      </div>
      {modelA && modelB && modelA !== modelB && (
        <CompareReport
          period={period}
          provider={provider}
          modelA={modelA}
          modelB={modelB}
          refreshToken={refreshToken}
          onError={resetToDefaults}
        />
      )}
    </>
  )
}

function CompareReport({
  period,
  provider,
  modelA,
  modelB,
  refreshToken,
  onError,
}: {
  period: Period
  provider: string
  modelA: string
  modelB: string
  refreshToken: number
  onError: () => void
}) {
  const report = usePolled<CompareJsonReport>(
    () => metrora.getCompare(period, provider, modelA, modelB),
    [period, provider, modelA, modelB, refreshToken],
    { memoKey: `compare|${period}|${provider}|${modelA}|${modelB}` },
  )

  useEffect(() => {
    if (report.error) onError()
  }, [report.error, onError])

  if (!report.data) {
    if (report.error) return <CliErrorPanel error={report.error} subject="model comparisons" />
    return <SectionSkeleton label="Comparing observed usage…" rows={4} />
  }

  const workflowDiagnostics = report.data.metrics.filter(metric => metric.section === 'Performance')
  const efficiency = report.data.metrics.filter(metric => metric.section === 'Efficiency' && metric.label !== 'Cache hit rate')

  return (
    <div className="cmp-body">
      <p className="cmp-range-note" role="note">
        Observed on your local workloads. Cost and usage are measured history, not a benchmark score or a claim about general model quality.
      </p>
      <ObservedUsageCard modelA={report.data.modelA} modelB={report.data.modelB} />
      <div className="cmp-pair">
        <MetricCard title="Observed efficiency" rows={efficiency} modelA={report.data.modelA.model} modelB={report.data.modelB.model} />
        <CoverageCard modelA={report.data.modelA} modelB={report.data.modelB} />
      </div>
      <details className="panel cmp-card">
        <summary className="cmp-head"><h3>Workflow diagnostics · Experimental</h3><span className="cmp-head-note">Secondary signals, not model quality scores</span></summary>
        <div style={{ padding: '0 12px 12px' }}>
          <div className="cmp-pair">
            <MetricCard title="Editing signals" rows={workflowDiagnostics} modelA={report.data.modelA.model} modelB={report.data.modelB.model} />
            <MetricCard title="Working style" rows={report.data.workingStyle} modelA={report.data.modelA.model} modelB={report.data.modelB.model} />
          </div>
          <CategoryCard report={report.data} />
        </div>
      </details>
    </div>
  )
}

function ObservedUsageCard({ modelA, modelB }: { modelA: ModelStats; modelB: ModelStats }) {
  const totalA = observedTokenTotal(modelA)
  const totalB = observedTokenTotal(modelB)
  const reuseA = cacheReuseMultiple(modelA.inputTokens, modelA.cacheReadTokens)
  const reuseB = cacheReuseMultiple(modelB.inputTokens, modelB.cacheReadTokens)
  const shareA = cacheShare(modelA.inputTokens, modelA.cacheReadTokens)
  const shareB = cacheShare(modelB.inputTokens, modelB.cacheReadTokens)
  const unitA = costPerMillionObserved(modelA.cost, totalA)
  const unitB = costPerMillionObserved(modelB.cost, totalB)
  const rows: Array<{ label: string; valueA: string | null; valueB: string | null; note?: string }> = [
    { label: 'Calls', valueA: modelA.calls.toLocaleString('en-US'), valueB: modelB.calls.toLocaleString('en-US') },
    { label: 'Input', valueA: formatCompact(modelA.inputTokens), valueB: formatCompact(modelB.inputTokens) },
    { label: 'Output', valueA: formatCompact(modelA.outputTokens), valueB: formatCompact(modelB.outputTokens) },
    { label: 'Cache R', valueA: formatCompact(modelA.cacheReadTokens), valueB: formatCompact(modelB.cacheReadTokens) },
    { label: 'Cache W', valueA: formatCompact(modelA.cacheWriteTokens), valueB: formatCompact(modelB.cacheWriteTokens) },
    { label: 'Cache ×', valueA: formatReuseMultiple(reuseA), valueB: formatReuseMultiple(reuseB), note: `Cache share: ${shareA == null ? '—' : `${Math.round(shareA * 1000) / 10}%`} / ${shareB == null ? '—' : `${Math.round(shareB * 1000) / 10}%`}` },
    { label: 'Total tokens', valueA: formatCompact(totalA), valueB: formatCompact(totalB) },
    { label: 'Total cost', valueA: formatUsd(modelA.cost), valueB: formatUsd(modelB.cost) },
    { label: 'Cost / 1M', valueA: unitA == null ? null : formatUsd(unitA), valueB: unitB == null ? null : formatUsd(unitB) },
  ]

  return (
    <div className="panel cmp-card">
      <div className="cmp-head"><h3>Observed usage</h3><span className="cmp-head-note">Same metric definitions as Models and Sessions</span></div>
      <div className="cmp-metrics" role="table" aria-label="Observed usage comparison">
        <MetricHeader modelA={modelA.model} modelB={modelB.model} />
        {rows.map(row => (
          <div className="cmp-metric" role="row" key={row.label} title={row.note}>
            <span className="cmp-label" role="rowheader">{row.label}</span>
            <DenseMetricValue value={row.valueA} model={modelA.model} metric={row.label} />
            <DenseMetricValue value={row.valueB} model={modelB.model} metric={row.label} />
          </div>
        ))}
      </div>
    </div>
  )
}

function MetricCard({
  title,
  rows,
  modelA,
  modelB,
}: {
  title: string
  rows: Array<ComparisonRow | WorkingStyleRow>
  modelA: string
  modelB: string
}) {
  return (
    <div className="panel cmp-card">
      <div className="cmp-head"><h3>{title}</h3></div>
      <div className="cmp-metrics" role="table" aria-label={`${title} comparison`}>
        <MetricHeader modelA={modelA} modelB={modelB} />
        {rows.map(row => (
          <div className="cmp-metric" role="row" key={row.label}>
            <span className="cmp-label" role="rowheader">{row.label}</span>
            <DenseMetricValue value={fmtMetric(row.valueA, row.formatFn)} model={modelA} metric={row.label} />
            <DenseMetricValue value={fmtMetric(row.valueB, row.formatFn)} model={modelB} metric={row.label} />
          </div>
        ))}
      </div>
    </div>
  )
}

function MetricHeader({ modelA, modelB }: { modelA: string; modelB: string }) {
  return (
    <div className="cmp-metric-head" role="row">
      <span role="columnheader">Metric</span>
      <span role="columnheader">{modelA}</span>
      <span role="columnheader">{modelB}</span>
    </div>
  )
}

function CategoryCard({ report }: { report: CompareJsonReport }) {
  return (
    <div className="panel cmp-card">
      <div className="cmp-head"><h3>Editing categories</h3><span className="cmp-head-note">One-shot rate · edit turns · diagnostic only</span></div>
      <div className="cmp-category-body">
        <div className="cmp-legend">
          <span className="cmp-legend-item"><span className="cmp-key" />{report.modelA.model}</span>
          <span className="cmp-legend-item"><span className="cmp-key cmp-key-b" />{report.modelB.model}</span>
        </div>
        <div className="cmp-categories" aria-label="Category comparison">
          {report.categories.map(category => {
            const rateA = category.oneShotRateA
            const rateB = category.oneShotRateB
            return (
              <div className="cmp-category" role="group" aria-label={`${category.category} comparison`} key={category.category}>
                <span className="cmp-category-name">{category.category}</span>
                <div className="cmp-bars">
                  <div className="cmp-bar-row">
                    <span className="cmp-track" aria-hidden="true">
                      {rateA !== null && <span className="cmp-bar" style={{ width: `${rateA}%` }} />}
                    </span>
                    <span className="cmp-bar-value" aria-label={`${report.modelA.model}: ${rateA === null ? 'one-shot rate not available' : `${rateA.toFixed(0)}% one-shot rate`}; ${category.editTurnsA.toLocaleString('en-US')} edit turns`}>
                      {rateA === null ? 'Not available' : `${rateA.toFixed(0)}%`} <span className="cmp-turns">({category.editTurnsA.toLocaleString('en-US')})</span>
                    </span>
                  </div>
                  <div className="cmp-bar-row">
                    <span className="cmp-track" aria-hidden="true">
                      {rateB !== null && <span className="cmp-bar cmp-bar-b" style={{ width: `${rateB}%` }} />}
                    </span>
                    <span className="cmp-bar-value" aria-label={`${report.modelB.model}: ${rateB === null ? 'one-shot rate not available' : `${rateB.toFixed(0)}% one-shot rate`}; ${category.editTurnsB.toLocaleString('en-US')} edit turns`}>
                      {rateB === null ? 'Not available' : `${rateB.toFixed(0)}%`} <span className="cmp-turns">({category.editTurnsB.toLocaleString('en-US')})</span>
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function daysOfData(model: ModelStats): string | null {
  if (!model.firstSeen || !model.lastSeen) return null
  return String(Math.max(1, Math.round((new Date(model.lastSeen).getTime() - new Date(model.firstSeen).getTime()) / 86_400_000) + 1))
}

function CoverageCard({ modelA, modelB }: { modelA: ModelStats; modelB: ModelStats }) {
  const rows: Array<{ label: string; valueA: string | null; valueB: string | null }> = [
    { label: 'Edit turns', valueA: modelA.editTurns.toLocaleString('en-US'), valueB: modelB.editTurns.toLocaleString('en-US') },
    { label: 'Total turns', valueA: modelA.totalTurns.toLocaleString('en-US'), valueB: modelB.totalTurns.toLocaleString('en-US') },
    { label: 'Days observed', valueA: daysOfData(modelA), valueB: daysOfData(modelB) },
    { label: 'First seen', valueA: modelA.firstSeen ? new Date(modelA.firstSeen).toLocaleDateString('en-US') : null, valueB: modelB.firstSeen ? new Date(modelB.firstSeen).toLocaleDateString('en-US') : null },
    { label: 'Last seen', valueA: modelA.lastSeen ? new Date(modelA.lastSeen).toLocaleDateString('en-US') : null, valueB: modelB.lastSeen ? new Date(modelB.lastSeen).toLocaleDateString('en-US') : null },
  ]
  return (
    <div className="panel cmp-card">
      <div className="cmp-head"><h3>Observation context</h3></div>
      <div className="cmp-metrics" role="table" aria-label="Comparison observation context">
        <MetricHeader modelA={modelA.model} modelB={modelB.model} />
        {rows.map(row => (
          <div className="cmp-metric" role="row" key={row.label}>
            <span className="cmp-label" role="rowheader">{row.label}</span>
            <DenseMetricValue value={row.valueA} model={modelA.model} metric={row.label} />
            <DenseMetricValue value={row.valueB} model={modelB.model} metric={row.label} />
          </div>
        ))}
      </div>
    </div>
  )
}
