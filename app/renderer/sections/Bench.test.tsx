// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bench } from './Bench'

const { getBenchHistory, getBenchModelDiscovery, getBenchComparison, runBenchTaskPack } = vi.hoisted(() => ({
  getBenchHistory: vi.fn(),
  getBenchModelDiscovery: vi.fn(),
  getBenchComparison: vi.fn(),
  runBenchTaskPack: vi.fn(),
}))

vi.mock('../lib/ipc', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/ipc')>()
  return { ...actual, metrora: { ...actual.metrora, getBenchHistory, getBenchModelDiscovery, getBenchComparison, runBenchTaskPack } }
})

const runtimeReported = {
  totalDurationNs: 100_000_000,
  loadDurationNs: 10_000_000,
  promptEvalCount: 3,
  promptEvalDurationNs: 4_000_000,
  evalCount: 4,
  evalDurationNs: 80_000_000,
}

function record(runId: string, model: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'metrora.bench-evaluation.v1',
    runId,
    runner: { id: 'ollama-task-pack-v1', version: '1.0.0' },
    pack: { packId: 'metrora.bench.core', version: '1.0.0', digest: 'a'.repeat(64) },
    model: { selected: model, reported: model },
    runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434', version: '0.12.6' },
    environment: { os: 'test', arch: 'x64', node: 'v22' },
    generation: { parameters: { temperature: 0, seed: 1729, numPredict: 64 }, policy: 'one-bounded-request-per-task' },
    startedAt: '2026-08-24T10:00:00.000Z',
    endedAt: '2026-08-24T10:01:00.000Z',
    status: 'completed',
    tasks: [{ taskId: 'exact-word', attempted: true, status: 'passed', score: 1, outputDigest: 'b'.repeat(64), outputChars: 4, requestLatencyMs: 10, timeToFirstContentMs: 3, runtimeReported, failure: null }],
    aggregate: { planned: 1, attempted: 1, passed: 1, failed: 0, unavailable: 0, cancelled: 0, score: { numerator: 1, denominator: 1, value: 1 } },
    resultDigest: 'c'.repeat(64),
    ...overrides,
  }
}

function unavailableRecord(runId = 'run-unavailable') {
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    taskId: `task-${index + 1}`,
    attempted: false,
    status: 'unavailable',
    score: null,
    outputDigest: null,
    outputChars: null,
    requestLatencyMs: null,
    timeToFirstContentMs: null,
    runtimeReported: { totalDurationNs: null, loadDurationNs: null, promptEvalCount: null, promptEvalDurationNs: null, evalCount: null, evalDurationNs: null },
    failure: { code: 'runtime-unavailable', message: 'Ollama local runtime unavailable.' },
  }))
  return record(runId, 'qwen3:8b', {
    status: 'unavailable',
    tasks,
    aggregate: { planned: 6, attempted: 0, passed: 0, failed: 0, unavailable: 6, cancelled: 0, score: { numerator: 0, denominator: 0, value: null } },
  })
}

function partialUnavailableRecord(runId = 'run-partial-unavailable') {
  const base = unavailableRecord(runId)
  const tasks = base.tasks.map((task, index) => index === 0
    ? { ...task, attempted: true, status: 'passed', score: 1, outputDigest: 'b'.repeat(64), outputChars: 4, requestLatencyMs: 10, timeToFirstContentMs: 3, failure: null }
    : task)
  return {
    ...base,
    tasks,
    aggregate: { planned: 6, attempted: 1, passed: 1, failed: 0, unavailable: 5, cancelled: 0, score: { numerator: 1, denominator: 1, value: 1 } },
  }
}

function compatibleComparison() {
  return {
    schemaVersion: 'metrora.bench-comparison.v1',
    compatible: true,
    reason: 'compatible',
    left: { runId: 'run-a', model: 'llama3.2', endedAt: '2026-08-24T10:01:00.000Z' },
    right: { runId: 'run-b', model: 'qwen3:8b', endedAt: '2026-08-24T10:01:00.000Z' },
    deltas: { score: 0, passed: 0, failed: 0, unavailable: 0, cancelled: 0, medianRequestLatencyMs: 0, medianFirstContentMs: 0 },
  }
}

function defaultHistory() {
  return { schemaVersion: 'metrora.bench-history-report.v1', records: [record('run-b', 'qwen3:8b'), record('run-a', 'llama3.2')], invalidCount: 0 }
}

