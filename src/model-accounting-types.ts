export type ModelAccountingRow = {
  name: string
  cost: number
  savingsUSD: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** False means an older source could preserve cost/calls but not token split. */
  tokenDetail: boolean
  /// Source-recorded route/provider. Kept separate from the collector name.
  provider?: string
  /// Collector/tool names contributing to the row.
  sourceProviders?: string[]
  /// Raw IDs that canonicalized into this row; emitted when useful for audit.
  rawModels?: string[]
  /// Canonical pricing identity before an economic variant suffix.
  canonicalIdentity?: string
  /// Explicit semantic variant such as free/high/low/tiered.
  semanticVariant?: string
  /** Active generation timing from surviving source evidence only. */
  activeDurationMs?: number
  activeGeneratedTokens?: number
  reasoningTokens?: number
}
