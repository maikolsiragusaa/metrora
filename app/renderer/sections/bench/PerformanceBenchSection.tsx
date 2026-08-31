import { EmptyNote } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import type { PerformanceComparisonV1 } from '../../../../src/bench/performance-compare-v1'
import type { PerformanceRunV1 } from '../../../../src/bench/performance-contract-v1'
import type { ComponentStatus } from '../../lib/metrora-bridge-types'

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

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString()
}

function formatDuration(startedAt: string, endedAt: string): string {
  const duration = Date.parse(endedAt) - Date.parse(startedAt)
  if (!Number.isFinite(duration) || duration < 0) return 'Not available'
  return duration < 1_000 ? duration + ' ms' : formatNumber(duration / 1_000) + ' s'
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
  return value === null || !Number.isFinite(value) ? 'Not available' : formatNumber(value) + ' ' + unit
}

function performanceWorkload(record: PerformanceRunV1, workload: 'prefill' | 'decode'): PerformanceRunV1['workloads'][number] | null {
  return record.workloads.find(item => item.workload === workload) ?? null
}

function performanceModelLabel(record: PerformanceRunV1): string {
  return record.model.type ? record.model.selected + ' · ' + record.model.type : record.model.selected
}

function observedConfigurationLabel(record: Pick<PerformanceRunV1, 'observedConfiguration'>): string {
  const observed = record.observedConfiguration
  if (!observed) return 'Not reported'
  const value = [
    observed.batchSize === null ? null : 'batch ' + observed.batchSize,
    observed.ubatchSize === null ? null : 'ubatch ' + observed.ubatchSize,
    observed.threads === null ? null : 'threads ' + observed.threads,
    observed.gpuLayers === null ? null : 'GPU layers ' + observed.gpuLayers,
    observed.splitMode === null ? null : 'split ' + observed.splitMode,
    observed.mainGpu === null ? null : 'main GPU ' + observed.mainGpu,
    observed.flashAttention === null ? null : 'Flash Attention ' + observed.flashAttention,
    observed.promptTokens === null ? null : 'prompt ' + observed.promptTokens,
    observed.generationTokens === null ? null : 'generation ' + observed.generationTokens,
    observed.repetitions === null ? null : 'repetitions ' + observed.repetitions,
    observed.depth === null ? null : 'depth ' + observed.depth,
  ].filter((item): item is string => item !== null)
  return value.length ? value.join(' · ') : 'Not reported'
}

export function managedComponentVariantLabel(variant: ComponentStatus['variant']): string {
  return variant === 'metal-capable' ? 'Metal-capable' : variant === 'cpu' ? 'CPU' : 'managed'
}

