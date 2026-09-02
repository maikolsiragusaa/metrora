// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HarnessSwarmRun } from './HarnessSwarmRun'
import type { SwarmRunState } from '../swarm/useSwarmRun'

const emptyState: SwarmRunState = {
  runId: null,
  status: 'idle',
  events: [],
  result: null,
  error: null,
  running: false,
}

describe('Harness V3 inline Swarm run', () => {
  it('keeps Swarm bounded and unavailable when the experimental gate is off', () => {
    render(<HarnessSwarmRun enabled={false} runtimeLabel="Ollama local" modelLabel="model-a" state={emptyState} onCancel={vi.fn()} />)
    expect(screen.getByText('Swarm · Soon')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Swarm unavailable' })).toHaveTextContent('Chat remains available in this conversation.')
  })

  it('renders worker activity inline with bounded closeout language', () => {
    const onCancel = vi.fn()
    const state: SwarmRunState = {
      ...emptyState,
      runId: 'run-ui',
      running: true,
      status: 'idle',
      events: [
        { contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: 'run-ui', workerId: 'run-ui-worker-1', role: 'investigator', status: 'tool-started', at: '2026-08-31T00:00:00.000Z', toolName: 'get_spend_snapshot' },
        { contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: 'run-ui', workerId: 'run-ui-worker-2', role: 'verifier', status: 'queued', at: '2026-08-31T00:00:00.000Z' },
      ],
    }
    render(<HarnessSwarmRun enabled runtimeLabel="Ollama local" modelLabel="model-a" state={state} onCancel={onCancel} />)
    expect(screen.getByText('Swarm')).toBeInTheDocument()
    expect(screen.getByText(/Bounded subagents will report back into this conversation/)).toBeInTheDocument()
    expect(screen.getByText('Usage · Running')).toBeInTheDocument()
    expect(screen.getByText('2 subagents · 0 complete · active')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
