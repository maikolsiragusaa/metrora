// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Polled } from '../hooks/usePolled'
import type { MenubarPayload } from '../lib/types'
import type { AdvisorHostedProviderId } from '../advisor/types'
import { Advisor } from './Advisor'

const { advisorProbe, advisorHostedProbe, advisorHostedChat, advisorHostedCancel, hostedEventSubscription } = vi.hoisted(() => ({
  advisorProbe: vi.fn(),
  advisorHostedProbe: vi.fn(),
  advisorHostedChat: vi.fn(),
  advisorHostedCancel: vi.fn(),
  hostedEventSubscription: vi.fn(),
}))

vi.mock('../lib/ipc', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/ipc')>()
  return {
    ...actual,
    metrora: {
      ...actual.metrora,
      advisorProbe,
      advisorHostedProbe,
      advisorHostedChat,
      advisorHostedCancel,
      onAdvisorHostedEvent: hostedEventSubscription,
      advisorCredentialSet: vi.fn(async (provider: AdvisorHostedProviderId) => ({ provider, state: 'ready' as const })),
      advisorCredentialClear: vi.fn(async (provider: AdvisorHostedProviderId) => ({ provider, state: 'not-configured' as const })),
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

describe('Advisor hosted submit integration', () => {
  beforeEach(() => {
    advisorProbe.mockReset().mockResolvedValue({ available: false, models: [], detail: 'Ollama is not running.' })
    advisorHostedProbe.mockReset().mockImplementation(async (provider: AdvisorHostedProviderId) => provider === 'openrouter'
      ? {
          provider,
          available: true,
          models: [{
            id: 'openrouter/auto',
            label: 'openrouter/auto',
            state: 'unverified',
            limitation: 'Compatibility unverified.',
            capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'unknown' },
          }],
          detail: 'OpenRouter is reachable.',
          credentialState: 'ready',
        }
      : { provider, available: false, models: [], detail: 'OpenAI is not configured.', credentialState: 'not-configured' })
    advisorHostedChat.mockReset().mockResolvedValue({
      provider: 'openrouter',
      model: 'openrouter/auto',
      message: { content: 'Ciao! Sto bene, grazie.', tool_calls: [] },
      usage: null,
      streamed: false,
    })
    advisorHostedCancel.mockReset().mockResolvedValue(false)
    hostedEventSubscription.mockReset().mockReturnValue(() => {})
  })

  it('runs the real Advisor kernel for a ready OpenRouter social turn and clears the composer', async () => {
    render(<Advisor period="week" provider="all" projectScopeId="all" range={null} overview={overview} detectedProviders={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configure runtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted provider' }))
    fireEvent.change(screen.getByLabelText('Advisor hosted provider'), { target: { value: 'openrouter' } })
    await waitFor(() => expect(screen.getByLabelText('Advisor hosted model')).toHaveValue('openrouter/auto'))
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())

    const composer = screen.getByRole('textbox', { name: 'Ask Metrora Advisor' })
    fireEvent.change(composer, { target: { value: 'ciao come stai' } })
    fireEvent.click(screen.getByRole('button', { name: /Investigate/ }))

    expect(await screen.findByText('Ciao! Sto bene, grazie.')).toBeInTheDocument()
    expect(composer).toHaveValue('')
    expect(advisorHostedChat).toHaveBeenCalledOnce()
    expect(advisorHostedChat.mock.calls[0]?.[1]).toMatchObject({ provider: 'openrouter', model: 'openrouter/auto', tools: [], consent: true })
  })
})
