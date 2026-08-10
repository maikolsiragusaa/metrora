import type { ModelPricingSummary } from './model-pricing-summary.js'
import type { TaskCategory } from './types.js'
import type { ReasoningTokenSemantics } from './token-semantics.js'

export type ModelReportRow = {
  provider: string
  providerDisplayName: string
  model: string
  modelDisplayName: string
  category: TaskCategory | null
  /// Claude subagent label in byAgent mode; `(main)` for ordinary/non-Claude sessions.
  agentType?: string | null
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  reasoningSemantics?: ReasoningTokenSemantics
  cacheWriteTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUSD: number
  savingsUSD: number
  savingsBaselineModel: string
  calls: number
  pricing: ModelPricingSummary
  /// Codex credit consumption; null outside Codex or without a known rate.
  credits: number | null
  topCategory?: TaskCategory
  topCategoryCost?: number
  topCategoryShare?: number
}

export type AggregateOptions = {
  byTask?: boolean
  /// One row per (provider, model, agent). Mutually exclusive with `byTask`;
  /// the caller enforces that. Non-Claude providers and ordinary sessions bucket
  /// under `'(main)`.
  byAgent?: boolean
  taskFilter?: TaskCategory
  topN?: number
  /// Threshold for the `cost`-based filter. The default `0.01` would hide
  /// local-only models whose costUSD is 0 but savingsUSD is meaningful.
  minCost?: number
}
