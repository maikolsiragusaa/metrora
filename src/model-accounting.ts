import type { MenubarPayload, ModelAccounting, PeriodData } from './menubar-json.js'
import { getHistoricalPricingModelKey, getShortModelName } from './models.js'
import { combineReasoningSemantics, providerHasSeparateReasoning, reasoningSemanticsForProviders, type ReasoningTokenSemantics } from './token-semantics.js'

const TOP_MODELS_LIMIT = 20
const SYNTHETIC_MODEL_NAME = '<synthetic>'

type MergedModelRow = {
  name: string
  cost: number
  calls: number
  savingsUSD: number
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokenDetail: boolean
  activeDurationMs: number
  activeGeneratedTokens: number
  timingCoverage?: 'observed' | 'partial' | 'unavailable'
  provider?: string
  sourceProviders?: string[]
  rawModels?: string[]
  canonicalIdentity?: string
  semanticVariant?: string
  reasoningSemantics?: ReasoningTokenSemantics
  estimatedCostUSD: number
  costIsEstimated: boolean
}

function mergeTimingCoverage(left: MergedModelRow['timingCoverage'], right: MergedModelRow['timingCoverage']): MergedModelRow['timingCoverage'] {
  if (left === undefined) return right
  if (right === undefined) return left
  if (left === right) return left
  return 'partial'
}

function semanticVariant(model: string): string | undefined {
  const lower = model.trim().toLowerCase()
  const marker = lower.search(/(?:^|[-:])(free|high|low|medium|tiered|default|preview)(?:$|[-:])/)
  if (marker < 0) return undefined
  return lower.slice(marker).replace(/^[-:]/, '') || undefined
}

function displayName(model: string, variant: string | undefined): string {
  const base = getShortModelName(model)
  if (!variant || base.toLowerCase().includes(variant)) return base
  return `${base} (${variant})`
}

function modelBaseIdentity(model: PeriodData['models'][number]): string {
  // Model identifiers are case-insensitive for the observed provider ids in
  // this projection (for example `GPT-5.4` and `gpt-5.4`). Keep pricing
  // resolution on the original raw value elsewhere; only the accounting
  // identity is case-folded so presentation casing cannot create duplicates.
  const canonical = getHistoricalPricingModelKey(model.name).toLowerCase()
  const variant = semanticVariant(model.name) ?? ''
  return `${canonical}\u0000${variant}`
}

type ProviderSourceIndex = Map<string, Map<string, Set<string>>>

function buildProviderSourceIndex(models: PeriodData['models']): ProviderSourceIndex {
  const index: ProviderSourceIndex = new Map()
  for (const model of models) {
    if (model.name === SYNTHETIC_MODEL_NAME || !model.modelProvider) continue
    const byProvider = index.get(modelBaseIdentity(model)) ?? new Map<string, Set<string>>()
    const sources = byProvider.get(model.modelProvider) ?? new Set<string>()
    for (const source of model.sourceProviders ?? []) sources.add(source)
    byProvider.set(model.modelProvider, sources)
    index.set(modelBaseIdentity(model), byProvider)
  }
  return index
}

function rowIdentity(model: PeriodData['models'][number], providerSources: ProviderSourceIndex): string {
  const base = modelBaseIdentity(model)
  if (model.modelProvider) return `${base}\u0000${model.modelProvider}`

  // Legacy daily rows may have lost the source-recorded route. Reattach them
  // to a single current route only when the remaining collector provenance is
  // compatible; otherwise keep the ambiguous row separate rather than
  // inventing a provider identity.
  const byProvider = providerSources.get(base)
  const providers = byProvider ? [...byProvider.keys()] : []
  const sources = new Set(model.sourceProviders ?? [])
  if (sources.size > 0) {
    const matches = providers.filter(provider => {
      const knownSources = byProvider?.get(provider) ?? new Set<string>()
      return [...sources].some(source => knownSources.has(source))
    })
    if (matches.length === 1) return `${base}\u0000${matches[0]}`
  } else if (providers.length === 1) {
    return `${base}\u0000${providers[0]}`
  }
  return `${base}\u0000`
}

function hasSeparateTokenEvidence(model: PeriodData['models'][number]): boolean {
  return typeof model.reasoningTokens === 'number'
    && Number.isFinite(model.reasoningTokens)
    && model.reasoningTokens > 0
    && (model.sourceProviders ?? []).some(providerHasSeparateReasoning)
}

