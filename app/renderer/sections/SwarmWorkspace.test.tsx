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
  it('shows Soon and disables the surface when the experimental gate is off', () => {
    render(<SwarmWorkspace enabled={false} runtimeLabel="Ollama local" modelLabel="model-a" state={emptyState} onRun={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('Swarm - Soon')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Experimental Swarm is not enabled' })).toBeInTheDocument()
  })

  it('shows experimental bounded controls and observable worker activity', () => {
    const onRun = vi.fn()
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
    render(<SwarmWorkspace enabled runtimeLabel="Ollama local" modelLabel="model-a" state={state} onRun={onRun} onCancel={onCancel} />)
    expect(screen.getByText('Swarm - Experimental')).toBeInTheDocument()
    expect(screen.getByText(/Bounded transparent workers use the selected Harness runtime/)).toBeInTheDocument()
    expect(screen.getByText('Read-only Tools - max 4 Tool calls/worker - max 1 Tool round/worker')).toBeInTheDocument()
    expect(screen.getByText('get_spend_snapshot - Running')).toBeInTheDocument()
    expect(screen.getByText('2 workers - 0 complete - Cancel available')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('submits a user task with the selected bounded worker count', () => {
    const onRun = vi.fn()
    render(<SwarmWorkspace enabled runtimeLabel="Ollama local" modelLabel="model-a" state={emptyState} onRun={onRun} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Swarm task' }), { target: { value: 'Investigate current spend' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Swarm worker count' }), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Swarm' }))
    expect(onRun).toHaveBeenCalledWith('Investigate current spend', 3)
  })
})
