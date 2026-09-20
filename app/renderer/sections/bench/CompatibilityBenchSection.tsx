import { EmptyNote } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import type { BenchComparison, BenchEvaluation, BenchModelDiscovery, BenchTaskResult } from '../../lib/metrora-bridge-types'
import { formatDuration, formatMetric, formatSignedMetric, formatTimestamp } from './performanceFormat'
import { useCompatibilityBench } from './useCompatibilityBench'

function formatPercent(value: number | null): string {
  return value === null ? 'Not available' : (value * 100).toFixed(0) + '%'
}

function formatSignedPoints(value: number | null): string {
  return value === null ? 'Not available' : (value > 0 ? '+' : '') + (value * 100).toFixed(0) + ' pts'
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
  return scored === 0
    ? `No checks scored · ${record.aggregate.planned} planned`
    : `${record.aggregate.passed} / ${record.aggregate.planned}`
}

function stateMessage(record: BenchEvaluation): string {
  if (record.status === 'completed')
    return `${record.aggregate.attempted} of ${record.aggregate.planned} planned checks completed. Failed checks are scoring results, not missing data.`
  if (record.status === 'cancelled')
    return `Run cancelled after ${record.aggregate.attempted} of ${record.aggregate.planned} planned checks. Unstarted checks are not counted as failures.`
  if (record.aggregate.attempted === 0)
    return 'The local runtime was unavailable before any check ran. No score was calculated.'
  if (record.aggregate.unavailable > 0)
    return `The local runtime became unavailable during the run after ${record.aggregate.attempted} of ${record.aggregate.planned} planned checks. Unstarted checks are not counted as failures.`
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
  const selectedDiscoveredModel = models.includes(model) ? model : (models[0] ?? '')
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
        {models.length > 0 && !manualMode ? (
          <select
            id="bench-model"
            value={selectedDiscoveredModel}
            onChange={event => {
              if (event.target.value === '__manual__') {
                onManualEntryChange(true)
                onModelChange('')
              } else onModelChange(event.target.value)
            }}
          >
            <option value="">Choose a discovered model</option>
            {models.map(item => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            <option value="__manual__">Enter another Ollama model…</option>
          </select>
        ) : (
          <input
            id="bench-model"
            value={model}
            onChange={event => onModelChange(event.target.value)}
            placeholder="e.g. qwen3:8b"
          />
        )}
        <button type="button" className="bench-secondary-button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Checking…' : 'Refresh models'}
        </button>
      </div>
      {manualMode && models.length > 0 ? (
        <button
          type="button"
          className="bench-inline-link"
          onClick={() => {
            onManualEntryChange(false)
            onModelChange(models[0] ?? '')
          }}
        >
          Use a discovered model
        </button>
      ) : null}
      <p
        className={'bench-model-discovery bench-model-discovery-' + (loading ? 'checking' : (discovery?.status ?? 'unavailable'))}
        role="status"
        aria-live="polite"
      >
        {discoveryMessage}
      </p>
    </div>
  )
}

function RecordDetails({ record }: { record: BenchEvaluation }) {
  const environment = record.environment
  const generation = record.generation
  return (
    <div className="bench-disclosures">
      <details>
        <summary>Details</summary>
        <div className="bench-detail-grid">
          <span>Pack identity</span>
          <b>
            Core conformance · {record.pack.packId}@{record.pack.version}
          </b>
          <span>Pack digest</span>
          <code className="bench-breakable">{record.pack.digest}</code>
          <span>Result digest</span>
          <code className="bench-breakable">{record.resultDigest}</code>
          <span>Runner</span>
          <b>
            {record.runner.id}@{record.runner.version}
          </b>
          <span>Runtime endpoint</span>
          <code>{record.runtime.endpoint}</code>
          <span>Reported model</span>
          <b>{record.model.reported ?? 'Not reported'}</b>
          <span>Run ID</span>
          <code className="bench-breakable">{record.runId}</code>
          <span>Raw status</span>
          <b>{record.status}</b>
          <span>Aggregate</span>
          <b>
            {record.aggregate.passed} passed · {record.aggregate.failed} failed ·{' '}
            {record.aggregate.unavailable} unavailable · {record.aggregate.cancelled} cancelled
          </b>
          <span>Scored checks</span>
          <b>
            {record.aggregate.score.denominator
              ? `${record.aggregate.score.numerator} / ${record.aggregate.score.denominator}`
              : 'None'}
          </b>
          <span>Environment</span>
          <b>
            {environment ? `${environment.os} · ${environment.arch} · ${environment.node}` : 'Not retained'}
          </b>
          <span>Generation</span>
          <b>
            {generation
              ? Object.entries(generation.parameters)
                  .map(([key, value]) => `${key} ${value}`)
                  .join(' · ')
              : 'Not retained'}
          </b>
        </div>
      </details>
      <details>
        <summary>Evidence</summary>
        <p className="bench-evidence-note">
          Each check retains its status, score, output digest, output size, timing, and bounded
          runtime-reported metrics. Response bodies and prompts are not retained.
        </p>
        <div className="bench-task-list" aria-label="Bench task evidence">
          {record.tasks.map(task => (
            <div className="bench-task-row" key={task.taskId}>
              <span>
                <b>{task.taskId}</b>
                <small>
                  {taskStatusLabel(task)}
                  {task.failure ? ' · ' + task.failure.code : ''}
                </small>
              </span>
              <span className="bench-task-evidence">
                {task.outputChars === null
                  ? 'Output unavailable'
                  : `${task.outputChars} chars · ${task.outputDigest ? 'digest ' + task.outputDigest.slice(0, 12) + '…' : 'digest unavailable'}`}
                <small>
                  {formatMetric(task.requestLatencyMs, 'ms')} request ·{' '}
                  {formatMetric(task.timeToFirstContentMs, 'ms')} first content
                </small>
                <small>{runtimeMetricsLabel(task)}</small>
              </span>
              <b className={'bench-task-' + task.status}>
                {task.score === null ? 'Not scored' : task.score === 1 ? 'score 1' : 'score 0'}
              </b>
            </div>
          ))}
        </div>
        <details className="bench-raw-disclosure">
          <summary>Raw task results</summary>
          <pre aria-label="Raw task results">{JSON.stringify(record.tasks, null, 2)}</pre>
        </details>
      </details>
    </div>
  )
}

function EvidenceCard({ record }: { record: BenchEvaluation | null }) {
  if (!record)
    return (
      <Panel title="Latest core conformance">
        <EmptyNote>Run Core conformance to create a retained evidence record.</EmptyNote>
      </Panel>
    )
  const medianRequestLatency = median(record.tasks.map(task => task.requestLatencyMs))
  const medianFirstContent = median(record.tasks.map(task => task.timeToFirstContentMs))
  return (
    <Panel
      title="Latest core conformance"
      right={<span className={'bench-status bench-status-' + statusTone(record)}>{statusLabel(record)}</span>}
    >
      <div className="bench-kpis">
        <div>
          <strong>{checkSummary(record)}</strong>
          <span>checks passed / planned</span>
        </div>
        <div>
          <strong>{formatPercent(record.aggregate.score.value)}</strong>
          <span>pass rate of scored checks</span>
        </div>
        <div>
          <strong>{formatMetric(medianRequestLatency, 'ms')}</strong>
          <span>median request time</span>
        </div>
        <div>
          <strong>{formatDuration(record.startedAt, record.endedAt)}</strong>
          <span>run duration</span>
        </div>
      </div>
      <p className={'bench-state-note bench-state-' + statusTone(record)}>{stateMessage(record)}</p>
      <div className="bench-primary-grid">
        <span>Model</span>
        <b>{record.model.selected}</b>
        <span>Runtime</span>
        <b>{runtimeLabel(record)}</b>
        <span>First content</span>
        <b>{formatMetric(medianFirstContent, 'ms')}</b>
        <span>Run date</span>
        <b>{formatTimestamp(record.endedAt)}</b>
      </div>
      <RecordDetails record={record} />
    </Panel>
  )
}

function ComparisonCard({ comparison }: { comparison: BenchComparison }) {
  if (!comparison.compatible)
    return (
      <div className="bench-compare-state" role="alert">
        <strong>Not comparable</strong>
        <p>These retained records use incompatible conformance evidence and no deltas were calculated.</p>
        <small>Reason: {comparisonReasonLabel(comparison.reason)}</small>
      </div>
    )
  const deltas = comparison.deltas
  if (!deltas)
    return (
      <div className="bench-compare-state" role="alert">
        <strong>Comparison unavailable</strong>
        <p>No compatible delta evidence was retained for these records.</p>
      </div>
    )
  return (
    <div className="bench-comparison-result">
      <div className="bench-comparison-head">
        <span>
          <b>{comparison.left.model}</b>
          <small>Reference</small>
        </span>
        <span>→</span>
        <span>
          <b>{comparison.right.model}</b>
          <small>Comparison</small>
        </span>
      </div>
      <div className="bench-compare-grid">
        <span>Pass-rate delta</span>
        <b>{formatSignedPoints(deltas.score)}</b>
        <span>Passed checks delta</span>
        <b>{formatSignedMetric(deltas.passed, 'checks')}</b>
        <span>Request latency delta</span>
        <b>{formatSignedMetric(deltas.medianRequestLatencyMs, 'ms')}</b>
        <span>First content delta</span>
        <b>{formatSignedMetric(deltas.medianFirstContentMs, 'ms')}</b>
      </div>
      <details className="bench-comparison-details">
        <summary>Comparison evidence</summary>
        <div className="bench-detail-grid">
          <span>Compatibility</span>
          <b>{comparison.reason}</b>
          <span>Failed checks delta</span>
          <b>{formatSignedMetric(deltas.failed, 'checks')}</b>
          <span>Unavailable delta</span>
          <b>{formatSignedMetric(deltas.unavailable, 'checks')}</b>
          <span>Cancelled delta</span>
          <b>{formatSignedMetric(deltas.cancelled, 'checks')}</b>
          <span>Reference run</span>
          <code className="bench-breakable">
            {comparison.left.runId} · {formatTimestamp(comparison.left.endedAt)}
          </code>
          <span>Comparison run</span>
          <code className="bench-breakable">
            {comparison.right.runId} · {formatTimestamp(comparison.right.endedAt)}
          </code>
        </div>
      </details>
      <p className="bench-footnote">
        Only compatible Core conformance records are compared. These are factual check and timing deltas, not a
        general coding-quality measurement.
      </p>
    </div>
  )
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
  return (
    <Panel
      title="Compare runs"
      right={
        comparisonLoading ? (
          <span className="bench-status">Checking compatibility…</span>
        ) : comparison?.compatible ? (
          <span className="bench-compatible">compatible</span>
        ) : null
      }
    >
      {history.length < 2 ? (
        <EmptyNote>Two retained Core conformance records are needed for a factual comparison.</EmptyNote>
      ) : (
        <>
          <div className="bench-select-row">
            <label>
              Reference
              <select
                aria-label="Bench reference run"
                value={leftRunId}
                onChange={event => onLeftRunChange(event.target.value)}
              >
                <option value="">Select a run</option>
                {history.map(record => (
                  <option key={record.runId} value={record.runId}>
                    {optionLabel(record)}
                  </option>
                ))}
              </select>
            </label>
            <span>vs</span>
            <label>
              Comparison
              <select
                aria-label="Bench comparison run"
                value={rightRunId}
                onChange={event => onRightRunChange(event.target.value)}
              >
                <option value="">Select a run</option>
                {history.map(record => (
                  <option key={record.runId} value={record.runId}>
                    {optionLabel(record)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!selectedLeft || !selectedRight || leftRunId === rightRunId ? (
            <p className="bench-footnote">
              Choose two different retained records. Incompatible pack, runner, scoring, or generation identities
              stay explicitly unavailable.
            </p>
          ) : comparisonLoading ? (
            <p className="bench-footnote" role="status">
              Checking compatible evidence…
            </p>
          ) : comparison ? (
            <ComparisonCard comparison={comparison} />
          ) : (
            <p className="bench-footnote">Comparison evidence is unavailable.</p>
          )}
        </>
      )}
    </Panel>
  )
}

export function CompatibilityBenchSection() {
  const controller = useCompatibilityBench()
  const latest = controller.history[0] ?? null

  return (
    <section className="bench-compat-section" aria-labelledby="bench-compat-title">
      <div className="bench-surface-heading">
        <div>
          <p className="bench-kicker">BOUNDED · OLLAMA LOCAL</p>
          <h2 id="bench-compat-title">Compatibility / Runtime Health</h2>
          <p>
            Run the bounded <code>core-v1</code> conformance check against a local Ollama model. Results retain
            check statuses, timing, and runtime evidence without a universal quality score.
          </p>
        </div>
      </div>
      {controller.error ? (
        <p className="bench-alert" role="alert">
          {controller.error}
        </p>
      ) : null}
      <div className="bench-compat-controls">
        <ModelPicker
          discovery={controller.discovery}
          discoveryFailed={controller.discoveryFailed}
          loading={controller.discoveryLoading}
          manualEntry={controller.manualEntry}
          model={controller.model}
          onManualEntryChange={controller.setManualEntry}
          onModelChange={controller.setModel}
          onRefresh={controller.refreshDiscovery}
        />
        <button
          type="button"
          className="btn btn-p"
          onClick={controller.run}
          disabled={controller.running || !controller.model.trim()}
        >
          {controller.running ? 'Running…' : 'Run Core conformance'}
        </button>
      </div>
      <div className="bench-note">
        <b>Compatibility / Runtime Health</b> · canonical pack <code>core-v1</code> · Ollama local only ·
        outputs are scored transiently; retained records keep digests, statuses, and measurements.
      </div>
      <div className="bench-grid">
        <EvidenceCard record={latest} />
        <Panel
          title="Recent runs"
          right={
            controller.invalidCount ? (
              <span className="bench-invalid">
                {controller.invalidCount} invalid retained record{controller.invalidCount === 1 ? '' : 's'}{' '}
                skipped
              </span>
            ) : null
          }
        >
          {controller.loading ? (
            <EmptyNote>Loading local Core conformance history…</EmptyNote>
          ) : controller.history.length === 0 ? (
            controller.invalidCount > 0 ? (
              <EmptyNote>No usable Core conformance runs yet. Invalid retained records were skipped.</EmptyNote>
            ) : (
              <EmptyNote>No Core conformance runs yet.</EmptyNote>
            )
          ) : (
            <div className="bench-history-list">
              {controller.history.map(record => (
                <button
                  type="button"
                  className={record.runId === controller.rightRunId ? 'bench-history-row active' : 'bench-history-row'}
                  key={record.runId}
                  onClick={() => controller.setRightRunId(record.runId)}
                >
                  <span>
                    <b>{record.model.selected}</b>
                    <small>
                      {formatTimestamp(record.endedAt)} · {statusLabel(record)}
                    </small>
                  </span>
                  <strong>{checkSummary(record)}</strong>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <ComparisonPanel
        comparison={controller.comparison}
        comparisonLoading={controller.comparisonLoading}
        history={controller.history}
        leftRunId={controller.leftRunId}
        onLeftRunChange={controller.setLeftRunId}
        onRightRunChange={controller.setRightRunId}
        rightRunId={controller.rightRunId}
      />
    </section>
  )
}