function mergedModelRows(models: PeriodData['models']): MergedModelRow[] {
  // Durable day entries can use raw provider model ids. Resolve a conservative
  // identity here: true aliases collapse, while source-recorded routes and
  // economic/semantic variants remain distinct. Display names are deliberately
  // separate from that identity.
  const merged = new Map<string, Omit<MergedModelRow, 'name'>>()
  const providerSources = buildProviderSourceIndex(models)
  for (const model of models) {
    if (model.name === SYNTHETIC_MODEL_NAME) continue
    const identity = rowIdentity(model, providerSources)
    const variant = semanticVariant(model.name)
    const name = displayName(model.name, variant)
    const hasTokenDetail = [model.inputTokens, model.outputTokens, model.cacheReadTokens, model.cacheWriteTokens]
      .every(value => typeof value === 'number' && Number.isFinite(value))
    const acc = merged.get(identity) ?? {
      cost: 0,
      calls: 0,
      savingsUSD: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokenDetail: true,
      activeDurationMs: 0,
      activeGeneratedTokens: 0,
      timingCoverage: undefined,
      estimatedCostUSD: 0,
      costIsEstimated: false,
    }
    acc.cost += model.cost
    acc.calls += model.calls
    acc.savingsUSD += model.savingsUSD ?? 0
    acc.estimatedCostUSD += model.estimatedCostUSD ?? 0
    acc.costIsEstimated = acc.costIsEstimated || (model.estimatedCostUSD ?? 0) > 0
    acc.tokenDetail = acc.tokenDetail && hasTokenDetail
    if (hasTokenDetail) {
      acc.inputTokens += model.inputTokens!
      acc.outputTokens += model.outputTokens!
      acc.cacheReadTokens += model.cacheReadTokens!
      acc.cacheWriteTokens += model.cacheWriteTokens!
    }
    // Current durable rows do not persist reasoningSemantics. Their numeric
    // reasoning field is populated only from parser contracts that expose
    // reasoning independently; a mixed row is therefore safe to retain when
    // it has positive evidence and includes at least one known separate-
    // reasoning source. A positive field from an unknown-only source remains
    // unavailable, so legacy/unclassified values are never guessed.
    const modelReasoningSemantics = model.reasoningSemantics
      ?? reasoningSemanticsForProviders(model.sourceProviders, hasSeparateTokenEvidence(model))
    acc.reasoningSemantics = acc.reasoningSemantics === undefined
      ? modelReasoningSemantics
      : combineReasoningSemantics([acc.reasoningSemantics, modelReasoningSemantics])
    if (hasTokenDetail && modelReasoningSemantics === 'separate') {
      acc.reasoningTokens = (acc.reasoningTokens ?? 0) + (model.reasoningTokens ?? 0)
    }
    if (
      typeof model.activeDurationMs === 'number' && Number.isFinite(model.activeDurationMs) && model.activeDurationMs > 0
      && typeof model.activeGeneratedTokens === 'number' && Number.isFinite(model.activeGeneratedTokens) && model.activeGeneratedTokens > 0
    ) {
      acc.timingCoverage = mergeTimingCoverage(acc.timingCoverage, model.timingCoverage ?? 'observed')
      acc.activeDurationMs += model.activeDurationMs
      acc.activeGeneratedTokens += model.activeGeneratedTokens
    } else {
      acc.timingCoverage = mergeTimingCoverage(acc.timingCoverage, model.timingCoverage ?? 'unavailable')
    }
    const hasProvenance = Boolean(model.modelProvider || (model.sourceProviders && model.sourceProviders.length > 0))
    if (model.modelProvider) acc.provider = model.modelProvider
    if (model.sourceProviders && model.sourceProviders.length > 0) {
      acc.sourceProviders = [...new Set([...(acc.sourceProviders ?? []), ...model.sourceProviders])].sort()
    }
    if (hasProvenance || variant) {
      acc.rawModels = [...new Set([...(acc.rawModels ?? []), model.name])].sort()
      acc.canonicalIdentity = getHistoricalPricingModelKey(model.name)
      if (variant) acc.semanticVariant = variant
    }
    merged.set(identity, acc)
  }
  return [...merged.entries()]
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([identity, data]) => {
      const model = models.find(value => value.name !== SYNTHETIC_MODEL_NAME && rowIdentity(value, providerSources) === identity)
      const variant = data.semanticVariant
      const name = model ? displayName(model.name, variant) : data.rawModels?.[0] ?? identity
      return {
        name,
        ...data,
        // Avoid changing the compatibility payload for legacy fixtures that
        // have no provenance metadata at all.
        ...(data.rawModels && data.rawModels.length > 0 ? { rawModels: data.rawModels } : {}),
      }
    })
}

