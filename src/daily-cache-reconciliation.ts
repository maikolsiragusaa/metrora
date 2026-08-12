import type { DailyEntry } from './daily-cache-types.js'

/** Empty primary row used to tombstone one provider slice during reconciliation. */
export function emptyDailyEntry(date: string): DailyEntry {
  return {
    date,
    cost: 0,
    savingsUSD: 0,
    calls: 0,
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: {},
    categories: {},
    providers: {},
  }
}
