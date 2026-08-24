// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Polled } from '../hooks/usePolled'
import type { MenubarPayload } from '../lib/types'
import type { AdvisorAnswer } from '../advisor/types'
import { Advisor } from './Advisor'

const { advisorProbe, investigate } = vi.hoisted(() => ({
  advisorProbe: vi.fn(async (runtime: 'ollama' | 'lmstudio' = 'ollama') => runtime === 'lmstudio'
    ? { runtime: 'lmstudio' as const, available: true, models: ['qwen/qwen3-8b'], detail: 'Local LM Studio is reachable.', discoveryState: 'models-discovered' as const, capabilities: [{ schemaVersion: 1 as const, runtime: 'lmstudio' as const, modelId: 'qwen/qwen3-8b', discovery: 'discovered' as const, conversational: 'available' as const, toolCall: 'unknown' as const, streaming: 'supported' as const, limitation: 'Tool support varies by model.' }] }
    : { available: false, models: [], detail: 'Ollama is not running.' }),
  investigate: vi.fn(),
}))
vi.mock('../advisor/kernel', () => ({ createAdvisorKernel: () => ({ investigate }) }))
vi.mock('../lib/ipc', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/ipc')>()
  return {
    ...actual,
    metrora: {
      ...actual.metrora,
      advisorProbe,
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
  evidence: [], coverage: { level: 'partial', label: 'Partial', detail: 'Test evidence.' }, assumptions: [], unknown: [], nextInvestigations: [], details: [],
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
    await waitFor(() => expect(screen.getByText('Offline evidence fallback')).toBeInTheDocument())
    expect(advisorProbe).toHaveBeenCalledTimes(1)
  })

  it('switches between supported local runtimes and discovers its models factually', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    await waitFor(() => expect(screen.getByText('Offline evidence fallback')).toBeInTheDocument())
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
})
