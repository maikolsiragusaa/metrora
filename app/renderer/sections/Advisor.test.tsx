// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Polled } from '../hooks/usePolled'
import type { MenubarPayload } from '../lib/types'
import type { MetroraHarnessActionEvent } from '../lib/metrora-bridge-types'
import { createAdvisorContextualLaunch } from '../advisor/context'
import type { AdvisorAnswer, AdvisorHostedModelState, AdvisorHostedProviderId, AdvisorRuntimeProbe } from '../advisor/types'
import { Advisor } from './Advisor'

const { advisorProbe, advisorHostedProbe, advisorCredentialSet, advisorCredentialClear, investigate, harnessPropose, harnessApprove, harnessCancel, harnessEventSubscription } = vi.hoisted(() => ({
  advisorProbe: vi.fn(async (runtime: 'ollama' | 'lmstudio' = 'ollama'): Promise<AdvisorRuntimeProbe> => runtime === 'lmstudio'
    ? { runtime: 'lmstudio', available: true, models: ['qwen/qwen3-8b'], detail: 'Local LM Studio is reachable.', discoveryState: 'models-discovered', capabilities: [{ schemaVersion: 1, runtime: 'lmstudio', modelId: 'qwen/qwen3-8b', discovery: 'discovered', conversational: 'available', toolCall: 'unknown', streaming: 'supported', limitation: 'Tool support varies by model.' }] }
    : { runtime: 'ollama', available: false, models: [], detail: 'Ollama is not running.' }),
  investigate: vi.fn(),
  advisorHostedProbe: vi.fn(),
  advisorCredentialSet: vi.fn(async (provider: AdvisorHostedProviderId) => ({ provider, state: 'ready' as const })),
  advisorCredentialClear: vi.fn(async (provider: AdvisorHostedProviderId) => ({ provider, state: 'not-configured' as const })),
  harnessPropose: vi.fn(),
  harnessApprove: vi.fn(),
  harnessCancel: vi.fn(),
  harnessEventSubscription: vi.fn(() => () => {}),
}))
vi.mock('../advisor/kernel', () => ({ createAdvisorKernel: () => ({ investigate }) }))
vi.mock('../lib/ipc', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/ipc')>()
  return {
    ...actual,
    metrora: {
      ...actual.metrora,
      advisorProbe,
      advisorHostedProbe,
      advisorCredentialSet,
      advisorCredentialClear,
      advisorChat: vi.fn(),
      advisorCancel: vi.fn(async () => false),
      onAdvisorDelta: vi.fn(() => () => {}),
      harnessProposeCoreCompatibility: harnessPropose,
      harnessApproveCoreCompatibility: harnessApprove,
      harnessCancelCoreCompatibility: harnessCancel,
      onHarnessActionEvent: harnessEventSubscription,
    },
  }
})

const overview = {
  data: null,
  error: null,
  loading: false,
  switching: false,
  lastSuccessAt: null,
  refresh: vi.fn(),
  refreshFresh: vi.fn(),
} as unknown as Polled<MenubarPayload>
const overviewWithOptions = {
  ...overview,
  data: {
    current: { modelAccounting: { rows: [{ name: 'gpt-safe' }] }, topModels: [{ name: 'gpt-safe' }] },
    projectScope: { options: [{ id: 'project-a', name: 'Project A' }] },
  },
} as unknown as Polled<MenubarPayload>
const answer = {
  conclusion: 'Verified RESPONSE needle.', scopeLabel: 'Last 7 days · All projects · All providers', periodLabel: 'Last 7 days',
  evidence: [], coverage: { level: 'partial', label: 'Partial', detail: 'Test evidence.' }, assumptions: [], unknown: ['Unknown detail.'], nextInvestigations: ['Inspect the evidence'], details: ['Detailed evidence.'], why: ['Primary driver.'], materialLimits: ['Interpretation is bounded.'],
  runtime: { id: 'test', label: 'Test', mode: 'deterministic-local' },
} satisfies AdvisorAnswer
const coreCompatibilityAnswer = {
  ...answer,
  conclusion: 'Core Compatibility proposal ready.',
  actionProposal: {
    contractVersion: 'advisor-action-proposal-v1',
    schemaVersion: 1,
    kind: 'run-core-compatibility',
    status: 'proposal-only',
    summary: 'Review the bounded Core Compatibility proposal.',
    target: 'canonical Core Compatibility task pack',
    scope: { period: 'week', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null },
    allowedReadTools: [],
    permissions: ['read-canonical-evidence'],
    budget: { maxCalls: 0, maxCostUSD: null },
    timeoutMs: 0,
    cancellation: 'required',
  },
} satisfies AdvisorAnswer
const coreCompatibilityEvent = {
  actionId: 'core-action-1',
  kind: 'run-core-compatibility',
  status: 'proposed',
  model: 'qwen3:8b',
  originatingSurface: 'desktop',
  runtime: { id: 'ollama-local' },
  proposalDigest: 'a'.repeat(64),
  pack: { selector: 'core-v1', packId: 'core', version: '1', checks: 6, digest: 'b'.repeat(64) },
  checks: { planned: 6, completed: 0 },
  progress: { planned: 6, completed: 0 },
  cancellation: { requested: false },
  timeout: { perRequestMs: 1000, operationMs: 7000, triggered: false },
  result: null,
  evidence: null,
  failure: null,
  updatedAt: '2026-08-30T12:00:00.000Z',
} satisfies MetroraHarnessActionEvent
const completedCoreCompatibilityEvent = {
  ...coreCompatibilityEvent,
  status: 'completed' as const,
  checks: { planned: 6, completed: 6 },
  progress: { planned: 6, completed: 6 },
  result: { history: 'saved' as const, counts: { planned: 6, attempted: 6, passed: 5, failed: 1, unavailable: 0, timedOut: 0, cancelled: 0 } },
  evidence: { available: true, history: 'saved' as const },
} satisfies MetroraHarnessActionEvent

