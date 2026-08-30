import { useCallback, useEffect, useMemo, useState } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { metrora, normalizeCliError } from '../lib/ipc'
import type { BenchComparison, BenchEvaluation, BenchModelDiscovery, BenchTaskResult, PerformanceBenchRequest, PerformanceHistoryReport } from '../lib/metrora-bridge-types'
import type { PerformanceComparisonV1 } from '../../../src/bench/performance-compare-v1'
import type { PerformanceRunV1 } from '../../../src/bench/performance-contract-v1'

function formatNumber(value: number): string {
  return value >= 100 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

function formatMetric(value: number | null, unit: string): string {
  return value === null ? 'Not available' : formatNumber(value) + ' ' + unit
}

function formatSignedMetric(value: number | null, unit: string): string {
  if (value === null) return 'Not available'
  return (value > 0 ? '+' : '') + formatNumber(value) + ' ' + unit
}

function formatPercent(value: number | null): string {
  return value === null ? 'Not available' : (value * 100).toFixed(0) + '%'
}

function formatSignedPoints(value: number | null): string {
  return value === null ? 'Not available' : (value > 0 ? '+' : '') + (value * 100).toFixed(0) + ' pts'
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString()
}

function formatDuration(startedAt: string, endedAt: string): string {
  const duration = Date.parse(endedAt) - Date.parse(startedAt)
  if (!Number.isFinite(duration) || duration < 0) return 'Not available'
  if (duration < 1_000) return duration + ' ms'
  return formatNumber(duration / 1_000) + ' s'
}

function median(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((left, right) => left - right)
  if (!available.length) return null
  const middle = Math.floor(available.length / 2)
  return available.length % 2 ? available[middle]! : (available[middle - 1]! + available[middle]!) / 2
}

function runtimeLabel(record: BenchEvaluation): string {
  const version = record.runtime.version ?? 'version not reported'
  return (record.runtime.id === 'ollama-local' ? 'Ollama local' : record.runtime.id) + ' · ' + version
}

function statusLabel(record: BenchEvaluation): string {
  if (record.status === 'completed') return 'Complete'
  if (record.status === 'cancelled') return 'Cancelled'
  if (record.aggregate.attempted === 0) return 'Runtime unavailable'
  return record.aggregate.unavailable > 0 ? 'Runtime unavailable during run' : 'Incomplete'
}

function statusTone(record: BenchEvaluation): string {
  if (record.status === 'completed') return 'completed'
  return record.status === 'cancelled' ? 'cancelled' : 'unavailable'
}

function checkSummary(record: BenchEvaluation): string {
  const scored = record.aggregate.passed + record.aggregate.failed
  return scored === 0 ? `No checks scored · ${record.aggregate.planned} planned` : `${record.aggregate.passed} / ${record.aggregate.planned}`
}

function stateMessage(record: BenchEvaluation): string {
  if (record.status === 'completed') return `${record.aggregate.attempted} of ${record.aggregate.planned} planned checks completed. Failed checks are scoring results, not missing data.`
  if (record.status === 'cancelled') return `Run cancelled after ${record.aggregate.attempted} of ${record.aggregate.planned} planned checks. Unstarted checks are not counted as failures.`
  if (record.aggregate.attempted === 0) return 'The local runtime was unavailable before any check ran. No score was calculated.'
  if (record.aggregate.unavailable > 0) return `The local runtime became unavailable during the run after ${record.aggregate.attempted} of ${record.aggregate.planned} planned checks. Unstarted checks are not counted as failures.`
  return `Run stopped after ${record.aggregate.attempted} of ${record.aggregate.planned} planned checks. Unstarted checks are not counted as failures.`
}

function taskStatusLabel(task: BenchTaskResult): string {
  if (task.status === 'passed') return 'Passed'
  if (task.status === 'failed') return 'Failed'
  if (task.status === 'malformed') return 'Malformed output'
  if (task.status === 'timeout') return 'Timed out'
  if (task.status === 'cancelled') return 'Cancelled'
  return 'Unavailable'
}

function runtimeMetricsLabel(task: BenchTaskResult): string {
  const metrics = task.runtimeReported
  if (!metrics) return 'Runtime metrics: not reported'
  const values = [
    metrics.promptEvalCount === null ? null : `prompt ${metrics.promptEvalCount} tokens`,
    metrics.evalCount === null ? null : `eval ${metrics.evalCount} tokens`,
    metrics.evalDurationNs === null ? null : `eval ${(metrics.evalDurationNs / 1_000_000).toFixed(1)} ms`,
  ].filter((value): value is string => value !== null)
  return values.length ? 'Runtime-reported: ' + values.join(' · ') : 'Runtime metrics: not reported'
}

function comparisonReasonLabel(reason: string): string {
  if (reason === 'pack-mismatch') return 'pack identity differs'
  if (reason === 'runner-mismatch') return 'runner identity differs'
  if (reason === 'scoring-mismatch') return 'task identity or scoring differs'
  if (reason === 'generation-mismatch') return 'generation parameters differ'
  if (reason === 'compatible') return 'compatible'
  return reason
}

function performanceStatusLabel(record: PerformanceRunV1): string {
  if (record.status === 'completed') return 'Complete'
  if (record.status === 'cancelled') return 'Cancelled'
  if (record.status === 'unavailable') return 'Unavailable'
  return record.termination.status === 'timeout' ? 'Timed out' : 'Incomplete'
}

function performanceStatusTone(record: PerformanceRunV1): string {
  if (record.status === 'completed') return 'completed'
  return record.status === 'cancelled' ? 'cancelled' : 'unavailable'
}

function performanceMetric(value: number | null, unit: string): string {
  return value === null || !Number.isFinite(value) ? 'Not available' : `${formatNumber(value)} ${unit}`
}

function performanceWorkload(record: PerformanceRunV1, workload: 'prefill' | 'decode'): PerformanceRunV1['workloads'][number] | null {
  return record.workloads.find(item => item.workload === workload) ?? null
}

function performanceModelLabel(record: PerformanceRunV1): string {
  const type = record.model.type ? ` · ${record.model.type}` : ''
  const quantization = record.model.quantization ? ` · ${record.model.quantization}` : ''
  return record.model.selected + type + quantization
}

function PerformanceSetup({
  executablePath,
  modelPath,
  running,
  onChooseExecutable,
  onChooseModel,
  onRun,
  onCancel,
}: {
  executablePath: string
  modelPath: string
  running: boolean
  onChooseExecutable: () => void
  onChooseModel: () => void
  onRun: () => void
  onCancel: () => void
}) {
  return <div className="bench-performance-setup">
    <div className="bench-performance-file-row">
      <label>llama-bench executable<input aria-label="llama-bench executable" value={executablePath} readOnly placeholder="Choose an existing llama-bench executable" /></label>
      <button type="button" className="bench-secondary-button" onClick={onChooseExecutable} disabled={running}>Choose executable</button>
    </div>
    <div className="bench-performance-file-row">
      <label>GGUF model<input aria-label="GGUF model" value={modelPath} readOnly placeholder="Choose an existing .gguf model" /></label>
      <button type="button" className="bench-secondary-button" onClick={onChooseModel} disabled={running}>Choose model</button>
    </div>
    <div className="bench-performance-setup-summary">
      <span>Bounded setup</span>
      <b>3 repetitions · prefill 512 tokens · decode 128 tokens · batch 2048 · ubatch 512 · GPU layers -1 · Flash Attention auto</b>
      <small>Only known llama-bench arguments are used. No shell command or arbitrary flags are accepted.</small>
    </div>
    <div className="bench-performance-actions">
      <button type="button" className="btn btn-p" onClick={onRun} disabled={running || !executablePath || !modelPath}>{running ? 'Running llama-bench…' : 'Run Performance'}</button>
      {running ? <button type="button" className="bench-secondary-button" onClick={onCancel}>Cancel</button> : null}
    </div>
    {running ? <p className="bench-performance-progress" role="status" aria-live="polite">Native llama-bench is running with a bounded ten-minute timeout. Cancel remains available.</p> : null}
  </div>
}

function PerformanceRecordDetails({ record }: { record: PerformanceRunV1 }) {
  const setup = record.methodology.setup
  return <div className="bench-disclosures">
    <details>
      <summary>Details</summary>
      <div className="bench-detail-grid">
        <span>Methodology</span><b>{record.methodology.id}@{record.methodology.version}</b>
        <span>Runner</span><b>{record.runner.id}@{record.runner.version}</b>
        <span>Executable</span><b>{record.executable.name}</b>
        <span>Model</span><b>{performanceModelLabel(record)}</b>
        <span>Model size</span><b>{record.model.sizeBytes === null ? 'Not reported' : `${formatNumber(record.model.sizeBytes / (1024 * 1024 * 1024))} GiB`}</b>
        <span>Parameters</span><b>{record.model.parameterCount === null ? 'Not reported' : record.model.parameterCount.toLocaleString()}</b>
        <span>Runtime build</span><b>{record.runtime.version ?? 'Not reported'}</b>
        <span>Backends</span><b>{record.runtime.backends.length ? record.runtime.backends.join(', ') : 'Not reported'}</b>
        <span>Hardware</span><b>{record.hardware.cpuInfo ?? 'Not reported'}{record.hardware.gpuInfo ? ' · ' + record.hardware.gpuInfo : ''}</b>
        <span>Setup</span><b>{setup.repetitions} reps · {setup.promptTokens} prompt · {setup.generationTokens} generation · batch {setup.batchSize} · ubatch {setup.ubatchSize}</b>
        <span>Run ID</span><code className="bench-breakable">{record.runId}</code>
        <span>Result digest</span><code className="bench-breakable">{record.resultDigest}</code>
      </div>
    </details>
    <details>
      <summary>Measured workloads</summary>
      <p className="bench-evidence-note">Metrics are normalized from llama-bench JSON output. Missing upstream fields remain unavailable; this record has no quality score or universal ranking.</p>
      <div className="bench-performance-workloads">
        {record.workloads.map((workload, index) => <div className="bench-performance-workload" key={`${workload.workload}-${index}`}>
          <b>{workload.workload}</b>
          <span>Throughput <strong>{performanceMetric(workload.throughputTokensPerSecond, 'tokens/s')}</strong></span>
          <span>Average time <strong>{performanceMetric(workload.averageLatencyMs, 'ms')}</strong></span>
          <span>Test size <strong>{workload.promptTokens ?? '—'} prompt · {workload.generationTokens ?? '—'} generation</strong></span>
          <span>Stddev <strong>{performanceMetric(workload.throughputStddevTokensPerSecond, 'tokens/s')}</strong></span>
        </div>)}
      </div>
    </details>
  </div>
}

function PerformanceEvidenceCard({ record }: { record: PerformanceRunV1 | null }) {
  if (!record) return <Panel title="Latest Performance"><EmptyNote>Choose a llama-bench executable and GGUF model to create a retained Performance record.</EmptyNote></Panel>
  const prefill = performanceWorkload(record, 'prefill')
  const decode = performanceWorkload(record, 'decode')
  return <Panel title="Latest Performance" right={<span className={'bench-status bench-status-' + performanceStatusTone(record)}>{performanceStatusLabel(record)}</span>}>
    <div className="bench-kpis">
      <div><strong>{performanceMetric(prefill?.throughputTokensPerSecond ?? null, 'tok/s')}</strong><span>prefill throughput</span></div>
      <div><strong>{performanceMetric(decode?.throughputTokensPerSecond ?? null, 'tok/s')}</strong><span>decode throughput</span></div>
      <div><strong>{performanceMetric(prefill?.averageLatencyMs ?? null, 'ms')}</strong><span>prefill average time</span></div>
      <div><strong>{formatDuration(record.startedAt, record.endedAt)}</strong><span>run duration</span></div>
    </div>
    <p className={'bench-state-note bench-state-' + performanceStatusTone(record)}>{record.status === 'completed' ? 'The declared llama-bench setup completed. These figures describe this model/runtime/hardware configuration only.' : record.status === 'cancelled' ? 'The native run was cancelled. No missing throughput is inferred.' : record.failure?.message ?? 'The native Performance run did not produce a complete usable result.'}</p>
    <div className="bench-primary-grid">
      <span>Model</span><b>{performanceModelLabel(record)}</b>
      <span>Runtime</span><b>{record.runtime.id} · {record.runtime.version ?? 'build not reported'}</b>
      <span>Test sizes</span><b>{record.methodology.setup.promptTokens} prompt · {record.methodology.setup.generationTokens} generation</b>
      <span>Run date</span><b>{formatTimestamp(record.endedAt)}</b>
    </div>
    <PerformanceRecordDetails record={record} />
  </Panel>
}

function performanceComparisonReason(reason: PerformanceComparisonV1['reason']): string {
  if (reason === 'methodology-mismatch') return 'methodology identity differs'
  if (reason === 'runner-mismatch') return 'runner identity differs'
  if (reason === 'setup-mismatch') return 'declared setup differs'
  if (reason === 'hardware-mismatch') return 'runtime or hardware identity differs'
  if (reason === 'incomplete-run') return 'one run did not complete'
  if (reason === 'missing-metrics') return 'required metrics are unavailable'
  return 'compatible'
}

function PerformanceComparisonCard({ comparison }: { comparison: PerformanceComparisonV1 }) {
  if (!comparison.compatible) return <div className="bench-compare-state" role="alert"><strong>Not comparable</strong><p>These Performance records do not share an evidence-compatible methodology, runtime, hardware, or usable metric set.</p><small>Reason: {performanceComparisonReason(comparison.reason)}</small></div>
  const deltas = comparison.deltas
  return <div className="bench-comparison-result">
    <div className="bench-comparison-head"><span><b>{comparison.left.model}</b><small>Reference</small></span><span>→</span><span><b>{comparison.right.model}</b><small>Comparison</small></span></div>
    <div className="bench-compare-grid">
      <span>Prefill throughput delta</span><b>{formatSignedMetric(deltas?.prefillThroughputTokensPerSecond ?? null, 'tokens/s')}</b>
      <span>Decode throughput delta</span><b>{formatSignedMetric(deltas?.decodeThroughputTokensPerSecond ?? null, 'tokens/s')}</b>
      <span>Prefill time delta</span><b>{formatSignedMetric(deltas?.prefillLatencyMs ?? null, 'ms')}</b>
      <span>Decode time delta</span><b>{formatSignedMetric(deltas?.decodeLatencyMs ?? null, 'ms')}</b>
    </div>
    <details className="bench-comparison-details"><summary>Comparison evidence</summary><div className="bench-detail-grid"><span>Compatibility</span><b>{comparison.reason}</b><span>Reference run</span><code className="bench-breakable">{comparison.left.runId} · {formatTimestamp(comparison.left.endedAt)}</code><span>Comparison run</span><code className="bench-breakable">{comparison.right.runId} · {formatTimestamp(comparison.right.endedAt)}</code></div></details>
     <p className="bench-footnote">Deltas are Comparison minus Reference. They are conditional on the retained setup and environment, not a universal model-quality score.</p>
  </div>
}

function PerformanceComparisonPanel({ history, comparison, loading, leftRunId, rightRunId, onLeftRunChange, onRightRunChange }: {
  history: PerformanceRunV1[]
  comparison: PerformanceComparisonV1 | null
  loading: boolean
  leftRunId: string
  rightRunId: string
  onLeftRunChange: (value: string) => void
  onRightRunChange: (value: string) => void
}) {
  const optionLabel = (record: PerformanceRunV1) => `${record.model.selected} · ${formatTimestamp(record.endedAt)}`
  return <Panel title="Compare Performance runs" right={loading ? <span className="bench-status">Checking compatibility…</span> : comparison?.compatible ? <span className="bench-compatible">compatible</span> : null}>
    {history.length < 2 ? <EmptyNote>Two retained Performance records are needed for an evidence-aware comparison.</EmptyNote> : <>
      <div className="bench-select-row"><label>Reference<select aria-label="Performance reference run" value={leftRunId} onChange={event => onLeftRunChange(event.target.value)}><option value="">Select a run</option>{history.map(record => <option key={record.runId} value={record.runId}>{optionLabel(record)}</option>)}</select></label><span>vs</span><label>Comparison<select aria-label="Performance comparison run" value={rightRunId} onChange={event => onRightRunChange(event.target.value)}><option value="">Select a run</option>{history.map(record => <option key={record.runId} value={record.runId}>{optionLabel(record)}</option>)}</select></label></div>
      {!leftRunId || !rightRunId || leftRunId === rightRunId ? <p className="bench-footnote">Choose two different retained records. Setup and environment mismatches remain explicitly not comparable.</p> : loading ? <p className="bench-footnote" role="status">Checking compatible Performance evidence…</p> : comparison ? <PerformanceComparisonCard comparison={comparison} /> : <p className="bench-footnote">Performance comparison evidence is unavailable.</p>}
    </>}
  </Panel>
}

function ModelPicker({
  discovery,
  discoveryFailed,
  loading,
  manualEntry,
  model,
  onManualEntryChange,
  onModelChange,
  onRefresh,
}: {
  discovery: BenchModelDiscovery | null
  discoveryFailed: boolean
  loading: boolean
  manualEntry: boolean
  model: string
  onManualEntryChange: (value: boolean) => void
  onModelChange: (value: string) => void
  onRefresh: () => void
}) {
  const models = discovery?.status === 'models-discovered' ? discovery.models : []
  const manualMode = manualEntry || (model.trim() !== '' && !models.includes(model))
  const selectedDiscoveredModel = models.includes(model) ? model : models[0] ?? ''
  const discoveryMessage = loading
    ? 'Checking Ollama for local models…'
    : discoveryFailed
      ? 'Model discovery is unavailable. Manual Ollama model entry remains available.'
      : discovery?.status === 'models-discovered'
        ? discovery.detail + ' Choose a discovered model or enter another one.'
        : discovery?.status === 'no-models'
          ? discovery.detail + ' Enter a model name manually after loading one into Ollama.'
          : discovery?.status === 'unavailable'
            ? 'Model discovery is unavailable. Manual Ollama model entry remains available.'
            : 'No local Ollama models were discovered. Enter a model name manually if one is available.'

  return (
    <div className="bench-model-picker">
      <div className="bench-model-picker-controls">
        <label htmlFor="bench-model">Local model</label>
        {models.length > 0 && !manualMode ? <select id="bench-model" value={selectedDiscoveredModel} onChange={event => {
          if (event.target.value === '__manual__') {
            onManualEntryChange(true)
            onModelChange('')
          } else onModelChange(event.target.value)
        }}>
          <option value="">Choose a discovered model</option>
          {models.map(item => <option key={item} value={item}>{item}</option>)}
          <option value="__manual__">Enter another Ollama model…</option>
        </select> : <input id="bench-model" value={model} onChange={event => onModelChange(event.target.value)} placeholder="e.g. qwen3:8b" />}
        <button type="button" className="bench-secondary-button" onClick={onRefresh} disabled={loading}>{loading ? 'Checking…' : 'Refresh models'}</button>
      </div>
      {manualMode && models.length > 0 ? <button type="button" className="bench-inline-link" onClick={() => {
        onManualEntryChange(false)
        onModelChange(models[0] ?? '')
      }}>Use a discovered model</button> : null}
      <p className={'bench-model-discovery bench-model-discovery-' + (loading ? 'checking' : discovery?.status ?? 'unavailable')} role="status" aria-live="polite">{discoveryMessage}</p>
    </div>
  )
}

function RecordDetails({ record }: { record: BenchEvaluation }) {
  const environment = record.environment
  const generation = record.generation
  return <div className="bench-disclosures">
    <details>
      <summary>Details</summary>
      <div className="bench-detail-grid">
        <span>Pack identity</span><b>Core conformance · {record.pack.packId}@{record.pack.version}</b>
        <span>Pack digest</span><code className="bench-breakable">{record.pack.digest}</code>
        <span>Result digest</span><code className="bench-breakable">{record.resultDigest}</code>
        <span>Runner</span><b>{record.runner.id}@{record.runner.version}</b>
        <span>Runtime endpoint</span><code>{record.runtime.endpoint}</code>
        <span>Reported model</span><b>{record.model.reported ?? 'Not reported'}</b>
        <span>Run ID</span><code className="bench-breakable">{record.runId}</code>
        <span>Raw status</span><b>{record.status}</b>
        <span>Aggregate</span><b>{record.aggregate.passed} passed · {record.aggregate.failed} failed · {record.aggregate.unavailable} unavailable · {record.aggregate.cancelled} cancelled</b>
        <span>Scored checks</span><b>{record.aggregate.score.denominator ? `${record.aggregate.score.numerator} / ${record.aggregate.score.denominator}` : 'None'}</b>
        <span>Environment</span><b>{environment ? `${environment.os} · ${environment.arch} · ${environment.node}` : 'Not retained'}</b>
        <span>Generation</span><b>{generation ? Object.entries(generation.parameters).map(([key, value]) => `${key} ${value}`).join(' · ') : 'Not retained'}</b>
      </div>
    </details>
    <details>
      <summary>Evidence</summary>
      <p className="bench-evidence-note">Each check retains its status, score, output digest, output size, timing, and bounded runtime-reported metrics. Response bodies and prompts are not retained.</p>
      <div className="bench-task-list" aria-label="Bench task evidence">
        {record.tasks.map(task => <div className="bench-task-row" key={task.taskId}>
          <span><b>{task.taskId}</b><small>{taskStatusLabel(task)}{task.failure ? ' · ' + task.failure.code : ''}</small></span>
          <span className="bench-task-evidence">{task.outputChars === null ? 'Output unavailable' : `${task.outputChars} chars · ${task.outputDigest ? 'digest ' + task.outputDigest.slice(0, 12) + '…' : 'digest unavailable'}`}<small>{formatMetric(task.requestLatencyMs, 'ms')} request · {formatMetric(task.timeToFirstContentMs, 'ms')} first content</small><small>{runtimeMetricsLabel(task)}</small></span>
          <b className={'bench-task-' + task.status}>{task.score === null ? 'Not scored' : task.score === 1 ? 'score 1' : 'score 0'}</b>
        </div>)}
      </div>
      <details className="bench-raw-disclosure">
        <summary>Raw task results</summary>
        <pre aria-label="Raw task results">{JSON.stringify(record.tasks, null, 2)}</pre>
      </details>
    </details>
  </div>
}

function EvidenceCard({ record }: { record: BenchEvaluation | null }) {
  if (!record) return <Panel title="Latest core conformance"><EmptyNote>Run Core conformance to create a retained evidence record.</EmptyNote></Panel>
  const medianRequestLatency = median(record.tasks.map(task => task.requestLatencyMs))
  const medianFirstContent = median(record.tasks.map(task => task.timeToFirstContentMs))
  return (
    <Panel title="Latest core conformance" right={<span className={'bench-status bench-status-' + statusTone(record)}>{statusLabel(record)}</span>}>
      <div className="bench-kpis">
        <div><strong>{checkSummary(record)}</strong><span>checks passed / planned</span></div>
        <div><strong>{formatPercent(record.aggregate.score.value)}</strong><span>pass rate of scored checks</span></div>
        <div><strong>{formatMetric(medianRequestLatency, 'ms')}</strong><span>median request time</span></div>
        <div><strong>{formatDuration(record.startedAt, record.endedAt)}</strong><span>run duration</span></div>
      </div>
      <p className={'bench-state-note bench-state-' + statusTone(record)}>{stateMessage(record)}</p>
      <div className="bench-primary-grid">
        <span>Model</span><b>{record.model.selected}</b>
        <span>Runtime</span><b>{runtimeLabel(record)}</b>
        <span>First content</span><b>{formatMetric(medianFirstContent, 'ms')}</b>
        <span>Run date</span><b>{formatTimestamp(record.endedAt)}</b>
      </div>
      <RecordDetails record={record} />
    </Panel>
  )
}

function ComparisonCard({ comparison }: { comparison: BenchComparison }) {
  if (!comparison.compatible) return <div className="bench-compare-state" role="alert">
    <strong>Not comparable</strong>
    <p>These retained records use incompatible conformance evidence and no deltas were calculated.</p>
    <small>Reason: {comparisonReasonLabel(comparison.reason)}</small>
  </div>
  const deltas = comparison.deltas
  if (!deltas) return <div className="bench-compare-state" role="alert"><strong>Comparison unavailable</strong><p>No compatible delta evidence was retained for these records.</p></div>
  return <div className="bench-comparison-result">
    <div className="bench-comparison-head"><span><b>{comparison.left.model}</b><small>Reference</small></span><span>→</span><span><b>{comparison.right.model}</b><small>Comparison</small></span></div>
    <div className="bench-compare-grid">
      <span>Pass-rate delta</span><b>{formatSignedPoints(deltas.score)}</b>
      <span>Passed checks delta</span><b>{formatSignedMetric(deltas.passed, 'checks')}</b>
      <span>Request latency delta</span><b>{formatSignedMetric(deltas.medianRequestLatencyMs, 'ms')}</b>
      <span>First content delta</span><b>{formatSignedMetric(deltas.medianFirstContentMs, 'ms')}</b>
    </div>
    <details className="bench-comparison-details">
      <summary>Comparison evidence</summary>
      <div className="bench-detail-grid">
        <span>Compatibility</span><b>{comparison.reason}</b>
        <span>Failed checks delta</span><b>{formatSignedMetric(deltas.failed, 'checks')}</b>
        <span>Unavailable delta</span><b>{formatSignedMetric(deltas.unavailable, 'checks')}</b>
        <span>Cancelled delta</span><b>{formatSignedMetric(deltas.cancelled, 'checks')}</b>
        <span>Reference run</span><code className="bench-breakable">{comparison.left.runId} · {formatTimestamp(comparison.left.endedAt)}</code>
        <span>Comparison run</span><code className="bench-breakable">{comparison.right.runId} · {formatTimestamp(comparison.right.endedAt)}</code>
      </div>
    </details>
    <p className="bench-footnote">Only compatible Core conformance records are compared. These are factual check and timing deltas, not a general coding-quality measurement.</p>
  </div>
}

function ComparisonPanel({
  comparison,
  comparisonLoading,
  history,
  leftRunId,
  onLeftRunChange,
  onRightRunChange,
  rightRunId,
}: {
  comparison: BenchComparison | null
  comparisonLoading: boolean
  history: BenchEvaluation[]
  leftRunId: string
  onLeftRunChange: (value: string) => void
  onRightRunChange: (value: string) => void
  rightRunId: string
}) {
  const selectedLeft = history.find(record => record.runId === leftRunId) ?? null
  const selectedRight = history.find(record => record.runId === rightRunId) ?? null
  const optionLabel = (record: BenchEvaluation) => `${record.model.selected} · ${formatTimestamp(record.endedAt)}`
  return <Panel title="Compare runs" right={comparisonLoading ? <span className="bench-status">Checking compatibility…</span> : comparison?.compatible ? <span className="bench-compatible">compatible</span> : null}>
    {history.length < 2 ? <EmptyNote>Two retained Core conformance records are needed for a factual comparison.</EmptyNote> : <>
      <div className="bench-select-row">
        <label>Reference<select aria-label="Bench reference run" value={leftRunId} onChange={event => onLeftRunChange(event.target.value)}><option value="">Select a run</option>{history.map(record => <option key={record.runId} value={record.runId}>{optionLabel(record)}</option>)}</select></label>
        <span>vs</span>
        <label>Comparison<select aria-label="Bench comparison run" value={rightRunId} onChange={event => onRightRunChange(event.target.value)}><option value="">Select a run</option>{history.map(record => <option key={record.runId} value={record.runId}>{optionLabel(record)}</option>)}</select></label>
      </div>
      {!selectedLeft || !selectedRight || leftRunId === rightRunId ? <p className="bench-footnote">Choose two different retained records. Incompatible pack, runner, scoring, or generation identities stay explicitly unavailable.</p> : comparisonLoading ? <p className="bench-footnote" role="status">Checking compatible evidence…</p> : comparison ? <ComparisonCard comparison={comparison} /> : <p className="bench-footnote">Comparison evidence is unavailable.</p>}
    </>}
  </Panel>
}

export function Bench() {
  const [history, setHistory] = useState<BenchEvaluation[]>([])
  const [invalidCount, setInvalidCount] = useState(0)
  const [model, setModel] = useState('')
  const [manualEntry, setManualEntry] = useState(false)
  const [modelDiscovery, setModelDiscovery] = useState<BenchModelDiscovery | null>(null)
  const [modelDiscoveryLoading, setModelDiscoveryLoading] = useState(true)
  const [modelDiscoveryFailed, setModelDiscoveryFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leftRunId, setLeftRunId] = useState('')
  const [rightRunId, setRightRunId] = useState('')
  const [comparison, setComparison] = useState<BenchComparison | null>(null)
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const [performanceHistory, setPerformanceHistory] = useState<PerformanceRunV1[]>([])
  const [performanceInvalidCount, setPerformanceInvalidCount] = useState(0)
  const [performanceLoading, setPerformanceLoading] = useState(true)
  const [performanceRunning, setPerformanceRunning] = useState(false)
  const [performanceExecutable, setPerformanceExecutable] = useState('')
  const [performanceModel, setPerformanceModel] = useState('')
  const [performanceRequestId, setPerformanceRequestId] = useState<string | null>(null)
  const [performanceLeftRunId, setPerformanceLeftRunId] = useState('')
  const [performanceRightRunId, setPerformanceRightRunId] = useState('')
  const [performanceComparison, setPerformanceComparison] = useState<PerformanceComparisonV1 | null>(null)
  const [performanceComparisonLoading, setPerformanceComparisonLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    try {
      const report = await metrora.getBenchHistory()
      setHistory(report.records)
      setInvalidCount(report.invalidCount)
      setLeftRunId(current => current && report.records.some(record => record.runId === current) ? current : report.records[1]?.runId ?? report.records[0]?.runId ?? '')
      setRightRunId(current => current && report.records.some(record => record.runId === current) ? current : report.records[0]?.runId ?? '')
      setError(null)
    } catch (cause) {
      setError(normalizeCliError(cause).message)
    } finally { setLoading(false) }
  }, [])

  const loadModelDiscovery = useCallback(async () => {
    setModelDiscoveryLoading(true)
    try {
      if (typeof metrora.getBenchModelDiscovery !== 'function') throw new Error('model discovery bridge unavailable')
      const report = await metrora.getBenchModelDiscovery()
      setModelDiscovery(report)
      setModelDiscoveryFailed(false)
      setModel(current => report.status === 'models-discovered' && !current.trim() ? report.models[0] ?? '' : current)
    } catch {
      setModelDiscovery(null)
      setModelDiscoveryFailed(true)
    } finally { setModelDiscoveryLoading(false) }
  }, [])

  const loadPerformanceHistory = useCallback(async () => {
    const reader = metrora.getPerformanceBenchHistory
    if (typeof reader !== 'function') { setPerformanceLoading(false); return }
    setPerformanceLoading(true)
    try {
      const report: PerformanceHistoryReport = await reader()
      setPerformanceHistory(report.records)
      setPerformanceInvalidCount(report.invalidCount)
      setPerformanceLeftRunId(current => current && report.records.some(record => record.runId === current) ? current : report.records[1]?.runId ?? report.records[0]?.runId ?? '')
      setPerformanceRightRunId(current => current && report.records.some(record => record.runId === current) ? current : report.records[0]?.runId ?? '')
    } catch (cause) {
      setError(normalizeCliError(cause).message)
    } finally { setPerformanceLoading(false) }
  }, [])

  useEffect(() => {
    void loadHistory()
    void loadModelDiscovery()
    void loadPerformanceHistory()
  }, [loadHistory, loadModelDiscovery, loadPerformanceHistory])

  const choosePerformanceFile = async (kind: 'llama-bench' | 'gguf') => {
    if (typeof metrora.chooseFile !== 'function') { setError('This desktop build does not expose the native file picker.'); return }
    try {
      const selected = await metrora.chooseFile(kind)
      if (selected) {
        if (kind === 'llama-bench') setPerformanceExecutable(selected)
        else setPerformanceModel(selected)
        setError(null)
      }
    } catch (cause) { setError(normalizeCliError(cause).message) }
  }

  const runPerformance = async () => {
    if (!performanceExecutable || !performanceModel) { setError('Choose an existing llama-bench executable and .gguf model first.'); return }
    if (typeof metrora.runPerformanceBench !== 'function') { setError('This desktop build does not expose native Performance Bench.'); return }
    const requestId = `performance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    setPerformanceRequestId(requestId)
    setPerformanceRunning(true)
    setError(null)
    const request: PerformanceBenchRequest = {
      executablePath: performanceExecutable,
      modelPath: performanceModel,
      repetitions: 3,
      promptTokens: 512,
      generationTokens: 128,
      batchSize: 2048,
      ubatchSize: 512,
      threads: null,
      gpuLayers: -1,
      flashAttention: 'auto',
      splitMode: 'none',
      mainGpu: null,
      warmup: true,
      timeoutMs: 10 * 60_000,
    }
    try {
      const record = await metrora.runPerformanceBench(requestId, request)
      setPerformanceHistory(current => [record, ...current.filter(item => item.runId !== record.runId)].slice(0, 50))
      setPerformanceLeftRunId(current => current || record.runId)
      setPerformanceRightRunId(record.runId)
    } catch (cause) {
      if (!/cancel|abort/i.test(normalizeCliError(cause).message)) setError(normalizeCliError(cause).message)
    } finally {
      setPerformanceRequestId(current => current === requestId ? null : current)
      setPerformanceRunning(false)
    }
  }

  const cancelPerformance = async () => {
    const requestId = performanceRequestId
    if (!requestId || typeof metrora.cancelPerformanceBench !== 'function') return
    try { await metrora.cancelPerformanceBench(requestId) } catch { /* terminal UI state remains cancelled */ }
  }

  const latest = history[0] ?? null
  const run = async () => {
    const selectedModel = model.trim()
    if (!selectedModel) { setError('Select or enter a local Ollama model first.'); return }
    setRunning(true); setError(null)
    try {
      const record = await metrora.runBenchTaskPack(selectedModel, 'core-v1')
      setHistory(current => [record, ...current.filter(item => item.runId !== record.runId)].slice(0, 50))
      setLeftRunId(current => current || record.runId)
      setRightRunId(record.runId)
    } catch (cause) { setError(normalizeCliError(cause).message) }
    finally { setRunning(false) }
  }

  useEffect(() => {
    if (!leftRunId || !rightRunId || leftRunId === rightRunId) {
      setComparison(null)
      setComparisonLoading(false)
      return
    }
    let active = true
    setComparison(null)
    setComparisonLoading(true)
    void metrora.getBenchComparison(leftRunId, rightRunId).then(value => {
      if (active) setComparison(value)
    }).catch(cause => {
      if (active) setError(normalizeCliError(cause).message)
    }).finally(() => {
      if (active) setComparisonLoading(false)
    })
    return () => { active = false }
  }, [leftRunId, rightRunId])

  useEffect(() => {
    if (!performanceLeftRunId || !performanceRightRunId || performanceLeftRunId === performanceRightRunId) {
      setPerformanceComparison(null)
      setPerformanceComparisonLoading(false)
      return
    }
    const reader = metrora.getPerformanceBenchComparison
    if (typeof reader !== 'function') { setPerformanceComparison(null); setPerformanceComparisonLoading(false); return }
    let active = true
    setPerformanceComparison(null)
    setPerformanceComparisonLoading(true)
    void reader(performanceLeftRunId, performanceRightRunId).then(value => {
      if (active) setPerformanceComparison(value)
    }).catch(cause => {
      if (active) setError(normalizeCliError(cause).message)
    }).finally(() => {
      if (active) setPerformanceComparisonLoading(false)
    })
    return () => { active = false }
  }, [performanceLeftRunId, performanceRightRunId])

  return (
    <main className="bench-surface" aria-label="Local Bench">
      <header className="bench-header">
        <div><p className="bench-kicker">MEASURE · LOCAL ONLY</p><h1>Bench</h1><p>Performance is the primary local measurement surface. Core conformance checks remain a separate bounded check for instruction following and structured responses; these surfaces are not a general coding or model-quality evaluation.</p></div>
        <div className="bench-run-control">
          <ModelPicker discovery={modelDiscovery} discoveryFailed={modelDiscoveryFailed} loading={modelDiscoveryLoading} manualEntry={manualEntry} model={model} onManualEntryChange={setManualEntry} onModelChange={setModel} onRefresh={() => void loadModelDiscovery()} />
          <button type="button" className="btn btn-p" onClick={() => void run()} disabled={running || !model.trim()}>{running ? 'Running…' : 'Run Core conformance'}</button>
        </div>
      </header>
      {error ? <p className="bench-alert" role="alert">{error}</p> : null}
      <section className="bench-performance-section" aria-labelledby="bench-performance-title">
        <div className="bench-surface-heading">
          <div><p className="bench-kicker">PRIMARY · NATIVE LLAMA.CPP</p><h2 id="bench-performance-title">Performance</h2><p>Run the bounded <code>llama-bench</code> adapter against an existing executable and GGUF model. Results retain upstream throughput, timing, setup, runtime, and hardware evidence without a universal score.</p></div>
          <span className="bench-surface-badge">{performanceHistory.length ? `${performanceHistory.length} retained` : 'No retained runs'}</span>
        </div>
        <PerformanceSetup executablePath={performanceExecutable} modelPath={performanceModel} running={performanceRunning} onChooseExecutable={() => void choosePerformanceFile('llama-bench')} onChooseModel={() => void choosePerformanceFile('gguf')} onRun={() => void runPerformance()} onCancel={() => void cancelPerformance()} />
        <div className="bench-grid">
          <PerformanceEvidenceCard record={performanceHistory[0] ?? null} />
          <Panel title="Recent Performance runs" right={performanceInvalidCount ? <span className="bench-invalid">{performanceInvalidCount} invalid retained record{performanceInvalidCount === 1 ? '' : 's'} skipped</span> : null}>
            {performanceLoading ? <EmptyNote>Loading local Performance history…</EmptyNote> : performanceHistory.length === 0 ? performanceInvalidCount > 0 ? <EmptyNote>No usable Performance runs yet. Invalid retained records were skipped.</EmptyNote> : <EmptyNote>No Performance runs yet.</EmptyNote> : <div className="bench-history-list">{performanceHistory.map(record => {
              const decode = performanceWorkload(record, 'decode')
              return <button type="button" className={record.runId === performanceRightRunId ? 'bench-history-row active' : 'bench-history-row'} key={record.runId} onClick={() => setPerformanceRightRunId(record.runId)}><span><b>{record.model.selected}</b><small>{formatTimestamp(record.endedAt)} · {performanceStatusLabel(record)}</small></span><strong>{performanceMetric(decode?.throughputTokensPerSecond ?? null, 'tok/s')}</strong></button>
            })}</div>}
          </Panel>
        </div>
        <PerformanceComparisonPanel comparison={performanceComparison} history={performanceHistory} leftRunId={performanceLeftRunId} loading={performanceComparisonLoading} onLeftRunChange={setPerformanceLeftRunId} onRightRunChange={setPerformanceRightRunId} rightRunId={performanceRightRunId} />
      </section>
      <div className="bench-note"><b>Core conformance</b> · canonical pack <code>core-v1</code> · Ollama local only · outputs are scored transiently; retained records keep digests, statuses, and measurements.</div>
      <div className="bench-grid">
        <EvidenceCard record={latest} />
        <Panel title="Recent runs" right={invalidCount ? <span className="bench-invalid">{invalidCount} invalid retained record{invalidCount === 1 ? '' : 's'} skipped</span> : null}>
          {loading ? <EmptyNote>Loading local Core conformance history…</EmptyNote> : history.length === 0 ? invalidCount > 0 ? <EmptyNote>No usable Core conformance runs yet. Invalid retained records were skipped.</EmptyNote> : <EmptyNote>No Core conformance runs yet.</EmptyNote> : <div className="bench-history-list">{history.map(record => <button type="button" className={record.runId === rightRunId ? 'bench-history-row active' : 'bench-history-row'} key={record.runId} onClick={() => setRightRunId(record.runId)}><span><b>{record.model.selected}</b><small>{formatTimestamp(record.endedAt)} · {statusLabel(record)}</small></span><strong>{checkSummary(record)}</strong></button>)}</div>}
        </Panel>
      </div>
      <ComparisonPanel comparison={comparison} comparisonLoading={comparisonLoading} history={history} leftRunId={leftRunId} onLeftRunChange={setLeftRunId} onRightRunChange={setRightRunId} rightRunId={rightRunId} />
    </main>
  )
}