function PerformanceSetup({
  component,
  executablePath,
  modelPath,
  running,
  onCancelComponent,
  onChooseExecutable,
  onChooseModel,
  onInstallComponent,
  onRun,
  onCancel,
}: {
  component: ComponentStatus | null
  executablePath: string
  modelPath: string
  running: boolean
  onCancelComponent: () => void
  onChooseExecutable: () => void
  onChooseModel: () => void
  onInstallComponent: () => void
  onRun: () => void
  onCancel: () => void
}) {
  const componentBusy = component?.state === 'installing'
  const componentCanInstall = component?.state === 'not-installed' || component?.state === 'failed' || component?.state === 'cancelled'
  const variantLabel = managedComponentVariantLabel(component?.variant ?? null)
  const heading = component ? 'llama.cpp benchmark runtime · ' + variantLabel : 'llama.cpp benchmark runtime'
  const subtitle = component ? 'Official Metrora-managed ' + variantLabel + ' artifact' : 'Official Metrora-managed artifact'
  const progressLabel = 'llama-bench ' + variantLabel + ' installation progress'
  const installLabel = 'Install ' + variantLabel + ' component'
  return <div className="bench-performance-setup">
    <div className="bench-component-card" aria-label="Managed llama-bench component">
      <div className="bench-component-heading"><div><b>{heading}</b><small>{subtitle}</small></div><span className={'bench-component-status bench-component-status-' + (component?.state ?? 'checking')}>{component?.state === 'installed' ? 'Installed ✓' : component?.state === 'installing' ? 'Installing…' : component?.state === 'unsupported' ? 'Unavailable' : component?.state === 'failed' ? 'Install failed' : component?.state === 'cancelled' ? 'Cancelled' : component ? 'Not installed' : 'Checking…'}</span></div>
      {componentBusy ? <div className="bench-component-progress"><progress max={100} value={component.progress ?? undefined} aria-label={progressLabel} /><span>{component.detail}</span><button type="button" className="bench-secondary-button" onClick={onCancelComponent}>Cancel install</button></div> : component?.state === 'installed' ? <p className="bench-component-detail">{component.detail} Version <code>{component.version}</code>. This managed artifact is {variantLabel}; artifact capability does not prove the backend or offload used by a run. Retained Performance evidence remains authoritative for observed execution.</p> : component?.state === 'unsupported' ? <p className="bench-component-detail">{component.detail} The managed artifact is unavailable here; choose an existing executable below if one is already available.</p> : component?.state === 'failed' || component?.state === 'cancelled' ? <div className="bench-component-detail"><p>{component.error ?? component.detail}</p><button type="button" className="bench-secondary-button" onClick={onInstallComponent}>Retry install</button></div> : componentCanInstall ? <div className="bench-component-detail"><p>{component.detail} The managed artifact capability is {variantLabel}. Use the executable picker below for an existing build when another backend is required.</p><button type="button" className="bench-secondary-button" onClick={onInstallComponent}>{installLabel}</button></div> : <p className="bench-component-detail">{component?.detail ?? 'Checking the managed component…'}</p>}
    </div>
    <div className="bench-performance-file-row">
      <label>llama-bench executable<input aria-label="llama-bench executable" value={executablePath} readOnly placeholder="Install the managed component or choose an executable" /></label>
      <button type="button" className="bench-secondary-button" onClick={onChooseExecutable} disabled={running}>Choose executable</button>
    </div>
    <div className="bench-performance-file-row">
      <label>GGUF model<input aria-label="GGUF model" value={modelPath} readOnly placeholder="Choose an existing .gguf model" /></label>
      <button type="button" className="bench-secondary-button" onClick={onChooseModel} disabled={running}>Choose model</button>
    </div>
    <div className="bench-performance-setup-summary">
      <span>Bounded setup</span>
      <b>3 repetitions · prefill 512 tokens · decode 128 tokens · batch 2048 · ubatch 512 · GPU layers -1 · Flash Attention auto · split none</b>
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
        <span>Model size</span><b>{record.model.sizeBytes === null ? 'Not reported' : formatNumber(record.model.sizeBytes / (1024 * 1024 * 1024)) + ' GiB'}</b>
        <span>Parameters</span><b>{record.model.parameterCount === null ? 'Not reported' : record.model.parameterCount.toLocaleString()}</b>
        <span>Runtime build</span><b>{record.runtime.version ?? 'Not reported'}</b>
        <span>Backends</span><b>{record.runtime.backends.length ? record.runtime.backends.join(', ') : 'Not reported'}</b>
        <span>Hardware</span><b>{record.hardware.cpuInfo ?? 'Not reported'}{record.hardware.gpuInfo ? ' · ' + record.hardware.gpuInfo : ''}</b>
        <span>Setup</span><b>{setup.repetitions} reps · {setup.promptTokens} prompt · {setup.generationTokens} generation · batch {setup.batchSize} · ubatch {setup.ubatchSize} · split {setup.splitMode}</b>
        <span>Observed config</span><b>{observedConfigurationLabel(record)}</b>
        <span>Run ID</span><code className="bench-breakable">{record.runId}</code>
        <span>Result digest</span><code className="bench-breakable">{record.resultDigest}</code>
      </div>
    </details>
    <details>
      <summary>Measured workloads</summary>
      <p className="bench-evidence-note">Metrics are normalized from llama-bench JSON output. Missing upstream fields remain unavailable; this record has no quality score or universal ranking.</p>
      <div className="bench-performance-workloads">
        {record.workloads.map((workload, index) => <div className="bench-performance-workload" key={workload.workload + '-' + index}>
          <b>{workload.workload}</b>
          <span>Throughput <strong>{performanceMetric(workload.throughputTokensPerSecond, 'tokens/s')}</strong></span>
          <span>Average time <strong>{performanceMetric(workload.averageLatencyMs, 'ms')}</strong></span>
          <span>Test size <strong>{workload.promptTokens ?? '—'} prompt · {workload.generationTokens ?? '—'} generation</strong></span>
          <span>Depth <strong>{workload.depth ?? '—'}</strong></span>
          <span>Test time <strong>{workload.testTime ? formatTimestamp(workload.testTime) : 'Not reported'}</strong></span>
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
  if (reason === 'observed-config-mismatch') return 'observed native configuration differs'
  if (reason === 'hardware-mismatch') return 'runtime, hardware, or environment identity differs'
  if (reason === 'incomplete-run') return 'one run did not complete'
  if (reason === 'missing-metrics') return 'required metrics are unavailable'
  return 'compatible'
}

function comparisonIdentityLabel(identity: PerformanceComparisonV1['left']): string {
  const runtime = identity.runtime.version ?? identity.runtime.id
  const backend = identity.runtime.backends.length ? ' · ' + identity.runtime.backends.join('/') : ''
  return identity.model + (identity.modelType ? ' · ' + identity.modelType : '') + ' · ' + runtime + backend
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
    <details className="bench-comparison-details"><summary>Comparison evidence</summary><div className="bench-detail-grid">
      <span>Compatibility</span><b>{comparison.reason}</b>
      <span>Reference identity</span><b>{comparisonIdentityLabel(comparison.left)}</b>
      <span>Comparison identity</span><b>{comparisonIdentityLabel(comparison.right)}</b>
      <span>Environment</span><b>{comparison.left.environment.os} · {comparison.left.environment.arch} · {comparison.left.environment.node}</b>
      <span>Hardware</span><b>{comparison.left.hardware.cpuInfo ?? 'Not reported'}{comparison.left.hardware.gpuInfo ? ' · ' + comparison.left.hardware.gpuInfo : ''}{comparison.left.hardware.devices.length ? ' · ' + comparison.left.hardware.devices.join(', ') : ''}</b>
      <span>Declared setup</span><b>{comparison.left.setup.repetitions} reps · {comparison.left.setup.promptTokens} prompt · {comparison.left.setup.generationTokens} generation · batch {comparison.left.setup.batchSize} · ubatch {comparison.left.setup.ubatchSize} · split {comparison.left.setup.splitMode}</b>
      <span>Observed setup</span><b>{observedConfigurationLabel(comparison.left)}</b>
      <span>Reference run</span><code className="bench-breakable">{comparison.left.runId} · {formatTimestamp(comparison.left.endedAt)}</code>
      <span>Comparison run</span><code className="bench-breakable">{comparison.right.runId} · {formatTimestamp(comparison.right.endedAt)}</code>
    </div></details>
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
  const optionLabel = (record: PerformanceRunV1) => record.model.selected + ' · ' + formatTimestamp(record.endedAt)
  return <Panel title="Compare Performance runs" right={loading ? <span className="bench-status">Checking compatibility…</span> : comparison?.compatible ? <span className="bench-compatible">compatible</span> : null}>
    {history.length < 2 ? <EmptyNote>Two retained Performance records are needed for an evidence-aware comparison.</EmptyNote> : <>
      <div className="bench-select-row"><label>Reference<select aria-label="Performance reference run" value={leftRunId} onChange={event => onLeftRunChange(event.target.value)}><option value="">Select a run</option>{history.map(record => <option key={record.runId} value={record.runId}>{optionLabel(record)}</option>)}</select></label><span>vs</span><label>Comparison<select aria-label="Performance comparison run" value={rightRunId} onChange={event => onRightRunChange(event.target.value)}><option value="">Select a run</option>{history.map(record => <option key={record.runId} value={record.runId}>{optionLabel(record)}</option>)}</select></label></div>
      {!leftRunId || !rightRunId || leftRunId === rightRunId ? <p className="bench-footnote">Choose two different retained records. Setup and environment mismatches remain explicitly not comparable.</p> : loading ? <p className="bench-footnote" role="status">Checking compatible Performance evidence…</p> : comparison ? <PerformanceComparisonCard comparison={comparison} /> : <p className="bench-footnote">Performance comparison evidence is unavailable.</p>}
    </>}
  </Panel>
}

export function PerformanceBenchSection({
  history,
  invalidCount,
  loading,
  executablePath,
  modelPath,
  component,
  running,
  comparison,
  comparisonLoading,
  leftRunId,
  rightRunId,
  onChooseExecutable,
  onChooseModel,
  onInstallComponent,
  onCancelComponent,
  onRun,
  onCancel,
  onLeftRunChange,
  onRightRunChange,
}: {
  history: PerformanceRunV1[]
  invalidCount: number
  loading: boolean
  executablePath: string
  modelPath: string
  component: ComponentStatus | null
  running: boolean
  comparison: PerformanceComparisonV1 | null
  comparisonLoading: boolean
  leftRunId: string
  rightRunId: string
  onChooseExecutable: () => void
  onChooseModel: () => void
  onInstallComponent: () => void
  onCancelComponent: () => void
  onRun: () => void
  onCancel: () => void
  onLeftRunChange: (value: string) => void
  onRightRunChange: (value: string) => void
}) {
  const latest = history[0] ?? null
  return <section className="bench-performance-section" aria-labelledby="bench-performance-title">
    <div className="bench-surface-heading">
      <div><p className="bench-kicker">PRIMARY · NATIVE LLAMA.CPP</p><h2 id="bench-performance-title">Performance</h2><p>Run the bounded <code>llama-bench</code> adapter against a managed official component or an existing executable and GGUF model. Results retain upstream throughput, timing, setup, runtime, and hardware evidence without a universal score.</p></div>
      <span className="bench-surface-badge">{history.length ? history.length + ' retained' : 'No retained runs'}</span>
    </div>
    <PerformanceSetup component={component} executablePath={executablePath} modelPath={modelPath} running={running} onChooseExecutable={onChooseExecutable} onChooseModel={onChooseModel} onInstallComponent={onInstallComponent} onCancelComponent={onCancelComponent} onRun={onRun} onCancel={onCancel} />
    <div className="bench-grid">
      <PerformanceEvidenceCard record={latest} />
      <Panel title="Recent Performance runs" right={invalidCount ? <span className="bench-invalid">{invalidCount} invalid retained record{invalidCount === 1 ? '' : 's'} skipped</span> : null}>
        {loading ? <EmptyNote>Loading local Performance history…</EmptyNote> : history.length === 0 ? invalidCount > 0 ? <EmptyNote>No usable Performance runs yet. Invalid retained records were skipped.</EmptyNote> : <EmptyNote>No Performance runs yet.</EmptyNote> : <div className="bench-history-list">{history.map(record => {
          const decode = performanceWorkload(record, 'decode')
          return <button type="button" className={record.runId === rightRunId ? 'bench-history-row active' : 'bench-history-row'} key={record.runId} onClick={() => onRightRunChange(record.runId)}><span><b>{performanceModelLabel(record)}</b><small>{formatTimestamp(record.endedAt)} · {performanceStatusLabel(record)}</small></span><strong>{performanceMetric(decode?.throughputTokensPerSecond ?? null, 'tok/s')}</strong></button>
        })}</div>}
      </Panel>
    </div>
    <PerformanceComparisonPanel comparison={comparison} history={history} leftRunId={leftRunId} loading={comparisonLoading} onLeftRunChange={onLeftRunChange} onRightRunChange={onRightRunChange} rightRunId={rightRunId} />
  </section>
}