async function submitQuestion(question: string): Promise<void> {
  const previousCalls = investigate.mock.calls.length
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask Metrora Harness' }), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: /Send/ }))
  await waitFor(() => expect(investigate.mock.calls).toHaveLength(previousCalls + 1))
}

function openHarnessContext(): void {
  const trigger = screen.getByRole('button', { name: 'Harness context' })
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
}

describe('Harness V3 workspace', () => {
  beforeEach(() => {
    localStorage.clear()
    advisorProbe.mockReset().mockImplementation(async (runtime: 'ollama' | 'lmstudio' = 'ollama'): Promise<AdvisorRuntimeProbe> => runtime === 'lmstudio'
      ? { runtime: 'lmstudio', available: true, models: ['qwen/qwen3-8b'], detail: 'Local LM Studio is reachable.', discoveryState: 'models-discovered', capabilities: [{ schemaVersion: 1, runtime: 'lmstudio', modelId: 'qwen/qwen3-8b', discovery: 'discovered', conversational: 'available', toolCall: 'unknown', streaming: 'supported', limitation: 'Tool support varies by model.' }] }
      : { runtime: 'ollama', available: false, models: [], detail: 'Ollama is not running.' })
    advisorCredentialSet.mockClear()
    advisorCredentialClear.mockClear()
    harnessPropose.mockReset()
    harnessApprove.mockReset()
    harnessCancel.mockReset()
    harnessEventSubscription.mockReset().mockReturnValue(() => {})
    advisorHostedProbe.mockReset().mockImplementation(async (provider: AdvisorHostedProviderId) => ({
      provider,
      available: true,
      models: provider === 'openai'
        ? [{ id: 'gpt-a', label: 'gpt-a', state: 'discovered', limitation: null }, { id: 'gpt-b', label: 'gpt-b', state: 'discovered', limitation: null }]
        : provider === 'anthropic'
          ? [{ id: 'claude-a', label: 'claude-a', state: 'discovered', limitation: null }]
          : provider === 'gemini'
            ? [{ id: 'gemini-a', label: 'gemini-a', state: 'discovered', limitation: null }]
            : [{ id: 'openrouter/auto', label: 'openrouter/auto', state: 'unverified', limitation: 'Compatibility unverified.', capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'unknown' } }],
      detail: 'Hosted provider is reachable.',
      credentialState: 'ready',
    }))
    investigate.mockReset().mockResolvedValue(answer)
  })
  it('opens as a conversation-first surface with secondary history and progressive evidence', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)

    expect(screen.getByRole('heading', { name: 'Harness' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Ask Metrora Harness' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /What changed in my usage/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /What is using my quota/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Harness history' })).not.toBeInTheDocument()
    expect(screen.queryByText('Ask a question to pin its evidence')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Harness context' })).toBeInTheDocument()
    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.queryByText('Unpinned context')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Harness execution strategy' })).toHaveValue('chat')
    expect(screen.getByRole('button', { name: 'Configure runtime' })).toBeInTheDocument()
    expect(screen.queryByText('HARNESS · TOOLS READ-ONLY')).not.toBeInTheDocument()
    expect(screen.queryByText(/Facts read-only · actions require confirmation/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Harness runtime')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Harness hosted provider')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Runtime unavailable')).toBeInTheDocument())
    expect(screen.queryByText(/offline evidence/i)).not.toBeInTheDocument()
    expect(screen.getByText('Ollama')).toBeInTheDocument()
    expect(advisorProbe).toHaveBeenCalledTimes(1)
  })
  it('loads a contextual scope and suggested investigation without auto-executing it', async () => {
    const contextualLaunch = createAdvisorContextualLaunch({
      originatingSection: 'spend',
      period: '30days',
      range: { from: '2026-08-01', to: '2026-08-25' },
      provider: 'codex',
      projectId: 'project-a',
      projectName: 'Project A',
      model: 'gpt-safe',
    })

    render(
      <Advisor
        period="week"
        provider="all"
        projectScopeId="all"
        range={null}
        overview={overviewWithOptions}
        detectedProviders={[{ id: 'codex', label: 'Codex' }]}
        contextualLaunch={contextualLaunch}
      />,
    )

    openHarnessContext()
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Ask Metrora Harness' })).toHaveValue('What changed in measured spend in this scope, and which drivers are visible?')
      expect(screen.getByLabelText('Harness period')).toHaveValue('30days')
      expect(screen.getByLabelText('Harness provider')).toHaveValue('codex')
      expect(screen.getByLabelText('Harness Project')).toHaveValue('project-a')
      expect(screen.getByLabelText('Harness model')).toHaveValue('gpt-safe')
    })
    expect(screen.getByText('From Spend')).toBeInTheDocument()
    expect(investigate).not.toHaveBeenCalled()
  })
  it('shows Capacity as current provider authority without exposing hidden Desktop scope', async () => {
    const contextualLaunch = createAdvisorContextualLaunch({
      originatingSection: 'plans',
      period: '30days',
      range: { from: '2026-08-01', to: '2026-08-25' },
      provider: 'codex',
      projectId: 'project-a',
      projectName: 'Project A',
      model: 'gpt-safe',
    })

    render(
      <Advisor
        period="week"
        provider="codex"
        projectScopeId="project-a"
        range={{ from: '2026-08-01', to: '2026-08-25' }}
        overview={overviewWithOptions}
        detectedProviders={[{ id: 'codex', label: 'Codex' }]}
        contextualLaunch={contextualLaunch}
      />,
    )

    openHarnessContext()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ask Metrora Harness' })).toHaveValue('What current provider-reported capacity and reset windows are available across the connected providers?'))
    expect(screen.getByText('From Plans')).toBeInTheDocument()
    expect(screen.getByText(/Provider-reported now · All providers; Project and history do not scope Capacity/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Harness period')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Harness Project')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Harness provider')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Harness model')).not.toBeInTheDocument()
    expect(investigate).not.toHaveBeenCalled()
  })
  it('renders direct answer hierarchy while keeping deeper evidence in progressive disclosure', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    await submitQuestion('Inspect spend behavior')

    expect(screen.getByText(answer.conclusion)).toBeInTheDocument()
    const evidenceDetails = screen.getByText('Sources & details').closest('details')
    expect(evidenceDetails).toBeInTheDocument()
    expect(evidenceDetails).not.toHaveAttribute('open')
    expect(screen.getByText('Why').closest('details')).toBe(evidenceDetails)
    expect(screen.getByText('Important limit').closest('details')).toBe(evidenceDetails)
    expect(screen.getByRole('button', { name: 'Inspect the evidence' }).closest('details')).toBe(evidenceDetails)
    fireEvent.click(screen.getByText('Sources & details'))
    expect(evidenceDetails).toHaveAttribute('open')
    expect(screen.getByText('Primary driver.')).toBeInTheDocument()
    expect(screen.getByText('Interpretation is bounded.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect the evidence' })).toBeInTheDocument()
    expect(screen.getByText('Test evidence.')).toBeInTheDocument()
  })

  it('shows the complete trusted Core Compatibility summary and confirms with only the action id and digest', async () => {
    advisorProbe.mockImplementation(async (): Promise<AdvisorRuntimeProbe> => ({ runtime: 'ollama', available: true, models: ['qwen3:8b'], detail: 'Local Ollama is reachable.' }))
    investigate.mockResolvedValueOnce(coreCompatibilityAnswer)
    harnessPropose.mockResolvedValue(coreCompatibilityEvent)
    harnessApprove.mockResolvedValue(completedCoreCompatibilityEvent)
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    await waitFor(() => expect(screen.getByText('Ollama · qwen3:8b')).toBeInTheDocument())
    await submitQuestion('Run Core Compatibility')

    const confirmation = await screen.findByRole('region', { name: 'Harness Core Compatibility confirmation' })
    expect(confirmation).toHaveTextContent('Core Compatibility / Runtime Health')
    expect(confirmation).toHaveTextContent('Ollama local · canonical runtime')
    expect(confirmation).toHaveTextContent('qwen3:8b')
    expect(confirmation).toHaveTextContent('core-v1 · canonical Core Compatibility pack v1')
    expect(confirmation).toHaveTextContent('6 canonical checks · 0 completed')
    expect(confirmation).toHaveTextContent('Loopback-only execution; writes action journal + canonical Bench history only; no repository/filesystem mutation, shell, credentials, arbitrary prompts, or endpoints.')
    expect(confirmation).toHaveTextContent('Up to 1s per request; 7s for the full operation.')
    expect(confirmation).toHaveTextContent('Can be cancelled. Late results do not override terminal cancellation or timeout semantics.')
    expect(screen.getByRole('button', { name: 'Confirm and run' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel operation' })).toBeInTheDocument()
    expect(confirmation).not.toHaveTextContent(/ActionContractV1|approval token/i)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm and run' }))
    await waitFor(() => expect(harnessApprove).toHaveBeenCalledWith('core-action-1', 'a'.repeat(64)))
    expect(harnessApprove.mock.calls[0]).toHaveLength(2)
  })

  it('surfaces the hosted consent guard instead of silently swallowing a submit', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    fireEvent.change(screen.getByLabelText('Harness hosted provider'), { target: { value: 'openrouter' } })
    await waitFor(() => expect(screen.getByLabelText('Harness hosted model')).toHaveValue('openrouter/auto'))

    const question = 'Bonjour, comment ça va ?'
    const composer = screen.getByRole('textbox', { name: 'Ask Metrora Harness' })
    fireEvent.change(composer, { target: { value: question } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Confirm the hosted-provider prompt and evidence sharing notice before sending.'))
    expect(composer).toHaveValue(question)
    expect(investigate).not.toHaveBeenCalled()
  })

  it('submits a ready OpenRouter hosted investigation and clears the composer', async () => {
    investigate.mockImplementationOnce(async input => {
      input.onConformance?.()
      return answer
    })
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    fireEvent.change(screen.getByLabelText('Harness hosted provider'), { target: { value: 'openrouter' } })
    await waitFor(() => expect(screen.getByLabelText('Harness hosted model')).toHaveValue('openrouter/auto'))
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())

    await submitQuestion('Quanto ho speso con Codex negli ultimi giorni?')

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ask Metrora Harness' })).toHaveValue(''))
    expect(investigate).toHaveBeenCalledWith(expect.objectContaining({ question: 'Quanto ho speso con Codex negli ultimi giorni?' }))
    await waitFor(() => expect(screen.getByText('Model: Verified')).toBeInTheDocument())
  })

  it('shows the bounded model and Tool lifecycle through the Harness surface', async () => {
    let releaseModel: (() => void) | undefined
    let releaseTool: (() => void) | undefined
    let releaseContinuation: (() => void) | undefined
    const modelGate = new Promise<void>(resolve => { releaseModel = resolve })
    const toolGate = new Promise<void>(resolve => { releaseTool = resolve })
    const continuationGate = new Promise<void>(resolve => { releaseContinuation = resolve })
    investigate.mockImplementationOnce(async input => {
      const emit = (type: string, extra: Record<string, unknown> = {}) => input.onAgentEvent?.({ type, turnId: 'turn-1', at: '2026-09-02T10:00:00.000Z', ...extra } as never)
      emit('turn-started')
      emit('model-started', { step: 1 })
      await modelGate
      emit('tool-queued', { step: 1, tool: 'get_spend_snapshot', callId: 'call-1' })
      input.onToolEvent?.({ name: 'get_spend_snapshot', status: 'queued' })
      emit('tool-started', { step: 1, tool: 'get_spend_snapshot', callId: 'call-1' })
      input.onToolEvent?.({ name: 'get_spend_snapshot', status: 'started' })
      await toolGate
      emit('tool-completed', { step: 1, tool: 'get_spend_snapshot', callId: 'call-1' })
      input.onToolEvent?.({ name: 'get_spend_snapshot', status: 'completed' })
      await Promise.resolve()
      await continuationGate
      emit('model-started', { step: 2 })
      await Promise.resolve()
      return answer
    })
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    await submitQuestion('Show the bounded execution lifecycle')

    await waitFor(() => expect(screen.getAllByText('Thinking…').length).toBeGreaterThanOrEqual(1))
    releaseModel?.()
    await waitFor(() => expect(screen.getByText('Checking usage…')).toBeInTheDocument())
    releaseTool?.()
    await waitFor(() => expect(screen.getByText('Usage checked')).toBeInTheDocument())
    releaseContinuation?.()
    await waitFor(() => expect(screen.getByText(answer.conclusion)).toBeInTheDocument())
  })

  it('renders Metrora-owned presentation blocks inside the direct answer hierarchy', async () => {
    investigate.mockResolvedValueOnce({
      ...answer,
      presentation: [{
        kind: 'metric-cards',
        title: 'At a glance',
        scopeLabel: 'Last 7 days · All projects · All providers',
        periodLabel: 'Last 7 days',
        evidenceRefs: [],
        cards: [{ label: 'Measured spend', value: '$12.00', unit: 'USD', detail: 'Canonical measured cost.', claimIds: [] }],
      }],
    })
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    await submitQuestion('Show a spend summary')
    expect(screen.getByText('At a glance')).toBeInTheDocument()
    expect(screen.getByText('Measured spend')).toBeInTheDocument()
    expect(screen.getByText('$12.00')).toBeInTheDocument()
  })


  it('switches between supported local runtimes and discovers its models factually', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    await waitFor(() => expect(screen.getByText('Runtime unavailable')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.change(screen.getByLabelText('Harness runtime'), { target: { value: 'lmstudio' } })
    await waitFor(() => expect(screen.getByLabelText('Harness local runtime model')).toHaveValue('qwen/qwen3-8b'))
    expect(screen.getByText(/LM Studio · qwen\/qwen3-8b/)).toBeInTheDocument()
    expect(screen.getByText(/tool support varies by model/)).toBeInTheDocument()
  })

  it('retries the exact failed request in its original conversation and scope without duplicating the user message', async () => {
    investigate.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(answer)
    const { container } = render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[{ id: 'codex', label: 'Codex' }]} />)
    const question = 'Inspect spend behavior'
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Metrora Harness' }), { target: { value: question } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await screen.findByRole('alert')
    openHarnessContext()
    fireEvent.change(screen.getByLabelText('Harness provider'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(answer.conclusion)

    expect(investigate).toHaveBeenCalledTimes(2)
    expect(investigate.mock.calls[1]?.[0]).toMatchObject({ question, scope: { provider: 'all', period: 'week' }, conversation: [] })
    expect(container.querySelectorAll('.user-message')).toHaveLength(1)
  })

  it('retains useful same-scope context for a follow-up', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    await submitQuestion('First scope question')
    await submitQuestion('Same scope follow-up')

    expect(investigate.mock.calls[1]?.[0].conversation).toEqual([
      { role: 'user', content: 'First scope question', scopeFingerprint: expect.any(String) },
      { role: 'assistant', content: answer.conclusion, scopeFingerprint: expect.any(String) },
    ])
    expect(investigate.mock.calls[1]?.[0].conversation[0].scopeFingerprint).toBe(investigate.mock.calls[1]?.[0].conversation[1].scopeFingerprint)
  })

  it('keeps old messages visible but excludes factual context after a Project change', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overviewWithOptions} detectedProviders={[]} />)
    await submitQuestion('Project A question')
    openHarnessContext()
    fireEvent.change(screen.getByLabelText('Harness Project'), { target: { value: 'project-a' } })
    await waitFor(() => expect(screen.getByLabelText('Harness Project')).toHaveValue('project-a'))
    await submitQuestion('Project B question')

    expect(investigate.mock.calls[1]?.[0].conversation).toEqual([])
    expect(screen.getAllByText('Project A question').length).toBeGreaterThan(0)
  })

  it('excludes factual context after a period change', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    await submitQuestion('Weekly question')
    openHarnessContext()
    fireEvent.change(screen.getByLabelText('Harness context mode'), { target: { value: 'pinned' } })
    await waitFor(() => expect(screen.getByLabelText('Harness period')).toHaveValue('week'))
    fireEvent.change(screen.getByLabelText('Harness period'), { target: { value: '30days' } })
    await waitFor(() => expect(screen.getByLabelText('Harness period')).toHaveValue('30days'))
    await submitQuestion('Thirty day question')

    expect(investigate.mock.calls[1]?.[0].conversation).toEqual([])
  })

  it('does not inherit a Desktop range as an implicit Harness context', async () => {
    const view = render(<Advisor period="week" provider="all" projectScopeId="all" range={{ from: '2026-08-01', to: '2026-08-07' }} overview={overview} detectedProviders={[]} />)
    await submitQuestion('First range question')
    view.rerender(<Advisor period="week" provider="all" projectScopeId="all" range={{ from: '2026-08-08', to: '2026-08-14' }} overview={overview} detectedProviders={[]} />)
    await submitQuestion('Second range question')

    expect(investigate.mock.calls[1]?.[0].conversation).toEqual([
      { role: 'user', content: 'First range question', scopeFingerprint: expect.any(String) },
      { role: 'assistant', content: answer.conclusion, scopeFingerprint: expect.any(String) },
    ])
    expect(investigate.mock.calls[1]?.[0].scope).toMatchObject({ range: null, harnessContext: { mode: 'unpinned' } })
  })

  it('excludes factual context after provider and model changes', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overviewWithOptions} detectedProviders={[{ id: 'codex', label: 'Codex' }]} />)
    await submitQuestion('All provider question')
    openHarnessContext()
    fireEvent.change(screen.getByLabelText('Harness provider'), { target: { value: 'codex' } })
    await waitFor(() => expect(screen.getByLabelText('Harness provider')).toHaveValue('codex'))
    await submitQuestion('Codex question')
    expect(investigate.mock.calls[1]?.[0].conversation).toEqual([])

    fireEvent.change(screen.getByLabelText('Harness model'), { target: { value: 'gpt-safe' } })
    await waitFor(() => expect(screen.getByLabelText('Harness model')).toHaveValue('gpt-safe'))
    await submitQuestion('Model question')
    expect(investigate.mock.calls[2]?.[0].conversation).toEqual([])
  })

  it('searches conversation titles, questions, and answers case-insensitively and can clear the query', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Metrora Harness' }), { target: { value: 'Inspect spend behavior' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await screen.findByText(answer.conclusion)
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    fireEvent.click(screen.getByRole('button', { name: /New chat/ }))
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    const search = screen.getByRole('textbox', { name: 'Search Harness history' })
    fireEvent.change(search, { target: { value: 'response NEEDLE' } })
    expect(screen.getByRole('button', { name: /Inspect spend behavior/ })).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'not-present' } })
    expect(screen.queryByRole('button', { name: /Inspect spend behavior/ })).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByRole('button', { name: /Inspect spend behavior/ })).toBeInTheDocument()
  })
  it('keeps hosted model and consent coherent across refresh and selection changes', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))

    const model = await screen.findByLabelText('Harness hosted model') as HTMLSelectElement
    const consent = screen.getByRole('checkbox') as HTMLInputElement
    expect(model).toHaveValue('gpt-a')
    expect(consent.checked).toBe(false)

    fireEvent.click(consent)
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh hosted models' }))
    await waitFor(() => expect((screen.getByLabelText('Harness hosted model') as HTMLSelectElement).value).toBe('gpt-a'))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)

    fireEvent.change(model, { target: { value: 'gpt-b' } })
    await waitFor(() => expect((screen.getByLabelText('Harness hosted model') as HTMLSelectElement).value).toBe('gpt-b'))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)

    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    fireEvent.change(screen.getByLabelText('Harness hosted provider'), { target: { value: 'anthropic' } })
    await waitFor(() => {
      expect(screen.getByLabelText('Harness hosted provider')).toHaveValue('anthropic')
      expect((screen.getByLabelText('Harness hosted model') as HTMLSelectElement).value).toBe('claude-a')
    })
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })

  it('presents an unexpected hosted probe failure as unknown instead of Ready or Not configured', async () => {
    advisorHostedProbe.mockRejectedValue(new Error('bridge unavailable'))
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))

    await waitFor(() => expect(screen.getByText('Runtime status unavailable')).toBeInTheDocument())
    expect(screen.getByText('OpenAI', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('Account: Unknown')).toBeInTheDocument()
    expect(screen.getByText('Connection: Unknown')).toBeInTheDocument()
    expect(screen.queryByText('Account: Ready')).not.toBeInTheDocument()
    expect(screen.queryByText('Account: Not configured')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Harness hosted model')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close runtime' }))
    expect(screen.queryByLabelText('Harness runtime configuration')).not.toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Runtime status unavailable')).toBeInTheDocument()
  })

  it('preserves provider-owned credential state and keeps reachability and model state separate', async () => {
    advisorHostedProbe.mockImplementation(async provider => ({
      provider,
      available: false,
      models: [],
      detail: 'The provider rejected the saved credential.',
      credentialState: 'invalid',
    }))
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    fireEvent.change(screen.getByLabelText('Harness hosted provider'), { target: { value: 'anthropic' } })

    await waitFor(() => expect(screen.getByText('Account: Invalid')).toBeInTheDocument())
    expect(screen.getByText('Connection: Reachable')).toBeInTheDocument()
    expect(screen.getByText('Model: Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Credential invalid')).toBeInTheDocument()
  })

  it('does not infer unreachable from a ready credential without provider reachability evidence', async () => {
    advisorHostedProbe.mockImplementation(async provider => ({
      provider,
      available: false,
      models: [],
      detail: 'The provider did not return usable models.',
      credentialState: 'ready',
    }))
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))

    await waitFor(() => expect(screen.getByText('Connection: Unavailable')).toBeInTheDocument())
    expect(screen.queryByText('Connection: Unreachable')).not.toBeInTheDocument()
    expect(screen.getByText('Provider unavailable')).toBeInTheDocument()
  })

  it('shows credential, reachability, and model compatibility as separate hosted states', async () => {
    advisorHostedProbe.mockImplementation(async provider => ({
      provider,
      available: true,
      models: [{ id: provider + '-model', label: provider + '-model', state: 'unverified', limitation: 'Not verified in this session.' }],
      detail: provider + ' is reachable.',
      credentialState: 'ready',
    }))
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))

    await waitFor(() => expect(screen.getByLabelText('Harness hosted model')).toHaveValue('openai-model'))
    expect(screen.getByText('Account: Ready')).toBeInTheDocument()
    expect(screen.getByText('Connection: Reachable')).toBeInTheDocument()
    expect(screen.getByText('Model: Check pending')).toBeInTheDocument()
    expect(screen.getByText('Checking model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close runtime' }).querySelector('.harness-v3-runtime-dot')).toHaveClass('unknown')
  })

  it.each([
    ['discovered', 'Checking model', 'unknown', 'Available'],
    ['unverified', 'Checking model', 'unknown', 'Check pending'],
    ['limited', 'Model limited', 'unknown', 'Limited'],
    ['verified', 'Ready', 'ready', 'Verified'],
    ['unsupported', 'Model unsupported', 'unavailable', 'Unavailable'],
    ['failed-conformance', 'Model check failed', 'unavailable', 'Check failed'],
  ] as Array<[AdvisorHostedModelState, string, 'ready' | 'unknown' | 'unavailable', string]>)('keeps hosted %s model compatibility distinct from generic Ready', async (state, expectedAvailability, expectedStatus, expectedModelState) => {
    advisorHostedProbe.mockImplementation(async provider => ({
      provider,
      available: true,
      models: [{ id: provider + '-model', label: provider + '-model', state, limitation: null }],
      detail: provider + ' is reachable.',
      credentialState: 'ready',
    }))
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))

    await waitFor(() => expect(screen.getByText(expectedAvailability, { selector: '.harness-v3-runtime-trigger-status' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Close runtime' }).querySelector('.harness-v3-runtime-dot')).toHaveClass(expectedStatus)
    expect(screen.getByText('Model: ' + expectedModelState)).toBeInTheDocument()
    if (state === 'failed-conformance') expect(screen.queryByLabelText('Harness hosted model')).not.toBeInTheDocument()
  })

  it('ignores a stale credential operation after switching hosted providers', async () => {
    let resolveCredential: ((value: { provider: 'openai' | 'anthropic' | 'gemini'; state: 'ready' }) => void) | undefined
    advisorHostedProbe.mockImplementation(async provider => provider === 'openai'
      ? { provider, available: false, models: [], detail: 'OpenAI credential is not configured.', credentialState: 'not-configured' as const }
      : { provider, available: true, models: [{ id: 'claude-a', label: 'claude-a', state: 'verified' as const, limitation: null }], detail: 'Anthropic provider is reachable.', credentialState: 'ready' as const })
    advisorCredentialSet.mockImplementation(() => new Promise(resolve => { resolveCredential = resolve }))
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    const entry = await screen.findByLabelText('Harness provider key')
    fireEvent.change(entry, { target: { value: 'test-key-value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    fireEvent.change(screen.getByLabelText('Harness hosted provider'), { target: { value: 'anthropic' } })
    await waitFor(() => expect(screen.getByLabelText('Harness hosted provider')).toHaveValue('anthropic'))
    await waitFor(() => expect(screen.getByLabelText('Harness hosted model')).toHaveValue('claude-a'))
    resolveCredential?.({ provider: 'openai', state: 'ready' })
    await waitFor(() => expect(screen.getByLabelText('Harness hosted provider')).toHaveValue('anthropic'))
    expect(screen.getByLabelText('Harness hosted model')).toHaveValue('claude-a')
    expect(screen.queryByText('OpenAI · gpt-a')).not.toBeInTheDocument()
  })

  it('does not verify the newly selected hosted model from a stale first-request callback', async () => {
    let reportConformance: (() => void) | undefined
    investigate.mockImplementation(input => {
      reportConformance = input.onConformance
      return new Promise<AdvisorAnswer>(() => {})
    })
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    const model = await screen.findByLabelText('Harness hosted model') as HTMLSelectElement
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    await submitQuestion('Keep model A verification scoped to model A')

    fireEvent.change(model, { target: { value: 'gpt-b' } })
    await waitFor(() => expect(model).toHaveValue('gpt-b'))
    reportConformance?.()

    expect(screen.getByText('Model: Available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close runtime' }).querySelector('.harness-v3-runtime-dot')).toHaveClass('unknown')
  })

  it('does not append a hosted answer after switching providers during an active request', async () => {
    let resolveInvestigation: ((value: AdvisorAnswer) => void) | undefined
    investigate.mockImplementation(() => new Promise(resolve => { resolveInvestigation = resolve }))
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    await screen.findByLabelText('Harness hosted model')
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    await submitQuestion('Do not retain this stale answer')
    fireEvent.change(screen.getByLabelText('Harness hosted provider'), { target: { value: 'anthropic' } })
    await waitFor(() => expect(screen.getByLabelText('Harness hosted provider')).toHaveValue('anthropic'))
    resolveInvestigation?.(answer)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText(answer.conclusion)).not.toBeInTheDocument()
  })

  it('does not append a hosted answer after refreshing runtime state during an active request', async () => {
    let resolveInvestigation: ((value: AdvisorAnswer) => void) | undefined
    investigate.mockImplementation(() => new Promise(resolve => { resolveInvestigation = resolve }))
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    await screen.findByLabelText('Harness hosted model')
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    await submitQuestion('Do not retain this stale answer after refresh')
    const probeCalls = advisorHostedProbe.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh hosted models' }))
    await waitFor(() => expect(advisorHostedProbe.mock.calls.length).toBe(probeCalls + 1))
    resolveInvestigation?.(answer)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText(answer.conclusion)).not.toBeInTheDocument()
  })

  it('does not append a hosted answer after removing the credential during an active request', async () => {
    let resolveInvestigation: ((value: AdvisorAnswer) => void) | undefined
    investigate.mockImplementation(() => new Promise(resolve => { resolveInvestigation = resolve }))
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    await screen.findByLabelText('Harness hosted model')
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    await submitQuestion('Do not retain this stale answer after credential removal')
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))
    await waitFor(() => expect(advisorCredentialClear).toHaveBeenCalledTimes(1))
    resolveInvestigation?.(answer)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText(answer.conclusion)).not.toBeInTheDocument()
  })

  it('keeps all hosted BYOK providers available through the disclosed configuration', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    await screen.findByLabelText('Harness hosted model')

    fireEvent.change(screen.getByLabelText('Harness hosted provider'), { target: { value: 'gemini' } })
    await waitFor(() => expect(screen.getByLabelText('Harness hosted model')).toHaveValue('gemini-a'))
    expect(screen.getByText('Account: Ready')).toBeInTheDocument()
  })
})
