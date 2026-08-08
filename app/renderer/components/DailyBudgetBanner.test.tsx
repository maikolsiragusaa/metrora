// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { localDateKey } from '../lib/period'
import type { MenubarPayload } from '../lib/types'
import { DailyBudgetBanner } from './DailyBudgetBanner'

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key),
  clear: () => stored.clear(),
})

function payload(overrides: { cost?: number; inputTokens?: number; outputTokens?: number } = {}): MenubarPayload {
  const date = localDateKey(new Date())
  return {
    history: {
      daily: [{
        date,
        cost: overrides.cost ?? 0,
        inputTokens: overrides.inputTokens ?? 0,
        outputTokens: overrides.outputTokens ?? 0,
        savingsUSD: 0,
        calls: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        topModels: [],
      }],
    },
  } as unknown as MenubarPayload
}

describe('DailyBudgetBanner', () => {
  beforeEach(() => {
    stored.clear()
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'))
  })

  it('stays hidden without a configured budget or below the warning threshold', () => {
    const { rerender } = render(<DailyBudgetBanner payload={payload({ cost: 100 })} provider="all" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    localStorage.setItem('metrora.dailyBudget', JSON.stringify({ kind: 'usd', value: 100 }))
    rerender(<DailyBudgetBanner payload={payload({ cost: 79 })} provider="all" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('warns at 80 percent and alerts at 100 percent', () => {
    localStorage.setItem('metrora.dailyBudget', JSON.stringify({ kind: 'usd', value: 10 }))
    const { rerender } = render(<DailyBudgetBanner payload={payload({ cost: 8 })} provider="all" />)
    expect(screen.getByText("Today's spend is at 80% of your daily budget")).toBeInTheDocument()

    rerender(<DailyBudgetBanner payload={payload({ cost: 12.34 })} provider="all" />)
    expect(screen.getByText('Daily budget exceeded: $12.34 of $10.00')).toBeInTheDocument()
  })

  it('dismisses the alert for the current local day', () => {
    localStorage.setItem('metrora.dailyBudget', JSON.stringify({ kind: 'usd', value: 10 }))
    render(<DailyBudgetBanner payload={payload({ cost: 12.34 })} provider="all" />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(localStorage.getItem('metrora.dailyBudget.dismissed')).toBe(localDateKey(new Date()))
  })

  it('evaluates token budgets only on the all-providers scope', () => {
    localStorage.setItem('metrora.dailyBudget', JSON.stringify({ kind: 'tokens', value: 90_000 }))
    const usage = payload({ inputTokens: 60_000, outputTokens: 40_000 })
    const { rerender } = render(<DailyBudgetBanner payload={usage} provider="all" />)
    expect(screen.getByText('Daily budget exceeded: 100K of 90K')).toBeInTheDocument()

    rerender(<DailyBudgetBanner payload={usage} provider="claude" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
