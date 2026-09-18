import { useState } from 'react'

import { EmptyNote } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import type { BenchView } from './benchTypes'
import {
  basename,
  formatDuration,
  formatTimestamp,
  observedConfigurationLabel,
  performanceComparisonReason,
  performanceMetric,
  performanceModelLabel,
  performanceStatusLabel,
  performanceStatusTone,
  performanceWorkload,
  formatSignedMetric,
} from './performanceFormat'
import { usePerformanceBench } from './usePerformanceBench'

function Breadcrumb({ onBack }: { onBack: () => void }) {
  return (
    <nav className="bench-breadcrumb" aria-label="Bench location">
      <button type="button" className="bench-breadcrumb-link" onClick={onBack}>
        Bench
      </button>
      <span aria-hidden="true"> / </span>
      <span aria-current="page">Performance</span>
    </nav>
  )
}

export function BenchPerformance({
  onNavigate,
  onOpenAdvanced,
}: {
  onNavigate: (view: BenchView) => void
  onOpenAdvanced: () => void
}) {
  const controller = usePerformanceBench()
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false)
  const [showAllRuns, setShowAllRuns] = useState(false)
  const latest = controller.history[0] ?? null
  const prefill = latest ? performanceWorkload(latest, 'prefill') : null
  const decode = latest ? performanceWorkload(latest, 'decode') : null

  const observedHardware = latest
    ? [latest.hardware.cpuInfo, latest.hardware.gpuInfo].filter(Boolean).join(' · ') || null
    : null

  const visibleRuns = showAllRuns ? controller.history : controller.history.slice(0, 5)

  return (
    <div className="bench-detail">
      <Breadcrumb onBack={() => onNavigate('overview')} />
      <div className="bench-page-head">
        <div className="bench-title-row">
          <h1 className="bench-title">Performance</h1>
          <span className="bench-status-pill bench-status-pill-available">
            <span className="bench-status-dot" aria-hidden="true" />
            Available
          </span>
        </div>
        <p className="bench-subcopy">Measure how a model and runtime actually perform on this machine.</p>
      </div>

      {controller.error ? (
        <p className="bench-alert" role="alert">
          {controller.error}
        </p>
      ) : null}

      <div className="bench-setup-grid">
        <section className="bench-setup-card" aria-labelledby="bench-perf-model">
          <div className="bench-setup-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            </span>
            <div>
              <h2 id="bench-perf-model">Model</h2>
              <p>GGUF model to benchmark.</p>
            </div>
          </div>
          <div className="bench-setup-value" aria-live="polite">
            {controller.modelPath ? (
              <>
                <strong>{basename(controller.modelPath)}</strong>
                <small>{controller.modelPath}</small>
              </>
            ) : (
              <small>No model selected yet.</small>
            )}
          </div>
          <button
            type="button"
            className="bench-ghost-button bench-block-button"
            onClick={() => controller.chooseFile('gguf')}
            disabled={controller.running}
          >
            Choose model <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="bench-setup-card" aria-labelledby="bench-perf-runtime">
          <div className="bench-setup-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="m8.5 6-5 6 5 6" />
                <path d="m15.5 6 5 6-5 6" />
              </svg>
            </span>
            <div>
              <h2 id="bench-perf-runtime">Benchmark runtime</h2>
              <p>Executable to run benchmarks.</p>
            </div>
          </div>
          <div className="bench-setup-value" aria-live="polite">
            <strong>llama-bench (llama.cpp)</strong>
            <small>
              {controller.executablePath ? controller.executablePath : 'Native · no executable selected yet.'}
            </small>
          </div>
          <button
            type="button"
            className="bench-ghost-button bench-block-button"
            onClick={() => controller.chooseFile('llama-bench')}
            disabled={controller.running}
          >
            Choose runtime <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="bench-setup-card" aria-labelledby="bench-perf-workload">
          <div className="bench-setup-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="4" y="4" width="16" height="4" rx="1" />
                <rect x="4" y="10" width="16" height="4" rx="1" />
                <rect x="4" y="16" width="16" height="4" rx="1" />
              </svg>
            </span>
            <div>
              <h2 id="bench-perf-workload">Workload</h2>
              <p>Standard bounded benchmark.</p>
            </div>
          </div>
          <div className="bench-setup-value">
            <strong>512 prompt · 128 generation</strong>
            <small>3 repetitions · batch 2048</small>
          </div>
          <p className="bench-setup-note">Fixed bounded workload. No selectable presets in this build.</p>
        </section>

        <section className="bench-setup-card" aria-labelledby="bench-perf-hardware">
          <div className="bench-setup-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
                <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
              </svg>
            </span>
            <div>
              <h2 id="bench-perf-hardware">Hardware</h2>
              <p>Observed hardware.</p>
            </div>
          </div>
          <div className="bench-setup-value" aria-live="polite">
            {observedHardware ? (
              <small>From latest retained run: {observedHardware}</small>
            ) : (
              <small>No retained hardware evidence yet. Run Performance to record observed hardware.</small>
            )}
          </div>
        </section>
      </div>

      <div className="bench-advanced-config">
        <button
          type="button"
          className="bench-advanced-config-toggle"
          aria-expanded={showAdvancedConfig}
          onClick={() => setShowAdvancedConfig(value => !value)}
        >
          <span className="bench-family-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </span>
          <span>
            <strong>Advanced configuration</strong>
            <small>Configure repetitions, token counts, batch size, GPU layers, Flash Attention, and other runtime arguments.</small>
          </span>
          <span className="bench-optional-pill">Optional</span>
          <span aria-hidden="true">{showAdvancedConfig ? '▴' : '▾'}</span>
        </button>
        {showAdvancedConfig ? (
          <div className="bench-advanced-config-body">
            <p className="bench-footnote">
              Read-only in this build. The backend accepts only the fixed bounded setup below.
            </p>
            <dl className="bench-detail-grid">
              <dt>Repetitions</dt>
              <dd>3</dd>
              <dt>Prompt tokens</dt>
              <dd>512</dd>
              <dt>Generation tokens</dt>
              <dd>128</dd>
              <dt>Batch size</dt>
              <dd>2048</dd>
              <dt>Ubatch size</dt>
              <dd>512</dd>
              <dt>Threads</dt>
              <dd>Not set (backend default)</dd>
              <dt>GPU layers</dt>
              <dd>-1</dd>
              <dt>Flash Attention</dt>
              <dd>auto</dd>
              <dt>Split mode</dt>
              <dd>none</dd>
            </dl>
          </div>
        ) : null}
      </div>

      <div className="bench-run-row">
        <button
          type="button"
          className="bench-primary-button"
          onClick={() => controller.run()}
          disabled={controller.running || !controller.executablePath || !controller.modelPath}
        >
          {controller.running ? 'Running llama-bench…' : 'Run benchmark →'}
        </button>
        {controller.running ? (
          <button type="button" className="bench-ghost-button" onClick={() => controller.cancel()}>
            Cancel
          </button>
        ) : null}
        <span className="bench-run-hint">This will run llama-bench with the selected model and settings.</span>
      </div>
      {controller.running ? (
        <p className="bench-performance-progress" role="status" aria-live="polite">
          Native llama-bench is running with a bounded ten-minute timeout. Cancel remains available.
        </p>
      ) : null}

      <div className="bench-results-grid">
        <Panel
          title="Latest result"
          right={
            latest ? (
              <span className={'bench-status bench-status-' + performanceStatusTone(latest)}>
                {performanceStatusLabel(latest)}
              </span>
            ) : undefined
          }
        >
          {!latest ? (
            <EmptyNote>
              {controller.loading
                ? 'Loading local Performance history…'
                : 'Choose a llama-bench executable and GGUF model to create a retained Performance record.'}
            </EmptyNote>
          ) : (
            <>
              <p className="bench-panel-sub">Performance metrics, from the most recent run on this machine.</p>
              <p className="bench-run-date">{formatTimestamp(latest.endedAt)}</p>
              <div className="bench-kpis bench-kpis-4">
                <div>
                  <span>Prefill throughput</span>
                  <strong>{performanceMetric(prefill?.throughputTokensPerSecond ?? null, 'tok/s')}</strong>
                  <small>Higher is better</small>
                </div>
                <div>
                  <span>Generation throughput</span>
                  <strong>{performanceMetric(decode?.throughputTokensPerSecond ?? null, 'tok/s')}</strong>
                  <small>Higher is better</small>
                </div>
                <div>
                  <span>Prefill average time</span>
                  <strong>{performanceMetric(prefill?.averageLatencyMs ?? null, 'ms')}</strong>
                  <small>Lower is better</small>
                </div>
                <div>
                  <span>Run duration</span>
                  <strong>{formatDuration(latest.startedAt, latest.endedAt)}</strong>
                  <small>Total time</small>
                </div>
              </div>
              <div className="bench-primary-grid">
                <span>Model</span>
                <b>{performanceModelLabel(latest)}</b>
                <span>Runtime</span>
                <b>
                  {latest.runtime.id} · {latest.runtime.version ?? 'build not reported'}
                </b>
                <span>Workload</span>
                <b>
                  {latest.methodology.setup.promptTokens} prompt · {latest.methodology.setup.generationTokens}{' '}
                  generation · {latest.methodology.setup.repetitions} repetitions · batch{' '}
                  {latest.methodology.setup.batchSize}
                </b>
              </div>
              <div className="bench-disclosures">
                <details>
                  <summary>Details</summary>
                  <div className="bench-detail-grid">
                    <span>Methodology</span>
                    <b>
                      {latest.methodology.id}@{latest.methodology.version}
                    </b>
                    <span>Runner</span>
                    <b>
                      {latest.runner.id}@{latest.runner.version}
                    </b>
                    <span>Executable</span>
                    <b>{latest.executable.name}</b>
                    <span>Observed config</span>
                    <b>{observedConfigurationLabel(latest)}</b>
                    <span>Hardware</span>
                    <b>
                      {latest.hardware.cpuInfo ?? 'Not reported'}
                      {latest.hardware.gpuInfo ? ' · ' + latest.hardware.gpuInfo : ''}
                    </b>
                    <span>Environment</span>
                    <b>
                      {latest.environment.os} · {latest.environment.arch} · {latest.environment.node}
                    </b>
                    <span>Result digest</span>
                    <code className="bench-breakable">{latest.resultDigest}</code>
                  </div>
                </details>
                <details>
                  <summary>Measured workloads</summary>
                  <p className="bench-evidence-note">
                    Metrics are normalized from llama-bench JSON output. Missing upstream fields remain
                    unavailable; this record has no quality score or universal ranking.
                  </p>
                  <div className="bench-performance-workloads">
                    {latest.workloads.map((workload, index) => (
                      <div className="bench-performance-workload" key={workload.workload + '-' + index}>
                        <b>{workload.workload}</b>
                        <span>
                          Throughput{' '}
                          <strong>{performanceMetric(workload.throughputTokensPerSecond, 'tokens/s')}</strong>
                        </span>
                        <span>
                          Average time{' '}
                          <strong>{performanceMetric(workload.averageLatencyMs, 'ms')}</strong>
                        </span>
                        <span>
                          Test size{' '}
                          <strong>
                            {workload.promptTokens ?? '—'} prompt · {workload.generationTokens ?? '—'}{' '}
                            generation
                          </strong>
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </>
          )}
        </Panel>

        <div className="bench-side-stack">
          <Panel title="Recent runs" right={controller.invalidCount ? `${controller.invalidCount} invalid skipped` : undefined}>
            {controller.loading ? (
              <EmptyNote>Loading local Performance history…</EmptyNote>
            ) : controller.history.length === 0 ? (
              <EmptyNote>No Performance runs yet.</EmptyNote>
            ) : (
              <>
                <div className="bench-history-list" aria-label="Recent Performance runs">
                  {visibleRuns.map(record => {
                    const rowPrefill = performanceWorkload(record, 'prefill')
                    const rowDecode = performanceWorkload(record, 'decode')
                    return (
                      <button
                        type="button"
                        key={record.runId}
                        className="bench-history-row"
                        onClick={() => controller.setRightRunId(record.runId)}
                      >
                        <span>
                          <b>{performanceModelLabel(record)}</b>
                          <small>
                            {formatTimestamp(record.endedAt)} · {performanceStatusLabel(record)}
                          </small>
                        </span>
                        <strong>
                          {performanceMetric(rowPrefill?.throughputTokensPerSecond ?? null, '')} /{' '}
                          {performanceMetric(rowDecode?.throughputTokensPerSecond ?? null, 'tok/s')}
                        </strong>
                      </button>
                    )
                  })}
                </div>
                {controller.history.length > 5 ? (
                  <button
                    type="button"
                    className="bench-inline-link"
                    onClick={() => setShowAllRuns(value => !value)}
                  >
                    {showAllRuns ? 'Show fewer runs' : 'View all →'}
                  </button>
                ) : null}
              </>
            )}
          </Panel>

          <Panel title="Evidence & comparison">
            <p className="bench-panel-sub">Results are retained as structured evidence for reliable comparison.</p>
            {controller.history.length < 2 ? (
              <EmptyNote>Two retained Performance records are needed for an evidence-aware comparison.</EmptyNote>
            ) : (
              <>
                <div className="bench-select-row">
                  <label>
                    Reference
                    <select
                      aria-label="Performance reference run"
                      value={controller.leftRunId}
                      onChange={event => controller.setLeftRunId(event.target.value)}
                    >
                      <option value="">Select a run</option>
                      {controller.history.map(record => (
                        <option key={record.runId} value={record.runId}>
                          {performanceModelLabel(record)} · {formatTimestamp(record.endedAt)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>vs</span>
                  <label>
                    Comparison
                    <select
                      aria-label="Performance comparison run"
                      value={controller.rightRunId}
                      onChange={event => controller.setRightRunId(event.target.value)}
                    >
                      <option value="">Select a run</option>
                      {controller.history.map(record => (
                        <option key={record.runId} value={record.runId}>
                          {performanceModelLabel(record)} · {formatTimestamp(record.endedAt)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!controller.leftRunId ||
                !controller.rightRunId ||
                controller.leftRunId === controller.rightRunId ? (
                  <p className="bench-footnote">
                    Choose two different retained records. Setup and environment mismatches remain explicitly
                    not comparable.
                  </p>
                ) : controller.comparisonLoading ? (
                  <p className="bench-footnote" role="status">
                    Checking compatible Performance evidence…
                  </p>
                ) : controller.comparison ? (
                  controller.comparison.compatible ? (
                    <div className="bench-comparison-result">
                      <div className="bench-compare-grid">
                        <span>Prefill throughput delta</span>
                        <b>
                          {formatSignedMetric(
                            controller.comparison.deltas?.prefillThroughputTokensPerSecond ?? null,
                            'tokens/s',
                          )}
                        </b>
                        <span>Decode throughput delta</span>
                        <b>
                          {formatSignedMetric(
                            controller.comparison.deltas?.decodeThroughputTokensPerSecond ?? null,
                            'tokens/s',
                          )}
                        </b>
                        <span>Prefill time delta</span>
                        <b>
                          {formatSignedMetric(controller.comparison.deltas?.prefillLatencyMs ?? null, 'ms')}
                        </b>
                        <span>Decode time delta</span>
                        <b>
                          {formatSignedMetric(controller.comparison.deltas?.decodeLatencyMs ?? null, 'ms')}
                        </b>
                      </div>
                      <p className="bench-footnote">
                        Deltas are Comparison minus Reference. They are conditional on the retained setup and
                        environment, not a universal model-quality score.
                      </p>
                    </div>
                  ) : (
                    <div className="bench-compare-state" role="alert">
                      <strong>Not comparable</strong>
                      <p>
                        These Performance records do not share an evidence-compatible methodology, runtime,
                        hardware, or usable metric set.
                      </p>
                      <small>Reason: {performanceComparisonReason(controller.comparison.reason)}</small>
                    </div>
                  )
                ) : (
                  <p className="bench-footnote">Performance comparison evidence is unavailable.</p>
                )}
              </>
            )}
            <button type="button" className="bench-inline-link" onClick={onOpenAdvanced}>
              Compare runs in Advanced Bench →
            </button>
          </Panel>
        </div>
      </div>

      <button type="button" className="bench-inline-link" onClick={() => onNavigate('overview')}>
        ← Back to Bench Preview
      </button>
    </div>
  )
}
