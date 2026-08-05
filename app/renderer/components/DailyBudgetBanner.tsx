import { useState } from 'react'

import { readDailyBudget } from '../lib/budget'
import { formatCompact, formatUsd } from '../lib/format'
import { localDateKey } from '../lib/period'
import { readCompatStorage, writeCompatStorage } from '../lib/storage'
import type { MenubarPayload } from '../lib/types'

export type DailyBudgetBannerProps = {
  payload: MenubarPayload | null
  provider: string
}

/**
 * App-wide daily-budget alert. Token budgets are intentionally hidden under a
 * provider filter because provider-scoped daily history cannot attribute tokens
 * truthfully; USD budgets remain valid because provider cost is preserved.
 */
export function DailyBudgetBanner({ payload, provider }: DailyBudgetBannerProps) {
  const [, bumpDismiss] = useState(0)
  const budget = readDailyBudget()
  if (!budget || !payload) return null
  if (budget.kind === 'tokens' && provider !== 'all') return null

  const todayKey = localDateKey(new Date())
  if (readCompatStorage('dailyBudget.dismissed') === todayKey) return null

  const entry = payload.history.daily.find(day => day.date === todayKey)
  const used = budget.kind === 'usd'
    ? entry?.cost ?? 0
    : entry ? entry.inputTokens + entry.outputTokens : 0
  const percent = (used / budget.value) * 100
  if (percent < 80) return null

  const exceeded = percent >= 100
  const spent = budget.kind === 'usd' ? formatUsd(used) : formatCompact(used)
  const cap = budget.kind === 'usd' ? formatUsd(budget.value) : formatCompact(budget.value)
  const text = exceeded
    ? `Daily budget exceeded: ${spent} of ${cap}`
    : `Today's spend is at ${Math.floor(percent)}% of your daily budget`

  const dismiss = () => {
    writeCompatStorage('dailyBudget.dismissed', todayKey)
    bumpDismiss(tick => tick + 1)
  }

  return (
    <div role="status" className={exceeded ? 'budget-banner exceeded' : 'budget-banner'}>
      <span>{text}</span>
      <button type="button" className="set-text-button" onClick={dismiss}>Dismiss</button>
    </div>
  )
}
