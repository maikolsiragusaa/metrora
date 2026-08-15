import type { GranularHistory } from './granular-history.js'
import type { DailyHistoryEntry, MenubarPayload } from './menubar-json.js'

const HISTORY_DAYS_LIMIT = 365

/** Builds both the dashboard backfill and the exact period authority for companion trends. */
export function buildMenubarHistory(
  daily: DailyHistoryEntry[] | undefined,
  timeline?: GranularHistory,
  periodDaily?: DailyHistoryEntry[],
): MenubarPayload['history'] {
  const exactPeriod = periodDaily && periodDaily.length > 0
    ? [...periodDaily].sort((a, b) => a.date.localeCompare(b.date))
    : undefined
  const history = daily && daily.length > 0
    ? [...daily].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_DAYS_LIMIT)
    : []
  return {
    daily: history,
    ...(exactPeriod ? { periodDaily: exactPeriod } : {}),
    ...(timeline ? { timeline } : {}),
  }
}
