// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Polled } from '../hooks/usePolled'
import type { MenubarPayload } from '../lib/types'
import { Advisor } from './Advisor'

const { advisorProbe } = vi.hoisted(() => ({
  advisorProbe: vi.fn(async () => ({ available: false, models: [], detail: 'Ollama is not running.' })),
}))
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

describe('Advisor workspace', () => {
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
})
