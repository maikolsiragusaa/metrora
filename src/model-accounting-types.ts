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
  /// Canonical model-vendor identity used only for presentation branding.
  brandId?: import('./model-brand.js').ModelBrandId
  /// Collector/tool names contributing to the row.
  sourceProviders?: string[]
  /// Raw IDs that canonicalized into this row; emitted when useful for audit.
  rawModels?: string[]
  /// Canonical pricing identity before an economic variant suffix.
  canonicalIdentity?: string
  /// Explicit semantic variant such as free/high/low/tiered.
  semanticVariant?: string
  /** Whether separately reported reasoning is safe to add to generated totals. */
  reasoningSemantics?: 'separate' | 'aggregate-output' | 'unavailable' | 'mixed'
  /** Portion of this row's settled cost computed from estimated usage. */
  estimatedCostUSD?: number
  costIsEstimated?: boolean
  /** Active generation timing from surviving source evidence only. */
  activeDurationMs?: number
  activeGeneratedTokens?: number
  /** Whether active-generation timing is observed for this exact row. */
  timingCoverage?: 'observed' | 'partial' | 'unavailable'
  reasoningTokens?: number
}
