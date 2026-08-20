export type ReasoningTokenSemantics = 'separate' | 'aggregate-output' | 'unavailable' | 'mixed'

export type DurableModelAccountingRow = {
  name: string
  cost: number
  savingsUSD: number
  calls: number
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  additiveReasoningTokens?: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokenDetail: boolean
  provider?: string
  sourceProviders?: string[]
  rawModels?: string[]
  canonicalIdentity?: string
  semanticVariant?: string
  reasoningSemantics?: ReasoningTokenSemantics
  estimatedCostUSD?: number
  costIsEstimated?: boolean
  activeDurationMs?: number
  activeGeneratedTokens?: number
  timingCoverage?: 'observed' | 'partial' | 'unavailable'
}

export type DurableModelPresentationRow = DurableModelAccountingRow & {
  presentationIdentity: string
  providers: string[]
  sourceProviders: string[]
  rawModels: string[]
  canonicalIdentities: string[]
  economicVariants: string[]
  reasoningSemantics: ReasoningTokenSemantics
  deliveryRows: DurableModelAccountingRow[]
  deliveryStatus: 'exact' | 'partial' | 'unavailable'
  pricingState?: 'settled' | 'estimated' | 'mixed' | 'unavailable'
  timingCoverage: 'observed' | 'partial' | 'unavailable'
}

export type ModelAccounting = {
  rows: DurableModelAccountingRow[]
  gap: { cost: number; savingsUSD: number; calls: number }
  coverage: { cost: number; calls: number }
  tokenCoverage?: { cost: number; calls: number }
}

export type ModelPresentation = {
  rows: DurableModelPresentationRow[]
  accountingRowCount: number
}
