// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Polled } from '../hooks/usePolled'
import type { MenubarPayload } from '../lib/types'
import { createAdvisorContextualLaunch } from '../advisor/context'
import type { AdvisorAnswer } from '../advisor/types'
import { Advisor } from './Advisor'

const { advisorProbe, advisorHostedProbe, investigate } = vi.hoisted(() => ({
  advisorProbe: vi.fn(async (runtime: 'ollama' | 'lmstudio' = 'ollama') => runtime === 'lmstudio'
    ? { runtime: 'lmstudio' as const, available: true, models: ['qwen/qwen3-8b'], detail: 'Local LM Studio is reachable.', discoveryState: 'models-discovered' as const, capabilities: [{ schemaVersion: 1 as const, runtime: 'lmstudio' as const, modelId: 'qwen/qwen3-8b', discovery: 'discovered' as const, conversational: 'available' as const, toolCall: 'unknown' as const, streaming: 'supported' as const, limitation: 'Tool support varies by model.' }] }
    : { available: false, models: [], detail: 'Ollama is not running.' }),
  investigate: vi.fn(),
  advisorHostedProbe: vi.fn(),
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
      advisorChat: vi.fn(),
      advisorCancel: vi.fn(async () => false),
      onAdvisorDelta: vi.fn(() => () => {}),
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

async function submitQuestion(question: string): Promise<void> {
  const previousCalls = investigate.mock.calls.length
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask Metrora Advisor' }), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: /Investigate/ }))
  await waitFor(() => expect(investigate.mock.calls).toHaveLength(previousCalls + 1))
}

describe('Advisor workspace', () => {
  beforeEach(() => {
    advisorProbe.mockClear()
    advisorHostedProbe.mockReset().mockImplementation(async (provider: 'openai' | 'anthropic' | 'gemini') => ({
      provider,
      available: true,
      models: provider === 'openai'
        ? [{ id: 'gpt-a', label: 'gpt-a', state: 'discovered', limitation: null }, { id: 'gpt-b', label: 'gpt-b', state: 'discovered', limitation: null }]
        : provider === 'anthropic'
          ? [{ id: 'claude-a', label: 'claude-a', state: 'discovered', limitation: null }]
          : [{ id: 'gemini-a', label: 'gemini-a', state: 'discovered', limitation: null }],
      detail: 'Hosted provider is reachable.',
      credentialState: 'ready',
    }))
    investigate.mockReset().mockResolvedValue(answer)
  })
  it('opens with useful prompt families, explicit scope, local history, and evidence rail', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)

    expect(screen.getByRole('heading', { name: 'Ask Metrora' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Ask Metrora Advisor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /What changed in my spend recently/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /What quota remains/ })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Advisor conversations' })).toHaveTextContent('Session-local history')
    expect(screen.getByRole('complementary', { name: 'Advisor evidence' })).toHaveTextContent('Ask a question to pin its evidence')
    expect(screen.getByRole('button', { name: 'Configure runtime' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Advisor runtime')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Advisor hosted provider')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Offline evidence fallback')).toBeInTheDocument())
    expect(screen.getByText('Ollama')).toBeInTheDocument()
    expect(screen.getByText('Runtime unavailable')).toBeInTheDocument()
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

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Ask Metrora Advisor' })).toHaveValue('What changed in measured spend in this scope, and which drivers are visible?')
      expect(screen.getByLabelText('Advisor period')).toHaveValue('30days')
      expect(screen.getByLabelText('Advisor provider')).toHaveValue('codex')
      expect(screen.getByLabelText('Advisor Project')).toHaveValue('project-a')
      expect(screen.getByLabelText('Advisor model')).toHaveValue('gpt-safe')
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

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ask Metrora Advisor' })).toHaveValue('What current provider-reported capacity and reset windows are available across the connected providers?'))
    expect(screen.getByText('From Plans')).toBeInTheDocument()
    expect(screen.getByText(/Provider-reported now · All providers; Project and history do not scope Capacity/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Advisor period')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Advisor Project')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Advisor provider')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Advisor model')).not.toBeInTheDocument()
    expect(investigate).not.toHaveBeenCalled()
  })
  it('renders direct answer hierarchy while keeping deeper evidence in progressive disclosure', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    await submitQuestion('Inspect spend behavior')

    expect(screen.getByText(answer.conclusion)).toBeInTheDocument()
    expect(screen.getByText('Why')).toBeInTheDocument()
    expect(screen.getByText('Primary driver.')).toBeInTheDocument()
    expect(screen.getByText('Important limit')).toBeInTheDocument()
    expect(screen.getByText('Interpretation is bounded.')).toBeInTheDocument()
    expect(screen.getByText('Next step')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect the evidence' })).toBeInTheDocument()
    expect(screen.getByText('Evidence & details')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByText('Offline evidence fallback')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.change(screen.getByLabelText('Advisor runtime'), { target: { value: 'lmstudio' } })
    await waitFor(() => expect(screen.getByLabelText('Advisor local runtime model')).toHaveValue('qwen/qwen3-8b'))
    expect(screen.getByText(/LM Studio · qwen\/qwen3-8b/)).toBeInTheDocument()
    expect(screen.getByText(/tool support varies by model/)).toBeInTheDocument()
  })

  it('retries the exact failed request in its original conversation and scope without duplicating the user message', async () => {
    investigate.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(answer)
    const { container } = render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[{ id: 'codex', label: 'Codex' }]} />)
    const question = 'Inspect spend behavior'
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Metrora Advisor' }), { target: { value: question } })
    fireEvent.click(screen.getByRole('button', { name: /Investigate/ }))
    await screen.findByRole('alert')
    fireEvent.change(screen.getByLabelText('Advisor provider'), { target: { value: 'codex' } })
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
    fireEvent.change(screen.getByLabelText('Advisor Project'), { target: { value: 'project-a' } })
    await waitFor(() => expect(screen.getByLabelText('Advisor Project')).toHaveValue('project-a'))
    await submitQuestion('Project B question')

    expect(investigate.mock.calls[1]?.[0].conversation).toEqual([])
    expect(screen.getAllByText('Project A question').length).toBeGreaterThan(0)
  })

  it('excludes factual context after a period change', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    await submitQuestion('Weekly question')
    fireEvent.change(screen.getByLabelText('Advisor period'), { target: { value: '30days' } })
    await waitFor(() => expect(screen.getByLabelText('Advisor period')).toHaveValue('30days'))
    await submitQuestion('Thirty day question')

    expect(investigate.mock.calls[1]?.[0].conversation).toEqual([])
  })

  it('excludes factual context after an explicit range change', async () => {
    const view = render(<Advisor period="week" provider="all" projectScopeId="all" range={{ from: '2026-08-01', to: '2026-08-07' }} overview={overview} detectedProviders={[]} />)
    await submitQuestion('First range question')
    view.rerender(<Advisor period="week" provider="all" projectScopeId="all" range={{ from: '2026-08-08', to: '2026-08-14' }} overview={overview} detectedProviders={[]} />)
    await waitFor(() => expect(screen.getByText(/Aug 8/)).toBeInTheDocument())
    await submitQuestion('Second range question')

    expect(investigate.mock.calls[1]?.[0].conversation).toEqual([])
  })

  it('excludes factual context after provider and model changes', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overviewWithOptions} detectedProviders={[{ id: 'codex', label: 'Codex' }]} />)
    await submitQuestion('All provider question')
    fireEvent.change(screen.getByLabelText('Advisor provider'), { target: { value: 'codex' } })
    await waitFor(() => expect(screen.getByLabelText('Advisor provider')).toHaveValue('codex'))
    await submitQuestion('Codex question')
    expect(investigate.mock.calls[1]?.[0].conversation).toEqual([])

    fireEvent.change(screen.getByLabelText('Advisor model'), { target: { value: 'gpt-safe' } })
    await waitFor(() => expect(screen.getByLabelText('Advisor model')).toHaveValue('gpt-safe'))
    await submitQuestion('Model question')
    expect(investigate.mock.calls[2]?.[0].conversation).toEqual([])
  })

  it('searches conversation titles, questions, and answers case-insensitively and can clear the query', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Metrora Advisor' }), { target: { value: 'Inspect spend behavior' } })
    fireEvent.click(screen.getByRole('button', { name: /Investigate/ }))
    await screen.findByText(answer.conclusion)
    fireEvent.click(screen.getByRole('button', { name: /New chat/ }))
    const search = screen.getByRole('textbox', { name: 'Search Advisor history' })
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

    const model = await screen.findByLabelText('Advisor hosted model') as HTMLSelectElement
    const consent = screen.getByRole('checkbox') as HTMLInputElement
    expect(model).toHaveValue('gpt-a')
    expect(consent.checked).toBe(false)

    fireEvent.click(consent)
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh hosted models' }))
    await waitFor(() => expect((screen.getByLabelText('Advisor hosted model') as HTMLSelectElement).value).toBe('gpt-a'))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)

    fireEvent.change(model, { target: { value: 'gpt-b' } })
    await waitFor(() => expect((screen.getByLabelText('Advisor hosted model') as HTMLSelectElement).value).toBe('gpt-b'))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)

    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    fireEvent.change(screen.getByLabelText('Advisor hosted provider'), { target: { value: 'anthropic' } })
    await waitFor(() => {
      expect(screen.getByLabelText('Advisor hosted provider')).toHaveValue('anthropic')
      expect((screen.getByLabelText('Advisor hosted model') as HTMLSelectElement).value).toBe('claude-a')
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
    expect(screen.getByText('Credential: Unknown')).toBeInTheDocument()
    expect(screen.getByText('Reachability: Unknown')).toBeInTheDocument()
    expect(screen.queryByText('Credential: Ready')).not.toBeInTheDocument()
    expect(screen.queryByText('Credential: Not configured')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Advisor hosted model')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close runtime' }))
    expect(screen.queryByLabelText('Advisor runtime configuration')).not.toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText('Advisor hosted provider'), { target: { value: 'anthropic' } })

    await waitFor(() => expect(screen.getByText('Credential: Invalid')).toBeInTheDocument())
    expect(screen.getByText('Reachability: Reachable')).toBeInTheDocument()
    expect(screen.getByText('Model: Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Credential invalid')).toBeInTheDocument()
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

    await waitFor(() => expect(screen.getByLabelText('Advisor hosted model')).toHaveValue('openai-model'))
    expect(screen.getByText('Credential: Ready')).toBeInTheDocument()
    expect(screen.getByText('Reachability: Reachable')).toBeInTheDocument()
    expect(screen.getByText('Model: Unverified')).toBeInTheDocument()
    expect(screen.getByText('Model unverified')).toBeInTheDocument()
  })

  it('keeps all hosted BYOK providers available through the disclosed configuration', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    await screen.findByLabelText('Advisor hosted model')

    fireEvent.change(screen.getByLabelText('Advisor hosted provider'), { target: { value: 'gemini' } })
    await waitFor(() => expect(screen.getByLabelText('Advisor hosted model')).toHaveValue('gemini-a'))
    expect(screen.getByText('Credential: Ready')).toBeInTheDocument()
  })
})
