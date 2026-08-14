import { calculateCost } from '../models.js'
import { normalizeExplicitModelProvider } from '../model-provider.js'
import type { ParsedProviderCall } from './types.js'

export type ModelMap = Record<string, string>

export type UsageEntry = {
  model?: string
  inputTokens?: string | number
  outputTokens?: string | number
  thinkingOutputTokens?: string | number
  responseOutputTokens?: string | number
  cacheReadTokens?: string | number
  cacheCreationTokens?: string | number
  cacheCreationInputTokens?: string | number
  apiProvider?: string
  responseId?: string
  createdAt?: string | number
  timestamp?: string | number
}

export type GeneratorMetadata = {
  stepIndices?: number[]
  chatModel?: {
    model: string
    responseModel?: string
    usage?: UsageEntry
    retryInfos?: Array<{ usage?: UsageEntry }>
    chatStartMetadata?: { createdAt?: string }
  }
}

export type AntigravityCacheEnrichment = {
  model: string
  modelProvider?: string
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

const MODEL_PLACEHOLDER_PATTERN = /^MODEL_PLACEHOLDER_/
const PRICING_ALIASES: Record<string, string> = { 'gemini-pro': 'gemini-3.1-pro' }

export function dropPlaceholderModelId(model: string): string {
  return MODEL_PLACEHOLDER_PATTERN.test(model) ? 'unknown' : model
}

export function getCanonicalModelId(key: string, displayName?: string): string {
  if (displayName) {
    const lower = displayName.toLowerCase()
    const hasExplicitTier = /high|medium|low|image|lite/.test(lower)
    const isAgent = lower.includes('agent') || (/-agent$/i.test(key) && !hasExplicitTier)
    if (lower.includes('3.5 flash')) {
      if (isAgent) return 'gemini-3.5-flash-agent'
      if (lower.includes('high')) return 'gemini-3.5-flash-high'
      if (lower.includes('medium')) return 'gemini-3.5-flash-medium'
      if (lower.includes('low')) return 'gemini-3.5-flash-low'
      return 'gemini-3.5-flash'
    }
    if (lower.includes('3.1 pro')) {
      if (isAgent) return 'gemini-3.1-pro-agent'
      if (lower.includes('high')) return 'gemini-3.1-pro-high'
      if (lower.includes('medium')) return 'gemini-3.1-pro-medium'
      if (lower.includes('low')) return 'gemini-3.1-pro-low'
      return 'gemini-3.1-pro'
    }
    if (lower.includes('3.1 flash')) {
      if (isAgent) return 'gemini-3.1-flash-agent'
      if (lower.includes('image')) return 'gemini-3.1-flash-image'
      if (lower.includes('lite')) return 'gemini-3.1-flash-lite'
      return 'gemini-3.1-flash'
    }
    if (lower.includes('3 flash')) return isAgent ? 'gemini-3-flash-agent' : 'gemini-3-flash'
    if (lower.includes('3 pro')) return isAgent ? 'gemini-3-pro-agent' : 'gemini-3-pro'
  }
  return dropPlaceholderModelId(key)
}

export function normalizePricingModel(model: string): string {
  const stripped = model.replace(/-(high|medium|low|agent)$/, '')
  return PRICING_ALIASES[stripped] ?? stripped
}

function token(value: string | number | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '0', 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

function timestamp(value: string | number | undefined): string {
  if (value === undefined) return ''
  const parsed = typeof value === 'number'
    ? new Date(value < 1e12 ? value * 1000 : value)
    : new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

export function buildCallsFromGeneratorMetadata(
  cascadeId: string,
  metadata: GeneratorMetadata[],
  modelMap: ModelMap,
): ParsedProviderCall[] {
  const results: ParsedProviderCall[] = []
  const seenKeys = new Set<string>()

  for (let i = 0; i < metadata.length; i++) {
    const chatModel = metadata[i]!.chatModel
    if (!chatModel) continue
    const usages = [
      ...(chatModel.usage ? [{ usage: chatModel.usage, suffix: 'usage' }] : []),
      ...(chatModel.retryInfos ?? []).flatMap((retry, retryIndex) =>
        retry.usage ? [{ usage: retry.usage, suffix: `retry-${retryIndex}` }] : []),
    ]

    for (const { usage, suffix } of usages) {
      const inputTokens = token(usage.inputTokens)
      const totalOutputTokens = token(usage.outputTokens)
      const thinkingTokens = token(usage.thinkingOutputTokens)
      let responseTokens = token(usage.responseOutputTokens)
      const cacheReadTokens = token(usage.cacheReadTokens)
      const cacheCreationTokens = token(usage.cacheCreationTokens ?? usage.cacheCreationInputTokens)

      if (responseTokens === 0 && thinkingTokens === 0) responseTokens = totalOutputTokens
      else if (totalOutputTokens > 0 && responseTokens + thinkingTokens !== totalOutputTokens) {
        responseTokens = Math.max(0, totalOutputTokens - thinkingTokens)
      }
      if (inputTokens + responseTokens + thinkingTokens + cacheReadTokens + cacheCreationTokens === 0) continue

      const responseId = usage.responseId || `${i}:${suffix}`
      const deduplicationKey = `antigravity:${cascadeId}:${responseId}`
      if (seenKeys.has(deduplicationKey)) continue
      seenKeys.add(deduplicationKey)

      const rawModel = usage.model ?? chatModel.responseModel ?? chatModel.model
      const model = dropPlaceholderModelId(modelMap[rawModel] ?? rawModel)
      const modelProvider = normalizeExplicitModelProvider(usage.apiProvider)
      const callTimestamp = timestamp(usage.createdAt ?? usage.timestamp)
        || chatModel.chatStartMetadata?.createdAt || ''
      const costUSD = calculateCost(
        normalizePricingModel(model), inputTokens, responseTokens + thinkingTokens,
        cacheCreationTokens, cacheReadTokens, 0,
      )

      results.push({
        provider: 'antigravity', model, ...(modelProvider ? { modelProvider } : {}),
        ...(modelProvider ? { pricingContext: { inferenceProvider: modelProvider } } : {}),
        inputTokens, outputTokens: responseTokens,
        cacheCreationInputTokens: cacheCreationTokens, cacheReadInputTokens: cacheReadTokens,
        cachedInputTokens: 0, reasoningTokens: thinkingTokens, webSearchRequests: 0, costUSD,
        tools: [], bashCommands: [], timestamp: callTimestamp, speed: 'standard',
        deduplicationKey, userMessage: '', sessionId: cascadeId,
      })
    }
  }
  return results
}

function modelKey(model: string): string {
  return getCanonicalModelId(model, model).toLowerCase()
}

/**
 * Status Line has no response id. Keep any matched cache delta as evidence only;
 * the normal call pipeline has no safe aggregate-enrichment representation.
 */
export function reconcileAntigravityStatusLineCalls(
  directCalls: readonly ParsedProviderCall[],
  statusLineCalls: readonly ParsedProviderCall[],
): AntigravityCacheEnrichment[] {
  if (directCalls.length === 0) return []
  const directByModel = new Map<string, ParsedProviderCall[]>()
  const statusByModel = new Map<string, ParsedProviderCall[]>()
  for (const call of directCalls) directByModel.set(modelKey(call.model), [...(directByModel.get(modelKey(call.model)) ?? []), call])
  for (const call of statusLineCalls) statusByModel.set(modelKey(call.model), [...(statusByModel.get(modelKey(call.model)) ?? []), call])

  const enrichments: AntigravityCacheEnrichment[] = []
  for (const [key, statusCalls] of statusByModel) {
    const direct = directByModel.get(key) ?? []
    if (direct.length === 0) continue
    const total = (calls: readonly ParsedProviderCall[], field: 'input' | 'output' | 'read' | 'write') => calls.reduce(
      (sum, call) => sum + (field === 'input' ? call.inputTokens : field === 'output'
        ? call.outputTokens + call.reasoningTokens : field === 'read'
          ? call.cacheReadInputTokens : call.cacheCreationInputTokens), 0,
    )
    if (total(direct, 'input') !== total(statusCalls, 'input') || total(direct, 'output') !== total(statusCalls, 'output')) continue
    const cacheRead = Math.max(0, total(statusCalls, 'read') - total(direct, 'read'))
    const cacheWrite = Math.max(0, total(statusCalls, 'write') - total(direct, 'write'))
    if (cacheRead === 0 && cacheWrite === 0) continue

    const exemplar = direct[0]!
    const modelProvider = direct.every(call => call.modelProvider === exemplar.modelProvider) ? exemplar.modelProvider : undefined
    enrichments.push({
      model: exemplar.model, ...(modelProvider ? { modelProvider } : {}),
      cacheCreationInputTokens: cacheWrite, cacheReadInputTokens: cacheRead,
    })
  }
  return enrichments
}
