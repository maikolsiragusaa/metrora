export type UsageTokenTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * One shared token denominator for Models and Sessions. Cache reads/writes are
 * real metered token quantities and therefore belong in the observed-volume
 * total used by Cost/1M. Keeping this helper shared prevents the two surfaces
 * from drifting into subtly different definitions.
 */
export function observedTokenTotal(usage: UsageTokenTotals): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * Cache reuse amplification: cached input served for every one uncached input
 * token. This is intentionally the primary cache-efficiency signal in dense
 * tables because 20x vs 50x is easier to reason about than 95% vs 98%.
 */
export function cacheReuseMultiple(inputTokens: number, cacheReadTokens: number): number | null {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(cacheReadTokens) || inputTokens <= 0 || cacheReadTokens < 0) return null
  return cacheReadTokens / inputTokens
}

/** Secondary cache-share representation retained for drill-down/tooltips. */
export function cacheShare(inputTokens: number, cacheReadTokens: number): number | null {
  const denominator = inputTokens + cacheReadTokens
  if (!Number.isFinite(denominator) || denominator <= 0) return null
  return cacheReadTokens / denominator
}

/** Effective observed API-equivalent value per one million metered tokens. */
export function costPerMillionObserved(costUSD: number, totalTokens: number): number | null {
  if (!Number.isFinite(costUSD) || !Number.isFinite(totalTokens) || totalTokens <= 0) return null
  return costUSD / totalTokens * 1_000_000
}

export function formatReuseMultiple(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value >= 100) return `${Math.round(value)}×`
  if (value >= 10) return `${value.toFixed(1)}×`
  return `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}×`
}
