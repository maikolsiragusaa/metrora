import type { ModelPricingSummary, TaskCategory } from './types'
import type { ReasoningTokenSemantics } from './model-projection-types'

export type ModelReportRow = {
  provider: string
  providerDisplayName: string
  model: string
  modelDisplayName: string
  category: TaskCategory | null
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
  pricing?: ModelPricingSummary
  credits: number | null
  topCategory?: TaskCategory
  topCategoryCost?: number
  topCategoryShare?: number
}
