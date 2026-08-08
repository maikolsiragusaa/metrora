// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReasoningMix, SessionRow } from '../lib/types'
import { reasoningMixLabel, Sessions } from './Sessions'

const getSessions = vi.hoisted(() => vi.fn())

vi.mock('../lib/ipc', () => ({
  metrora: { getSessions },
}))

function reasoningMix(level: 'unknown' | 'xhigh', totalCalls = 1): ReasoningMix {
  return {
    totalCalls,
    knownCalls: level === 'unknown' ? 0 : totalCalls,
    coverage: level === 'unknown' ? 0 : 1,
    rows: totalCalls === 0 ? [] : [{
      level,
      calls: totalCalls,
      callShare: 1,
      generatedTokens: 0,
      reasoningTokens: 0,
      costUSD: 0,
      sources: level === 'unknown' ? [] : ['explicit'],
    }],
  }
}

function session(): SessionRow {
  return {
    sessionId: 'claude/abc:123',
    title: 'Investigate cache',
    project: 'projects/metrora',
    provider: 'claude',
    models: ['model-a'],
    reasoningMix: reasoningMix('unknown'),
    reasoningTokens: undefined,
    startedAt: '2026-08-04T08:00:00.000Z',
    endedAt: '2026-08-04T08:05:00.000Z',
    durationMs: 300_000,
    cost: 2,
    savingsUSD: 0,
    calls: 1,
    turns: 2,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  } as SessionRow
}

describe('Sessions dense-report legibility', () => {
  beforeEach(() => {
    getSessions.mockReset()
  })

  it('distinguishes unavailable, unattributed, unidentified, and extra-high reasoning', () => {
    expect(reasoningMixLabel()).toBe('Not available')
    expect(reasoningMixLabel(reasoningMix('unknown', 0))).toBe('No attributed calls')
    expect(reasoningMixLabel(reasoningMix('unknown'))).toBe('Not identified')
    expect(reasoningMixLabel(reasoningMix('xhigh'))).toBe('Extra high')
  })

  it('names session controls, connects details, and announces sort and grouping state', async () => {
    const user = userEvent.setup()
    getSessions.mockResolvedValue([session()])

    render(<Sessions period="30days" provider="all" />)

    const sessionRow = await screen.findByRole('button', {
      name: /Open session: Investigate cache\. Project projects\/metrora\. Session ID claude\/abc:123\./i,
    })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Sessions sorted by most recent, not grouped by provider. 1 session after filters.')

    const row = sessionRow
    expect(row).toHaveAttribute('aria-controls', 'session-details-claude-abc-123')
    expect(row).toHaveAttribute('aria-expanded', 'false')

    await user.click(row)

    const detail = screen.getByRole('region', { name: 'projects/metrora session details' })
    expect(detail.closest('td')).toHaveAttribute('id', 'session-details-claude-abc-123')
    expect(screen.getByRole('button', { name: /Collapse session: Investigate cache/i })).toHaveAttribute('aria-expanded', 'true')
    expect(within(detail).getByText('No comparable input')).toBeInTheDocument()
    expect(within(detail).getByText('Reasoning-token count unavailable')).toBeInTheDocument()
    expect(within(detail).getAllByText('Not identified').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('tab', { name: 'Cost' }))
    await waitFor(() => expect(status).toHaveTextContent('Sessions sorted by highest cost'))

    await user.click(screen.getByRole('button', { name: 'Group by provider' }))
    await waitFor(() => expect(status).toHaveTextContent('grouped by provider'))
  })
})
