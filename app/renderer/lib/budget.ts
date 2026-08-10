import { readStorage } from './storage'

// Renderer-only daily budget setting. Canonical storage is metrora.dailyBudget.
export type DailyBudget = { kind: 'usd' | 'tokens'; value: number }

/** Parse the persisted budget, returning null when absent or malformed. */
export function readDailyBudget(): DailyBudget | null {
  const raw = readStorage('dailyBudget')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DailyBudget>
    if (
      (parsed.kind === 'usd' || parsed.kind === 'tokens')
      && typeof parsed.value === 'number'
      && Number.isFinite(parsed.value)
      && parsed.value > 0
    ) {
      return { kind: parsed.kind, value: parsed.value }
    }
  } catch {
    // Malformed persisted JSON is ignored.
  }
  return null
}