describe('Bench desktop surface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBenchHistory.mockResolvedValue(defaultHistory())
    getBenchModelDiscovery.mockResolvedValue({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'models-discovered',
      models: ['qwen3:8b', 'llama3.2'],
      detail: '2 local Ollama models discovered.',
      checkedAt: '2026-08-24T10:00:00.000Z',
    })
    getBenchComparison.mockResolvedValue(compatibleComparison())
    runBenchTaskPack.mockResolvedValue(record('run-c', 'qwen3:8b'))
  })

  it('shows explicit Core conformance framing, discovery, history, and factual comparison controls', async () => {
    render(<Bench />)
    expect(await screen.findByRole('heading', { name: 'Bench' })).toBeInTheDocument()
    expect(screen.getByLabelText('Local model')).toBeInTheDocument()
    expect(screen.getByText(/Core conformance checks/)).toBeInTheDocument()
    expect(screen.getByText(/not a general coding or model-quality evaluation/)).toBeInTheDocument()
    expect(await screen.findByText(/2 local Ollama models discovered/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Bench reference run' })).toBeInTheDocument()
    expect(getBenchHistory).toHaveBeenCalledTimes(1)
    expect(getBenchModelDiscovery).toHaveBeenCalledTimes(1)
  })

  it('runs the selected discovered model and updates the evidence list', async () => {
    render(<Bench />)
    await screen.findByText(/2 local Ollama models discovered/)
    fireEvent.change(screen.getByLabelText('Local model'), { target: { value: 'qwen3:8b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Core conformance' }))
    await waitFor(() => expect(runBenchTaskPack).toHaveBeenCalledWith('qwen3:8b', 'core-v1'))
    expect(screen.getByText('Latest core conformance')).toBeInTheDocument()
  })

  it('shows an unavailable result after a runtime outage instead of retaining the previous score', async () => {
    runBenchTaskPack.mockResolvedValue(record('run-c', 'qwen3:8b', {
      status: 'unavailable',
      tasks: [{ taskId: 'exact-word', attempted: false, status: 'unavailable', score: null, outputDigest: null, outputChars: null, requestLatencyMs: null, timeToFirstContentMs: null, runtimeReported, failure: { code: 'runtime-unavailable', message: 'Ollama local runtime unavailable.' } }],
      aggregate: { planned: 1, attempted: 0, passed: 0, failed: 0, unavailable: 1, cancelled: 0, score: { numerator: 0, denominator: 0, value: null } },
    }))
    render(<Bench />)
    await screen.findByText(/2 local Ollama models discovered/)
    fireEvent.change(screen.getByLabelText('Local model'), { target: { value: 'qwen3:8b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Core conformance' }))

    await waitFor(() => expect(runBenchTaskPack).toHaveBeenCalledWith('qwen3:8b', 'core-v1'))
    expect(await screen.findByText('Runtime unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('No checks scored · 1 planned')).toHaveLength(2)
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
  })

  it('keeps technical identity and raw task evidence behind progressive disclosure', async () => {
    render(<Bench />)
    await screen.findByText('Latest core conformance')
    const details = screen.getByText('Details').closest('details')
    const evidence = screen.getByText('Evidence').closest('details')
    expect(details).not.toBeNull()
    expect(evidence).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Details'))
    fireEvent.click(screen.getByText('Evidence'))
    expect(details).toHaveAttribute('open')
    expect(evidence).toHaveAttribute('open')
    expect(screen.getByText('Pack identity')).toBeInTheDocument()
    expect(screen.getByText('Raw task results')).toBeInTheDocument()
    expect(screen.getByText(/Response bodies and prompts are not retained/)).toBeInTheDocument()
  })

  it('does not turn unavailable runtime state into a zero score', async () => {
    getBenchHistory.mockResolvedValue({ schemaVersion: 'metrora.bench-history-report.v1', records: [unavailableRecord()], invalidCount: 0 })
    render(<Bench />)
    expect(await screen.findByText('Runtime unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('No checks scored · 6 planned')).toHaveLength(2)
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0)
    expect(screen.queryByText('0 / 6')).not.toBeInTheDocument()
  })

  it('distinguishes a runtime outage during a partial run from generic incompleteness', async () => {
    getBenchHistory.mockResolvedValue({ schemaVersion: 'metrora.bench-history-report.v1', records: [partialUnavailableRecord()], invalidCount: 0 })
    render(<Bench />)
    expect(await screen.findByText('Runtime unavailable during run')).toBeInTheDocument()
    expect(screen.getByText(/local runtime became unavailable during the run/)).toBeInTheDocument()
  })

  it('distinguishes invalid-only history from an empty history', async () => {
    getBenchHistory.mockResolvedValue({ schemaVersion: 'metrora.bench-history-report.v1', records: [], invalidCount: 2 })
    render(<Bench />)
    expect(await screen.findByText(/No usable Core conformance runs yet/)).toBeInTheDocument()
    expect(screen.getByText('2 invalid retained records skipped')).toBeInTheDocument()
  })

  it('keeps manual entry available when local model discovery is unavailable', async () => {
    getBenchModelDiscovery.mockRejectedValue(new Error('bridge unavailable'))
    render(<Bench />)
    expect(await screen.findByText(/Manual Ollama model entry remains available/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. qwen3:8b')).toBeInTheDocument()
  })

  it('distinguishes structured discovery unavailability from an empty model list', async () => {
    getBenchModelDiscovery.mockResolvedValue({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'unavailable',
      models: [],
      detail: 'Ollama local runtime is unavailable.',
      checkedAt: '2026-08-24T10:00:00.000Z',
    })
    render(<Bench />)
    expect(await screen.findByText(/Model discovery is unavailable/)).toBeInTheDocument()
    expect(screen.queryByText(/No local Ollama models were discovered/)).not.toBeInTheDocument()
  })

  it('preserves a manually entered model when discovery is refreshed', async () => {
    getBenchModelDiscovery.mockResolvedValueOnce({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'no-models',
      models: [],
      detail: 'Ollama is reachable but no usable local models were discovered.',
      checkedAt: '2026-08-24T10:00:00.000Z',
    }).mockResolvedValueOnce({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'models-discovered',
      models: ['qwen3:8b'],
      detail: '1 local Ollama model discovered.',
      checkedAt: '2026-08-24T10:01:00.000Z',
    })
    render(<Bench />)
    const input = await screen.findByPlaceholderText('e.g. qwen3:8b')
    fireEvent.change(input, { target: { value: 'manual-model:latest' } })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))
    expect(await screen.findByDisplayValue('manual-model:latest')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use a discovered model' })).toBeInTheDocument()
  })

  it('reports incompatible retained records without inventing deltas', async () => {
    getBenchComparison.mockResolvedValue({ ...compatibleComparison(), compatible: false, reason: 'pack-mismatch', deltas: null })
    render(<Bench />)
    expect(await screen.findByText('Not comparable')).toBeInTheDocument()
    expect(screen.getByText('Reason: pack identity differs')).toBeInTheDocument()
    expect(screen.queryByText('Pass-rate delta')).not.toBeInTheDocument()
  })
})
