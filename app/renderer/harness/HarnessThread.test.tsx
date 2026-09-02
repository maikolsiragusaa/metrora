// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HarnessThread } from './HarnessThread'
import type { AdvisorAnswer, AdvisorScope, AdvisorScopeConflictV1 } from '../advisor/types'
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
  onScopeConflictOption: vi.fn(),
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
    expect(screen.getByText('Checking usage · Last 7 days')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
  })

  it('keeps the Swarm work block in the same conversation thread as the user task', () => {
    render(<HarnessThread {...baseProps} mode="swarm" messages={[{ id: 'task-1', role: 'user', text: 'Investigate current spend' }]} />)
    expect(screen.getByText('Investigate current spend')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Swarm run' })).toHaveTextContent('Swarm is ready')
  })

  it('exposes bounded choices when the question period conflicts with the UI scope', async () => {
    const conflict: AdvisorScopeConflictV1 = {
      currentPeriod: 'today',
      requestedPeriod: 'lifetime',
      message: 'This question requires Lifetime, but the current scope is Today.',
      options: [
        { id: 'use-requested-period', label: 'Use Lifetime for this turn' },
        { id: 'change-scope', label: 'Change scope' },
      ],
    }
    const answer: AdvisorAnswer = {
      conclusion: conflict.message,
      scopeLabel: 'Today',
      periodLabel: 'Today',
      evidence: [],
      coverage: { level: 'unavailable', label: 'One choice needed', detail: conflict.message },
      assumptions: [],
      unknown: [],
      nextInvestigations: [],
      details: [],
      understanding: { intent: 'clarification', summary: 'scope conflict', usedDefaultScope: false, clarification: conflict.message, boundary: null, scopeConflict: conflict },
      runtime: { id: 'fixture', label: 'Fixture', mode: 'ollama-local' },
    }
    const onScopeConflictOption = vi.fn()
    render(<HarnessThread {...baseProps} onScopeConflictOption={onScopeConflictOption} messages={[{ id: 'question', role: 'user', text: 'How much have I spent in total?' }, { id: 'answer', role: 'assistant', answer }]} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Use Lifetime for this turn' }))
    expect(onScopeConflictOption).toHaveBeenCalledWith('How much have I spent in total?', conflict, expect.objectContaining({ id: 'use-requested-period' }))
  })
})
