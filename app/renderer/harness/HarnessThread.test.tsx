// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HarnessThread } from './HarnessThread'
import type { AdvisorScope } from '../advisor/types'
import type { SwarmRunState } from '../swarm/useSwarmRun'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}
const swarmState: SwarmRunState = {
  runId: null,
  status: 'idle',
  events: [],
  result: null,
  error: null,
  running: false,
}

const baseProps: Parameters<typeof HarnessThread>[0] = {
  mode: 'chat',
  swarmExperimentalEnabled: true,
  swarm: { enabled: true, runtimeLabel: 'Ollama local', modelLabel: 'qwen3', state: swarmState, onCancel: vi.fn() },
  scope,
  messages: [],
  selectedAnswerId: null,
  onSelectAnswer: vi.fn(),
  onFollowUp: vi.fn(),
  harnessActions: {},
  harnessActionBusyId: null,
  onConfirmHarnessAction: vi.fn(),
  onCancelHarnessAction: vi.fn(),
  loadingQuestion: null,
  toolStatus: null,
  toolActivity: [],
  streamPreview: '',
  onCancel: vi.fn(),
  error: null,
  onRetry: vi.fn(),
  failedRequestPresent: false,
  notice: null,
  onAsk: vi.fn(),
  onNextInvestigation: vi.fn(),
}

describe('Harness V3 thread composition', () => {
  it('renders tool activity inline with the pending assistant turn', () => {
    render(<HarnessThread {...baseProps} loadingQuestion="Inspect usage" toolStatus="Reading usage…" toolActivity={[{ name: 'get_spend_snapshot', status: 'started' }]} />)
    expect(screen.getByLabelText('Harness work activity')).toBeInTheDocument()
    expect(screen.getByText('Reading usage · Last 7 days')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
  })

  it('keeps the Swarm work block in the same conversation thread as the user task', () => {
    render(<HarnessThread {...baseProps} mode="swarm" messages={[{ id: 'task-1', role: 'user', text: 'Investigate current spend' }]} />)
    expect(screen.getByText('Investigate current spend')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Swarm run' })).toHaveTextContent('Swarm is ready')
  })
})
