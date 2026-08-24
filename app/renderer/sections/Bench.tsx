import { useCallback, useEffect, useMemo, useState } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { metrora, normalizeCliError } from '../lib/ipc'
import type { BenchComparison, BenchEvaluation } from '../lib/metrora-bridge-types'

function formatMetric(value: number | null, unit: string): string {
  return value === null ? 'Not available' : value.toFixed(value >= 100 ? 0 : 1) + ' ' + unit
}
function formatPercent(value: number | null): string { return value === null ? 'Not available' : (value * 100).toFixed(0) + '%' }
function signed(value: number): string { return (value > 0 ? '+' : '') + value.toFixed(0) }

function EvidenceCard({ record }: { record: BenchEvaluation | null }) {
  if (!record) return <Panel title="Latest task-pack evidence"><EmptyNote>Run the bounded local task pack to create an evidence record.</EmptyNote></Panel>
  return (
    <Panel title="Latest task-pack evidence" right={<span className={'bench-status bench-status-' + record.status}>{record.status}</span>}>
      <div className="bench-kpis">
        <div><strong>{record.aggregate.passed}/{record.aggregate.planned}</strong><span>tasks passed</span></div>
        <div><strong>{formatPercent(record.aggregate.score.value)}</strong><span>task pass rate</span></div>
        <div><strong>{record.aggregate.attempted}</strong><span>requests attempted</span></div>
      </div>
      <div className="bench-detail-grid">
        <span>Model</span><b>{record.model.selected}</b>
        <span>Runtime</span><b>{record.runtime.id} · {record.runtime.version ?? 'version not reported'}</b>
        <span>Pack</span><b>{record.pack.packId}@{record.pack.version}</b>
        <span>Digest</span><code>{record.resultDigest.slice(0, 16)}…</code>
      </div>
      <div className="bench-task-list" aria-label="Bench task results">
        {record.tasks.map(task => <div className="bench-task-row" key={task.taskId}><span>{task.taskId}</span><b className={'bench-task-' + task.status}>{task.status === 'passed' ? 'passed' : task.status}</b><small>{task.outputChars === null ? 'no output evidence' : task.outputChars + ' chars'}</small></div>)}
      </div>
      <p className="bench-footnote">Deterministic task-pack evidence only. It is not a general model-quality claim, ranking, cost estimate, or usage report.</p>
    </Panel>
  )
}

function ComparisonCard({ comparison }: { comparison: BenchComparison | null }) {
  if (!comparison) return <Panel title="Compare runs"><EmptyNote>Select two compatible records to compare factual task and timing deltas.</EmptyNote></Panel>
  if (!comparison.compatible) return <Panel title="Compare runs"><p className="bench-alert" role="alert">These records cannot be compared: {comparison.reason}.</p></Panel>
  const deltas = comparison.deltas!
  return (
    <Panel title="Compare runs" right={<span className="bench-compatible">compatible</span>}>
      <div className="bench-compare-grid">
        <span>Task pass-rate delta</span><b>{deltas.score === null ? 'Not available' : signed(deltas.score * 100) + ' pts'}</b>
        <span>Passed tasks delta</span><b>{signed(deltas.passed)}</b>
        <span>Request latency delta</span><b>{formatMetric(deltas.medianRequestLatencyMs, 'ms')}</b>
        <span>First content delta</span><b>{formatMetric(deltas.medianFirstContentMs, 'ms')}</b>
      </div>
      <p className="bench-footnote">Deltas are between the selected local records; no winner or leaderboard is inferred.</p>
    </Panel>
  )
}

