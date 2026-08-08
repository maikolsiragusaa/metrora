import type { DateRange, Period } from '../lib/types'

/** Shared memo-key authority for the visible Overview poll and background warming. */
export function overviewMemoKey(provider: string, period: Period, range: DateRange | null, configSource: string | null): string {
  return `overview|${provider}|${period}|${range?.from ?? ''}-${range?.to ?? ''}|${configSource ?? ''}`
}

/** Intentionally disabled: ordinary canonical snapshot reads are bounded, while
 * speculative warming multiplied CLI processes without making data fresher. */
export function useProviderPrefetch(_options: unknown): void {}
