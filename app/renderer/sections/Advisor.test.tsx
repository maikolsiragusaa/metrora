// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Polled } from '../hooks/usePolled'
import type { MenubarPayload } from '../lib/types'
import type { AdvisorAnswer } from '../advisor/types'
import { Advisor } from './Advisor'

const { advisorProbe, investigate } = vi.hoisted(() => ({
  advisorProbe: vi.fn(async () => ({ available: false, models: [], detail: 'Ollama is not running.' })),
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
const answer = {
  conclusion: 'Verified RESPONSE needle.', scopeLabel: 'Last 7 days · All projects · All providers', periodLabel: 'Last 7 days',
  evidence: [], coverage: { level: 'partial', label: 'Partial', detail: 'Test evidence.' }, assumptions: [], unknown: [], nextInvestigations: [], details: [],
  runtime: { id: 'test', label: 'Test', mode: 'deterministic-local' },
} satisfies AdvisorAnswer

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
