// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuditRow, ModelPricingSummary, ModelReportRow } from '../lib/types'
import { Models } from './Models'

const { getModels, getAudit, getOverview } = vi.hoisted(() => ({
  getModels: vi.fn(),
  getAudit: vi.fn(),
  getOverview: vi.fn(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, codeburn: { getModels, getAudit, getOverview } }
})

function pricing(totalCalls: number, unavailable = false): ModelPricingSummary {
  return unavailable
    ? { state: 'unavailable', totalCalls, coveredCalls: 0, pricedCalls: 0, explicitZeroCalls: 0, unavailableCalls: totalCalls, unknownCalls: 0, missingPriceRecordCalls: totalCalls }
    : { state: 'priced', totalCalls, coveredCalls: totalCalls, pricedCalls: totalCalls, explicitZeroCalls: 0, unavailableCalls: 0, unknownCalls: 0, missingPriceRecordCalls: 0 }
}

const liveRows: ModelReportRow[] = [
  {
    provider: 'codex',
    providerDisplayName: 'Codex',
    model: 'gpt-5.4',
    modelDisplayName: 'GPT-5.4',
    category: null,
    inputTokens: 100_000_000,
    outputTokens: 8_000_000,
    cacheWriteTokens: 4_000_000,
    cacheReadTokens: 80_000_000,
    totalTokens: 192_000_000,
    costUSD: 409.3,
    savingsUSD: 0,
    savingsBaselineModel: '',
    calls: 6439,
    pricing: pricing(6439),
    credits: null,
  },
]

const durablePayload = {
  current: {
    topModels: [
      { name: 'GPT-5.4', cost: 1456.252943, savingsUSD: 0, savingsBaselineModel: '', calls: 22275 },
    ],
  },
} as any

const byTaskRows: ModelReportRow[] = [
  { ...liveRows[0], category: 'coding', calls: 5000, costUSD: 320, pricing: pricing(5000) },
  { ...liveRows[0], category: 'debugging', calls: 1439, costUSD: 89.3, pricing: pricing(1439) },
]

const auditRows: AuditRow[] = [
  {
    provider: 'codex',
    providerDisplayName: 'Codex',
    model: 'gpt-5.4',
    modelDisplayName: 'GPT-5.4',
    calls: 6439,
    raw: { inputTokens: 100_000_000, outputTokens: 7_000_000, reasoningTokens: 1_000_000, cacheCreationInputTokens: 4_000_000, cacheReadInputTokens: 80_000_000, cachedInputTokens: 0, webSearchRequests: 0 },
    displayed: { inputTokens: 100_000_000, outputTokens: 8_000_000, cacheWriteTokens: 4_000_000, cacheReadTokens: 80_000_000 },
    rates: null,
    cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, recomputedTotalUSD: 0 },
    attributedCostUSD: 409.3,
  },
]

describe('Models', () => {
  beforeEach(() => {
    getModels.mockReset()
    getAudit.mockReset()
    getOverview.mockReset()
    getModels.mockResolvedValue(liveRows)
    getOverview.mockResolvedValue(durablePayload)
  })

  it('uses durable accounting as the primary by-model surface and labels surviving detail separately', async () => {
    render(<Models period="lifetime" provider="all" />)

    expect(await screen.findByText('Historical accounting')).toBeInTheDocument()
    expect(screen.getByText('$1,456.25')).toBeInTheDocument()
    expect(screen.getByText('22,275')).toBeInTheDocument()
    expect(screen.getAllByText('Available session detail')).toHaveLength(1)
    expect(await screen.findByText('$409.30')).toBeInTheDocument()
    expect(screen.getByText('6,439')).toBeInTheDocument()
    expect(screen.getByText(/same accounting authority used by Home/i)).toBeInTheDocument()
    expect(screen.getByText(/may be a subset of historical accounting/i)).toBeInTheDocument()
  })

  it('keeps by-task as explicitly surviving-session detail', async () => {
    getModels.mockResolvedValueOnce(liveRows).mockResolvedValueOnce(byTaskRows)
    render(<Models period="week" provider="codex" />)

    expect(await screen.findByText('Historical accounting')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'By task' }))

    await waitFor(() => expect(getModels).toHaveBeenCalledWith('week', 'codex', true))
    expect(await screen.findByText('coding')).toBeInTheDocument()
    expect(screen.getByText('debugging')).toBeInTheDocument()
    expect(screen.getByText(/Task attribution requires original session records/i)).toBeInTheDocument()
  })

  it('preserves pricing evidence and unavailable-cost presentation in surviving detail', async () => {
    getModels.mockResolvedValue([
      {
        ...liveRows[0],
        provider: 'custom',
        providerDisplayName: 'Custom',
        model: 'proxy-model',
        modelDisplayName: 'Proxy model',
        costUSD: 0,
        calls: 10,
        pricing: pricing(10, true),
      },
    ])

    render(<Models period="30days" provider="all" />)

    expect(await screen.findByText('Proxy model')).toBeInTheDocument()
    expect(screen.getByText('Price unavailable')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Cost unavailable' })).toHaveTextContent('—')
    expect(screen.getByText('add alias ›')).toBeInTheDocument()
  })

  it('keeps the audit lens as call-level surviving-session evidence', async () => {
    getAudit.mockResolvedValue(auditRows)
    render(<Models period="30days" provider="all" />)

    expect(await screen.findByText('Historical accounting')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }))

    expect(await screen.findByText('7M')).toBeInTheDocument()
    expect(screen.getByText('1M')).toBeInTheDocument()
    expect(screen.getByText('$409.30')).toBeInTheDocument()
    expect(screen.getByText('est')).toBeInTheDocument()
  })

  it('passes the exact custom range to durable and surviving authorities', async () => {
    const range = { from: '2026-07-01', to: '2026-07-31' }
    render(<Models period="30days" provider="codex" range={range} />)

    await screen.findByText('Historical accounting')
    expect(getOverview).toHaveBeenCalledWith('30days', 'codex', range)
    expect(getModels).toHaveBeenCalledWith('30days', 'codex', false, range)
  })
})