export function Bench() {
  const [history, setHistory] = useState<BenchEvaluation[]>([])
  const [invalidCount, setInvalidCount] = useState(0)
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leftRunId, setLeftRunId] = useState('')
  const [rightRunId, setRightRunId] = useState('')
  const [comparison, setComparison] = useState<BenchComparison | null>(null)

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

  useEffect(() => { void loadHistory() }, [loadHistory])

  const latest = history[0] ?? null
  const run = async () => {
    const selectedModel = model.trim()
    if (!selectedModel) { setError('Enter a local Ollama model name first.'); return }
    setRunning(true); setError(null)
    try {
      const record = await metrora.runBenchTaskPack(selectedModel, 'core-v1')
      setHistory(current => [record, ...current.filter(item => item.runId !== record.runId)].slice(0, 50))
      setLeftRunId(current => current || record.runId)
      setRightRunId(record.runId)
      if (record.status !== 'completed') setError('The local task pack completed with unavailable or cancelled tasks.')
    } catch (cause) { setError(normalizeCliError(cause).message) }
    finally { setRunning(false) }
  }

  useEffect(() => {
    if (!leftRunId || !rightRunId || leftRunId === rightRunId) { setComparison(null); return }
    let active = true
    void metrora.getBenchComparison(leftRunId, rightRunId).then(value => { if (active) setComparison(value) }).catch(cause => { if (active) setError(normalizeCliError(cause).message) })
    return () => { active = false }
  }, [leftRunId, rightRunId])

  const selectedLeft = useMemo(() => history.find(record => record.runId === leftRunId) ?? null, [history, leftRunId])
  const selectedRight = useMemo(() => history.find(record => record.runId === rightRunId) ?? null, [history, rightRunId])

  return (
    <main className="bench-surface" aria-label="Local Bench">
      <header className="bench-header">
        <div><p className="bench-kicker">MEASURE · LOCAL ONLY</p><h1>Bench</h1><p>Run a fixed, deterministic task pack against a local Ollama model and keep bounded evidence for later comparison.</p></div>
        <div className="bench-run-control"><label htmlFor="bench-model">Local model</label><input id="bench-model" value={model} onChange={event => setModel(event.target.value)} placeholder="e.g. qwen3:8b" /><button type="button" className="btn btn-p" onClick={() => void run()} disabled={running}>{running ? 'Running…' : 'Run task pack'}</button></div>
      </header>
      {error ? <p className="bench-alert" role="alert">{error}</p> : null}
      <div className="bench-note">Fixed loopback runtime · versioned core-v1 pack · outputs are scored transiently and only digests/metrics are retained.</div>
      <div className="bench-grid">
        <EvidenceCard record={latest} />
        <Panel title="History" right={invalidCount ? <span className="bench-invalid">{invalidCount} invalid record{invalidCount === 1 ? '' : 's'} skipped</span> : null}>
          {loading ? <EmptyNote>Loading local Bench history…</EmptyNote> : history.length === 0 ? <EmptyNote>No task-pack runs yet.</EmptyNote> : <div className="bench-history-list">{history.map(record => <button type="button" className={record.runId === latest?.runId ? 'bench-history-row active' : 'bench-history-row'} key={record.runId} onClick={() => setRightRunId(record.runId)}><span><b>{record.model.selected}</b><small>{new Date(record.endedAt).toLocaleString()}</small></span><strong>{record.aggregate.passed}/{record.aggregate.planned}</strong></button>)}</div>}
        </Panel>
      </div>
      <Panel title="Compare compatible records">
        <div className="bench-select-row"><label>Reference<select aria-label="Bench reference run" value={leftRunId} onChange={event => setLeftRunId(event.target.value)}><option value="">Select a run</option>{history.map(record => <option key={record.runId} value={record.runId}>{record.model.selected} · {record.runId.slice(0, 8)}</option>)}</select></label><span>vs</span><label>Comparison<select aria-label="Bench comparison run" value={rightRunId} onChange={event => setRightRunId(event.target.value)}><option value="">Select a run</option>{history.map(record => <option key={record.runId} value={record.runId}>{record.model.selected} · {record.runId.slice(0, 8)}</option>)}</select></label></div>
        {selectedLeft && selectedRight && leftRunId !== rightRunId ? <ComparisonCard comparison={comparison} /> : <p className="bench-footnote">Choose two different runs from the same versioned pack. Incompatible packs stay explicitly unavailable.</p>}
      </Panel>
    </main>
  )
}
