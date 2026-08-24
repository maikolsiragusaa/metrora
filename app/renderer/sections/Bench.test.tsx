// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bench } from './Bench'

const { getBenchHistory, getBenchComparison, runBenchTaskPack } = vi.hoisted(() => ({ getBenchHistory: vi.fn(), getBenchComparison: vi.fn(), runBenchTaskPack: vi.fn() }))
vi.mock('../lib/ipc', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/ipc')>()
  return { ...actual, metrora: { ...actual.metrora, getBenchHistory, getBenchComparison, runBenchTaskPack } }
})

function record(runId: string, model: string) {
  return { schemaVersion: 'metrora.bench-evaluation.v1', runId, runner: { id: 'ollama-task-pack-v1', version: '1.0.0' }, pack: { packId: 'metrora.bench.core', version: '1.0.0', digest: 'a'.repeat(64) }, model: { selected: model, reported: model }, runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434', version: '0.12.6' }, startedAt: '2026-08-24T10:00:00.000Z', endedAt: '2026-08-24T10:01:00.000Z', status: 'completed', tasks: [{ taskId: 'exact-word', attempted: true, status: 'passed', score: 1, outputDigest: 'b'.repeat(64), outputChars: 4, requestLatencyMs: 10, timeToFirstContentMs: 3, failure: null }], aggregate: { planned: 1, attempted: 1, passed: 1, failed: 0, unavailable: 0, cancelled: 0, score: { numerator: 1, denominator: 1, value: 1 } }, resultDigest: 'c'.repeat(64) }
}

describe('Bench desktop surface', () => {
  beforeEach(() => {
    getBenchHistory.mockResolvedValue({ schemaVersion: 'metrora.bench-history-report.v1', records: [record('run-b', 'qwen3:8b'), record('run-a', 'llama3.2')], invalidCount: 0 })
    getBenchComparison.mockResolvedValue({ schemaVersion: 'metrora.bench-comparison.v1', compatible: true, reason: 'compatible', left: { runId: 'run-a', model: 'llama3.2', endedAt: '2026-08-24T10:01:00.000Z' }, right: { runId: 'run-b', model: 'qwen3:8b', endedAt: '2026-08-24T10:01:00.000Z' }, deltas: { score: 0, passed: 0, failed: 0, unavailable: 0, cancelled: 0, medianRequestLatencyMs: 0, medianFirstContentMs: 0 } })
    runBenchTaskPack.mockResolvedValue(record('run-c', 'qwen3:8b'))
    getBenchHistory.mockClear(); getBenchComparison.mockClear(); runBenchTaskPack.mockClear()
  })

  it('shows explicit local execution, bounded history, and factual comparison controls', async () => {
    render(<Bench />)
    expect(await screen.findByRole('heading', { name: 'Bench' })).toBeInTheDocument()
    expect(screen.getByLabelText('Local model')).toBeInTheDocument()
    expect(screen.getByText(/Deterministic task-pack evidence only/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Bench reference run' })).toBeInTheDocument()
    expect(getBenchHistory).toHaveBeenCalledTimes(1)
  })

  it('runs the selected local model and updates the evidence list', async () => {
    render(<Bench />)
    await waitFor(() => expect(getBenchHistory).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Local model'), { target: { value: 'qwen3:8b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run task pack' }))
    await waitFor(() => expect(runBenchTaskPack).toHaveBeenCalledWith('qwen3:8b', 'core-v1'))
    expect(screen.getByText(/tasks passed/)).toBeInTheDocument()
  })
})
