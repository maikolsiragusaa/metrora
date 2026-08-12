export type ModelCosts = {
  inputCostPerToken: number
  outputCostPerToken: number
  cacheWriteCostPerToken: number
  cacheReadCostPerToken: number
  webSearchCostPerRequest: number
  fastMultiplier: number
}

// [input, output, cacheWrite, cacheRead, fastMultiplier]. The trailing fast
// multiplier is carried straight from LiteLLM's provider_specific_entry.fast
// so new models pick it up without a hand-maintained per-model table.
export type SnapshotEntry = [number, number, number | null, number | null, (number | null)?]

const WEB_SEARCH_COST = 0.01

/// Clamp a per-token rate to a sane non-negative value. Defense in depth
/// against a tampered pricing source shipping a negative rate, NaN or Infinity.
/// The $1/token ceiling prevents a stray decimal-place shift from wildly
/// inflating spend numbers.
export function safePerTokenRate(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
  if (n > 1) return 1
  return n
}

// Assemble a ModelCosts, applying the cache-cost heuristics (write = 1.25x
// input, read = 0.1x input) when a source omits them. Shared by bundled,
// override and live LiteLLM pricing paths.
export function buildCosts(
  input: number,
  output: number,
  cacheWrite: number | null | undefined,
  cacheRead: number | null | undefined,
  fast: number | null | undefined,
): ModelCosts {
  return {
    inputCostPerToken: input,
    outputCostPerToken: output,
    cacheWriteCostPerToken: cacheWrite ?? input * 1.25,
    cacheReadCostPerToken: cacheRead ?? input * 0.1,
    webSearchCostPerRequest: WEB_SEARCH_COST,
    fastMultiplier: fast ?? 1,
  }
}

export function tupleToCosts(raw: SnapshotEntry): ModelCosts {
  const [input, output, cacheWrite, cacheRead, fast] = raw
  return buildCosts(input, output, cacheWrite, cacheRead, fast)
}