export function buildTopModels(models: PeriodData['models']): MenubarPayload['current']['topModels'] {
  return mergedModelRows(models)
    .slice(0, TOP_MODELS_LIMIT)
    .map(row => ({
      name: row.name,
      cost: row.cost,
      calls: row.calls,
      savingsUSD: row.savingsUSD,
      estimatedCostUSD: row.estimatedCostUSD,
      savingsBaselineModel: '',
    }))
}

export function buildModelAccounting(models: PeriodData['models'], totalCost: number, totalCalls: number): ModelAccounting {
  const rows: ModelAccounting['rows'] = mergedModelRows(models).map(row => ({
    name: row.name,
    cost: row.cost,
    savingsUSD: row.savingsUSD,
    calls: row.calls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    tokenDetail: row.tokenDetail,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.sourceProviders && row.sourceProviders.length > 0 ? { sourceProviders: row.sourceProviders } : {}),
    ...(row.rawModels && row.rawModels.length > 0 ? { rawModels: row.rawModels } : {}),
    ...(row.canonicalIdentity ? { canonicalIdentity: row.canonicalIdentity } : {}),
    ...(row.semanticVariant ? { semanticVariant: row.semanticVariant } : {}),
    ...(row.reasoningSemantics && row.reasoningSemantics !== 'unavailable' ? { reasoningSemantics: row.reasoningSemantics } : {}),
    ...(row.reasoningTokens !== undefined ? { reasoningTokens: row.reasoningTokens } : {}),
    ...(row.estimatedCostUSD > 0 ? { estimatedCostUSD: row.estimatedCostUSD } : {}),
    ...(row.costIsEstimated ? { costIsEstimated: true } : {}),
    ...(row.activeDurationMs > 0 && row.activeGeneratedTokens > 0
      ? { activeDurationMs: row.activeDurationMs, activeGeneratedTokens: row.activeGeneratedTokens }
      : {}),
    ...(row.timingCoverage && row.timingCoverage !== 'unavailable' ? { timingCoverage: row.timingCoverage } : {}),
  }))
  const representedCost = rows.reduce((sum, row) => sum + row.cost, 0)
  const representedSavings = rows.reduce((sum, row) => sum + row.savingsUSD, 0)
  const representedCalls = rows.reduce((sum, row) => sum + row.calls, 0)
  const tokenDetailedCost = rows.reduce((sum, row) => sum + (row.tokenDetail ? row.cost : 0), 0)
  const tokenDetailedCalls = rows.reduce((sum, row) => sum + (row.tokenDetail ? row.calls : 0), 0)
  const totalSavings = models.reduce((sum, model) => sum + (model.savingsUSD ?? 0), 0)
  const gapCost = Math.max(0, totalCost - representedCost)
  const gapCalls = Math.max(0, totalCalls - representedCalls)
  const gapSavings = Math.max(0, totalSavings - representedSavings)
  return {
    rows,
    gap: { cost: gapCost > 1e-9 ? gapCost : 0, savingsUSD: gapSavings > 1e-9 ? gapSavings : 0, calls: gapCalls },
    coverage: {
      cost: totalCost > 1e-9 ? Math.max(0, Math.min(1, representedCost / totalCost)) : 1,
      calls: totalCalls > 0 ? Math.max(0, Math.min(1, representedCalls / totalCalls)) : 1,
    },
    tokenCoverage: {
      cost: representedCost > 1e-9 ? Math.max(0, Math.min(1, tokenDetailedCost / representedCost)) : 1,
      calls: representedCalls > 0 ? Math.max(0, Math.min(1, tokenDetailedCalls / representedCalls)) : 1,
    },
  }
}
