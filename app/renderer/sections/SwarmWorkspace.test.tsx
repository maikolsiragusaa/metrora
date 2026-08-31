// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SwarmWorkspace } from './SwarmWorkspace'
import type { SwarmRunState } from '../swarm/useSwarmRun'

const emptyState: SwarmRunState = {
  runId: null,
  status: 'idle',
  events: [],
  result: null,
  error: null,
  running: false,
}

describe('Swarm Harness surface', () => {
  it('shows an unavailable state when the deployment gate is off', () => {
    render(<SwarmWorkspace enabled={false} runtimeLabel="Ollama local" modelLabel="model-a" state={emptyState} onRun={vi.fn()} workerCount={2} onWorkerCountChange={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('Swarm unavailable')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Swarm is not enabled' })).toBeInTheDocument()
  })

  it('shows manual bounded controls and observable worker activity', () => {
    const onCancel = vi.fn()
    const state: SwarmRunState = {
      ...emptyState,
      runId: 'run-ui',
      running: true,
      events: [
        { contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: 'run-ui', workerId: 'run-ui-worker-1', role: 'investigator', status: 'tool-started', at: '2026-08-31T00:00:00.000Z', toolName: 'get_spend_snapshot' },
        { contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: 'run-ui', workerId: 'run-ui-worker-2', role: 'verifier', status: 'queued', at: '2026-08-31T00:00:00.000Z' },
      ],
    }
    render(<SwarmWorkspace enabled runtimeLabel="Ollama local" modelLabel="model-a" state={state} onRun={vi.fn()} workerCount={2} onWorkerCountChange={vi.fn()} onCancel={onCancel} />)
    expect(screen.getByText('Swarm · Manual and bounded')).toBeInTheDocument()
    expect(screen.getByText(/Bounded transparent workers use the selected Harness runtime/)).toBeInTheDocument()
    expect(screen.getByText('Read-only Tools - max 4 Tool calls/worker - max 1 Tool round/worker')).toBeInTheDocument()
    expect(screen.getByText('get_spend_snapshot - Running')).toBeInTheDocument()
    expect(screen.getByText('2 workers - 0 complete - Cancel available')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('keeps worker selection in the Swarm panel while the shared composer owns the task', () => {
    const onWorkerCountChange = vi.fn()
    render(<SwarmWorkspace enabled runtimeLabel="Ollama local" modelLabel="model-a" state={emptyState} onRun={vi.fn()} workerCount={2} onWorkerCountChange={onWorkerCountChange} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Swarm worker count' }), { target: { value: '3' } })
    expect(onWorkerCountChange).toHaveBeenCalledWith(3)
    expect(screen.getByText('Use the shared Harness composer below to start this run.')).toBeInTheDocument()
  })
})
